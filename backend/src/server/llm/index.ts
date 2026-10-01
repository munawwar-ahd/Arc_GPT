import dotenv from 'dotenv';
import { LlmProvider, LlmProviderId, LlmSqlRequest, LlmSqlResponse, LlmChatRequest, LlmModelDescriptor, LlmProviderError } from './types.js';
import { ollamaProvider, OLLAMA_MODEL } from './ollama.provider.js';
import { lmStudioProvider } from './lmstudio.provider.js';

dotenv.config();

export * from './types.js';
export { ollamaProvider, OLLAMA_MODEL, OLLAMA_URL } from './ollama.provider.js';
export { lmStudioProvider, LMSTUDIO_URL, LMSTUDIO_MODEL, displayNameForModel } from './lmstudio.provider.js';
export { parseStructuredSqlResponse } from './structured-output.js';

/**
 * The model router.
 *
 * The rest of the backend asks this module for "a model" and then for "SQL for
 * this question". It never learns which provider answered. Everything downstream
 * — schema selection, prompt content, validation, execution — is identical no
 * matter which engine produced the statement, which is what makes switching
 * models a display concern rather than a security one.
 *
 * Env:
 *   LLM_PROVIDER=ollama | lmstudio   the default when the UI has not chosen
 *   LLM_REQUEST_TIMEOUT_MS           per-request ceiling
 */

const providers = new Map<LlmProviderId, LlmProvider>([
  [ollamaProvider.id, ollamaProvider],
  [lmStudioProvider.id, lmStudioProvider],
]);

export const DEFAULT_PROVIDER_ID = ((): LlmProviderId => {
  const configured = (process.env.LLM_PROVIDER || 'ollama').trim().toLowerCase();
  return configured === 'lmstudio' || configured === 'lm-studio' || configured === 'lm_studio'
    ? 'lmstudio'
    : 'ollama';
})();

export function getProvider(provider: LlmProviderId): LlmProvider {
  const found = providers.get(provider);
  if (!found) throw new LlmProviderError('unavailable', provider, `Unknown LLM provider '${provider}'.`);
  return found;
}

/**
 * Lists every model ArcGPT knows how to talk to, with live availability.
 *
 * Both providers are probed in parallel and a failure of one never affects the
 * other: Ollama being down must not hide LM Studio, or vice versa. This is what
 * `GET /api/models` returns, and it is why `available` is a measurement.
 */
export async function listAvailableModels(): Promise<LlmModelDescriptor[]> {
  const results = await Promise.all(
    Array.from(providers.values()).map(provider =>
      provider.describe().catch((error: unknown) => ({
        id: provider.configuredModel || provider.id,
        name: provider.label,
        provider: provider.id,
        providerLabel: provider.label,
        available: false,
        detail: `Could not check ${provider.label}: ${error instanceof Error ? error.message : 'unknown error'}`,
      }))
    )
  );
  // Ollama first: it is the default engine, so it is the first option offered.
  return results.sort((a, b) => (a.provider === 'ollama' ? -1 : b.provider === 'ollama' ? 1 : 0));
}

/**
 * Turns whatever the browser sent into a real, running model.
 *
 * Accepts, in order of preference: a full model id (`qwen2.5-coder:7b`), a bare
 * provider name (`ollama`), or nothing at all. Anything unrecognised falls back
 * to the configured default rather than failing the question, because the user's
 * intent is a question about the college database, not a model-availability
 * problem.
 *
 * SECURITY: this resolves an LLM and nothing else. It cannot change the
 * database, its credentials, the SQL validator, the table allowlist, the session
 * or any role — those are not parameters here and are not reachable from here.
 */
export async function resolveModelSelection(requested?: string): Promise<LlmModelDescriptor> {
  const models = await listAvailableModels();
  const wanted = typeof requested === 'string' ? requested.trim().toLowerCase() : '';

  if (wanted) {
    const byId = models.find(model => model.id.toLowerCase() === wanted);
    if (byId) return byId;

    const byProvider = models.find(model => model.provider === wanted);
    if (byProvider) return byProvider;

    // A bare provider name may also arrive as "lm-studio" / "lmstudio".
    const normalized = wanted.replace(/[-_]/g, '');
    const byProviderAlias = models.find(model => model.provider.replace(/[-_]/g, '') === normalized);
    if (byProviderAlias) return byProviderAlias;
  }

  const fallback = models.find(model => model.provider === DEFAULT_PROVIDER_ID) ?? models[0];
  return fallback ?? {
    id: 'none',
    name: 'No model available',
    provider: DEFAULT_PROVIDER_ID,
    providerLabel: providers.get(DEFAULT_PROVIDER_ID)?.label ?? 'LLM',
    available: false,
    detail: 'No local model provider responded. Start Ollama or LM Studio.',
  };
}

/**
 * The single call the query pipeline makes to reach a model.
 *
 * `modelId` is a descriptor resolved by `resolveModelSelection`. Availability is
 * re-checked here rather than trusted from the earlier probe, so a provider that
 * went down between the two calls produces a clear message instead of a hang.
 */
export async function generateStructuredSql(
  modelId: LlmModelDescriptor,
  request: LlmSqlRequest
): Promise<LlmSqlResponse> {
  const provider = getProvider(modelId.provider);
  if (!modelId.available) {
    throw new LlmProviderError('unavailable', provider.id, modelId.detail || `${provider.label} is unavailable.`);
  }
  return provider.generateSql(modelId.id, request);
}

/**
 * The matching call for ordinary conversation.
 *
 * Same resolution and same availability re-check as `generateStructuredSql`, so
 * the model selector governs chat exactly as it governs SQL generation. The one
 * structural difference is that no schema is requested and nothing is parsed:
 * the result is prose, and prose cannot become a query.
 */
export async function generateChatReply(
  modelId: LlmModelDescriptor,
  request: LlmChatRequest
): Promise<string> {
  const provider = getProvider(modelId.provider);
  if (!modelId.available) {
    throw new LlmProviderError('unavailable', provider.id, modelId.detail || `${provider.label} is unavailable.`);
  }
  return provider.chat(modelId.id, request);
}

/**
 * Provider-agnostic entry point, matching the shape the rest of ArcGPT talks in.
 *
 * Everything above this line is UI and pipeline; everything below is a wire
 * protocol. `userQuestion` and `databaseSchema` are the only inputs, so the same
 * call works unchanged against Ollama and LM Studio.
 *
 * The production pipeline supplies its own richer prompts through
 * `generateStructuredSql`; this exists so a caller that has a question and a
 * schema — and nothing else — can still route it correctly.
 */
export async function generateSql(params: {
  provider?: string;
  model?: string;
  userQuestion: string;
  databaseSchema: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<LlmSqlResponse> {
  const selected = await resolveModelSelection(
    params.model || params.provider || DEFAULT_PROVIDER_ID
  );
  return generateStructuredSql(selected, {
    systemPrompt: [
      'You translate a natural-language question about a college database into ONE read-only PostgreSQL SELECT statement.',
      'Return a JSON object with exactly three keys: intent (string), tables (array of table names used) and sql (string).',
      'Only reference tables and columns present in the supplied schema. Never emit DDL, DML, comments or multiple statements.',
      'Do not invent or modify table or column names; the supplied schema is authoritative.',
    ].join('\n'),
    userPrompt: `Database schema:\n${params.databaseSchema}\n\nQuestion: ${params.userQuestion}\n\nReturn JSON with intent, tables, and sql.`,
    temperature: params.temperature ?? 0.1,
    maxTokens: params.maxTokens,
    timeoutMs: params.timeoutMs,
  });
}

/** Startup summary for the console banner. Never includes credentials. */
export async function describeActiveModel(): Promise<string> {
  const models = await listAvailableModels();
  return models
    .map(model => `${model.providerLabel}: ${model.name}${model.available ? '' : ' (offline)'}`)
    .join(' | ');
}

export { OLLAMA_MODEL as DEFAULT_OLLAMA_MODEL };