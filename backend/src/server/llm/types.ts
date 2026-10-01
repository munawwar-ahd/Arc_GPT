/**
 * Contracts for the ArcGPT LLM provider layer.
 *
 * ArcGPT talks to more than one local inference server. `qwen2.5-coder:7b`
 * through Ollama is the default; a much larger coder model can be served by
 * LM Studio over its OpenAI-compatible endpoint. The two speak completely
 * different wire protocols, and neither of them is allowed to know anything
 * about the other.
 *
 * The rule that makes this layer safe is stated once here and enforced by the
 * shape of the types: a provider receives a *prompt* and returns a *string*.
 * It never sees a database connection, a SQL validator, a role, or a result
 * set. Switching providers therefore cannot change which tables are allowed,
 * which query is rejected, or how it is executed — those decisions all live
 * downstream in `sql-validation.service.ts` and `db.ts`, and no provider
 * implements them.
 */

export type LlmProviderId = 'ollama' | 'lmstudio';

/**
 * What the API tells the browser about one model.
 *
 * `available` is always *measured*, never assumed. A provider that is not
 * running reports `false` with a `detail` explaining why, and the selector
 * shows that rather than offering a model that will fail on click.
 */
export interface LlmModelDescriptor {
  /** The exact identifier sent to the provider. Never guessed by the client. */
  id: string;
  /** Display name, e.g. "Qwen2.5-Coder 7B". */
  name: string;
  provider: LlmProviderId;
  /** Human label for the provider, e.g. "Ollama" / "LM Studio". */
  providerLabel: string;
  available: boolean;
  /** One short line: how the id was resolved, or why it is unavailable. */
  detail?: string;
}

export interface LlmSqlRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  /** Upper bound on generated tokens. Providers map this to their own field. */
  maxTokens?: number;
  /** Wall-clock ceiling for the whole request. */
  timeoutMs?: number;
}

export interface LlmSqlResponse {
  intent: string;
  tables: string[];
  sql: string;
}

/** One prior turn, in the shape both providers' `messages` arrays accept. */
export interface LlmChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * A request for an ordinary prose answer.
 *
 * This is the second operation a provider exposes, alongside `generateSql`. The
 * distinction is the whole point of the abstraction: `generateSql` is asked for
 * a strict JSON object and its output is untrusted input to the SQL validator,
 * while `chat` is asked for markdown prose and its output goes straight to the
 * user. Nothing a provider does in `chat` can reach PostgreSQL, because a
 * provider has no database handle to reach with — the SQL validator and the
 * read-only pool sit downstream of `generateSql` only.
 */
export interface LlmChatRequest {
  systemPrompt: string;
  /** The message to answer. Always last in the `messages` array. */
  userPrompt: string;
  /** Recent turns, oldest first. Lets "tell me another" work. */
  history?: LlmChatTurn[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Optional JSON Schema the reply must satisfy.
   *
   * Used by the intent router, not by conversation. Asking a 7B model in prose
   * to "reply with only JSON" is not reliable — it answers the question
   * instead, which for a router means it silently produces a wrong verdict.
   * Constrained decoding removes the failure mode rather than apologising for it.
   *
   * A reply constrained this way is still an *advisory* value: the caller
   * validates it and picks a safe default if it does not parse. It never
   * becomes SQL.
   */
  jsonSchema?: Record<string, unknown>;
}

/**
 * Why a provider call failed.
 *
 * Typed so the query pipeline can turn each case into a useful message for the
 * user ("start Ollama", "load the model in LM Studio") instead of the generic
 * failure text, and so none of them leak a URL, a stack trace or a port.
 *
 * `out_of_memory` is separate from `request_failed` because it is the single
 * most common real failure when two local providers share one GPU: the server
 * is up, the model is installed, and it still cannot start. Telling the user to
 * "start Ollama" when Ollama is already running is the worst possible answer.
 */
export type LlmFailureReason =
  | 'unavailable'
  | 'model_not_loaded'
  | 'out_of_memory'
  | 'timeout'
  | 'malformed_output'
  | 'request_failed';

export class LlmProviderError extends Error {
  readonly reason: LlmFailureReason;
  readonly provider: LlmProviderId;
  readonly status?: number;

  constructor(
    reason: LlmFailureReason,
    provider: LlmProviderId,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = 'LlmProviderError';
    this.reason = reason;
    this.provider = provider;
    this.status = status;
  }
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly label: string;
  readonly baseUrl: string;
  /** The model this provider is configured to use, from the environment. */
  readonly configuredModel: string;

  /** Probes the server and reports one descriptor for this provider's model. */
  describe(): Promise<LlmModelDescriptor>;

  /**
   * Sends one prompt to one specific model.
   *
   * `model` is the resolved identifier from `describe()`. It is passed in
   * rather than read from configuration here so a request is always attributable
   * to exactly the model the user selected in the UI.
   */
  generateSql(model: string, request: LlmSqlRequest): Promise<LlmSqlResponse>;

  /**
   * Returns one ordinary prose answer, with no JSON structure imposed.
   *
   * This is what "hi" and "explain recursion" go through. It is deliberately a
   * separate method rather than a flag on `generateSql`: the SQL path must stay
   * schema-constrained so a malformed generation is caught, and relaxing that
   * for conversation would weaken the one call whose output is treated as
   * executable input.
   *
   * The returned string is shown to the user as-is. A provider implementation
   * must not try to interpret it, and the caller must not pass it anywhere that
   * could execute it.
   */
  chat(model: string, request: LlmChatRequest): Promise<string>;
}