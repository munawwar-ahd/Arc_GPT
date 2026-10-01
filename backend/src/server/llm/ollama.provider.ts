import dotenv from 'dotenv';
import { LlmProvider, LlmModelDescriptor, LlmProviderError, LlmSqlRequest, LlmSqlResponse, LlmChatRequest, LlmChatTurn } from './types.js';
import { parseStructuredSqlResponse } from './structured-output.js';

dotenv.config();

/**
 * Ollama provider — the default ArcGPT engine.
 *
 * This is the behaviour that was already working, moved behind the provider
 * interface and otherwise unchanged: `POST {OLLAMA_URL}/api/chat`, JSON-schema
 * constrained output via `format`, `stream: false`, low temperature, and a
 * long request timeout appropriate for a local 7B model on CPU or GPU.
 *
 * `OLLAMA_MODEL` keeps its `repo:tag` form. The previously configured
 * `qwen2.5-coder-7b-instruct` is a Hugging Face style name that does not exist
 * in the Ollama registry, so pulling it fails; `qwen2.5-coder:7b` is correct and
 * is the default here.
 */

export const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';

/** Ollama's constrained-output schema for the one shape ArcGPT asks for. */
const STRUCTURED_FORMAT = {
  type: 'object' as const,
  properties: {
    intent: { type: 'string' },
    tables: { type: 'array', items: { type: 'string' } },
    sql: { type: 'string' },
  },
  required: ['intent', 'tables', 'sql'],
};

const probeTimeoutMs = Number(process.env.OLLAMA_PROBE_TIMEOUT_MS || 2000);
const requestTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 120000);

interface OllamaTag {
  name?: string;
  model?: string;
}

async function fetchInstalledModels(): Promise<OllamaTag[] | null> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { models?: OllamaTag[] };
    return Array.isArray(data.models) ? data.models : [];
  } catch {
    return null;
  }
}

/**
 * Picks the model to actually call from what Ollama reports as installed.
 *
 * The exact configured name wins. Failing that, a same-family match is
 * accepted, because a tag differing only by `:latest` is the same weights —
 * but an unrelated model is not silently substituted, because answering with a
 * model the user did not choose would be worse than a clear error.
 */
function resolveInstalled(tags: OllamaTag[]): string | null {
  const names = tags.map(tag => tag.name || tag.model || '').filter(Boolean);
  if (names.length === 0) return null;

  const configured = OLLAMA_MODEL;
  return (
    names.find(name => name === configured) ||
    names.find(name => name === `${configured}:latest`) ||
    names.find(name => name.startsWith(configured.split(':')[0])) ||
    null
  );
}

/**
 * Maps a thrown fetch error onto a typed provider failure.
 *
 * `AbortSignal.timeout` rejects with a `TimeoutError`, and a cancelled request
 * raises an `AbortError`. Both mean the same thing to the user — the model took
 * too long — and neither is a transport failure worth reporting as "the server
 * is not reachable", which would send them to start a server that is already
 * running.
 */
export function translateTransportError(
  error: unknown,
  provider: 'ollama' | 'lmstudio',
  label: string
): LlmProviderError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new LlmProviderError('timeout', provider, `${label} did not answer within the time limit.`);
  }
  return new LlmProviderError('unavailable', provider, `${label} is not reachable.`);
}

export class OllamaProvider implements LlmProvider {

  public readonly id = 'ollama' as const;
  public readonly label = 'Ollama';
  public readonly baseUrl = OLLAMA_URL;
  public readonly configuredModel = OLLAMA_MODEL;

  public async describe(): Promise<LlmModelDescriptor> {
    const descriptor: LlmModelDescriptor = {
      id: OLLAMA_MODEL,
      name: 'Qwen2.5-Coder 7B',
      provider: this.id,
      providerLabel: this.label,
      available: false,
    };

    const tags = await fetchInstalledModels();
    if (tags === null) {
      return { ...descriptor, detail: 'Ollama is not reachable. Start it with "ollama serve".' };
    }

    const resolved = resolveInstalled(tags);
    if (!resolved) {
      return {
        ...descriptor,
        detail: `Ollama is running but ${OLLAMA_MODEL} is not installed. Run "ollama pull ${OLLAMA_MODEL}".`,
      };
    }

    return {
      ...descriptor,
      id: resolved,
      available: true,
      detail: resolved === OLLAMA_MODEL ? 'Ready' : `Running ${OLLAMA_MODEL}; using the installed tag ${resolved}.`,
    };
  }

  public async generateSql(model: string, request: LlmSqlRequest): Promise<LlmSqlResponse> {
    let response: Response;
    try {
      response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: STRUCTURED_FORMAT,
          options: {
            temperature: request.temperature ?? 0.1,
            num_predict: request.maxTokens ?? 1200,
          },
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? requestTimeoutMs),
      });
    } catch (error) {
      throw translateTransportError(error, this.id, 'Ollama');
    }

    if (!response.ok) {
      throw await this.describeFailure(response, 'Ollama returned status %s.');
    }

    const data = (await response.json()) as { message?: { content?: string }; error?: string };
    const content = data.message?.content || '';
    const parsed = parseStructuredSqlResponse(content);
    if (!parsed) {
      throw new LlmProviderError(
        'malformed_output',
        this.id,
        data.error || 'Ollama returned a response that was not the requested JSON structure.'
      );
    }
    return parsed;
  }

  /**
   * Ordinary conversation: no `format` constraint, so the model answers in prose.
   *
   * The failure handling is identical to `generateSql` on purpose. Both are the
   * same server and the same model, so "Ollama stopped responding" and "Ollama
   * ran out of memory" mean exactly the same thing to the user whichever kind
   * of request they made; only the answer format differs.
   */
  public async chat(model: string, request: LlmChatRequest): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          // Constrained decoding, used only by the intent router. Ollama's
          // `format` accepts a JSON Schema and guarantees the reply's shape.
          ...(request.jsonSchema ? { format: request.jsonSchema } : {}),
          options: {
            temperature: request.temperature ?? 0.7,
            num_predict: request.maxTokens ?? 1500,
          },
          messages: [
            { role: 'system', content: request.systemPrompt },
            ...(request.history ?? []).map((turn: LlmChatTurn) => ({
              role: turn.role,
              content: turn.content,
            })),
            { role: 'user', content: request.userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? requestTimeoutMs),
      });
    } catch (error) {
      throw translateTransportError(error, this.id, 'Ollama');
    }

    if (!response.ok) {
      throw await this.describeFailure(response, 'Ollama returned status %s.');
    }

    const data = (await response.json()) as { message?: { content?: string }; error?: string };
    const content = typeof data.message?.content === 'string' ? data.message.content.trim() : '';
    if (!content) {
      // An empty reply is a normal outcome for a small local model, and it is
      // not something the user can act on. The caller supplies the fallback.
      return '';
    }
    return content;
  }

  /**
   * Turns an HTTP error into the most specific failure reason available.
   *
   * Ollama answers 500 with a diagnostic body when llama.cpp cannot start the
   * model at all. Out-of-memory is the common case when another local provider
   * already holds the GPU, and it is worth distinguishing: the server is running
   * and the model is installed, so "start Ollama" would be wrong advice.
   */
  private async describeFailure(response: Response, fallback: string): Promise<LlmProviderError> {
    const body = await response.text().catch(() => '');
    if (/out[- ]of[- ]memory|cudaMalloc|failed to allocate/i.test(body)) {
      return new LlmProviderError(
        'out_of_memory',
        this.id,
        'Ollama could not allocate enough memory to load the model.',
        response.status
      );
    }
    return new LlmProviderError(
      response.status === 404 ? 'model_not_loaded' : 'request_failed',
      this.id,
      fallback.replace('%s', String(response.status)),
      response.status
    );
  }
}

export const ollamaProvider = new OllamaProvider();

/**
 * Back-compatible availability probe.
 *
 * Retained because the health endpoint and the integration test depend on the
 * previous "any reachable qwen counts as available" behaviour. New code should
 * prefer `ollamaProvider.describe()`, which is stricter and reports why a model
 * is unusable.
 */
export async function checkOllamaStatus(): Promise<{ available: boolean; model?: string }> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    if (!response.ok) return { available: false };
    const data = (await response.json()) as { models?: OllamaTag[] };
    const models = (data.models || []).map(item => item.name || item.model || '').filter(Boolean);
    const configured = models.find(model => model === OLLAMA_MODEL || model === `${OLLAMA_MODEL}:latest`)
      || models.find(model => model.startsWith('qwen2.5-coder'))
      || models.find(model => model.startsWith('qwen'))
      || models[0];
    return configured ? { available: true, model: configured } : { available: false };
  } catch {
    return { available: false };
  }
}