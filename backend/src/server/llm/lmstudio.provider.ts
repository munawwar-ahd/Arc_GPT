import dotenv from 'dotenv';
import { LlmProvider, LlmModelDescriptor, LlmProviderError, LlmSqlRequest, LlmSqlResponse, LlmChatRequest, LlmChatTurn } from './types.js';
import { parseStructuredSqlResponse } from './structured-output.js';
import { translateTransportError } from './ollama.provider.js';

dotenv.config();

/**
 * LM Studio provider — the optional second ArcGPT engine.
 *
 * LM Studio serves an OpenAI-compatible API, so the wire format is
 * `POST {base}/chat/completions` with `messages`. What is *not* guessed is the
 * model identifier: LM Studio uses the folder name of the downloaded model,
 * which for the Qwen3 coder release is a long repository-style slug that cannot
 * be reliably typed from memory.
 *
 * So the id is always resolved from the running server (`/v1/models`, falling
 * back to the native `/api/v0/models` listing) rather than assumed.
 * `LMSTUDIO_MODEL` is honoured when it names something the server actually
 * reports, and is otherwise reported as unresolved — with the real ids listed —
 * so a wrong guess can never be silently sent.
 */

const configuredBase = (process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1').replace(/\/$/, '');

export const LMSTUDIO_URL = configuredBase;
export const LMSTUDIO_MODEL = (process.env.LMSTUDIO_MODEL || '').trim();

const probeTimeoutMs = Number(process.env.LMSTUDIO_PROBE_TIMEOUT_MS || 3000);
const requestTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS || 180000);

interface DiscoveredModel {
  id: string;
  /** LM Studio's native listing also reports whether the model is loaded. */
  loaded?: boolean;
}

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

/** `http://localhost:1234/v1` → `http://localhost:1234/api/v0/models`. */
function nativeModelsUrl(baseUrl: string): string {
  return `${originOf(baseUrl)}/api/v0/models`;
}

async function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function readOpenAiList(payload: unknown): DiscoveredModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map(entry => ({ id: typeof entry?.id === 'string' ? entry.id.trim() : '' }))
    .filter(model => model.id.length > 0);
}

function readNativeList(payload: unknown): DiscoveredModel[] {
  const data = (payload as { data?: unknown })?.data;
  const list = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
  return list
    .map(entry => {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : typeof entry?.path === 'string' ? String(entry.path).split(/[\\/]/).pop() || '' : '';
      const state = typeof entry?.state === 'string' ? entry.state.toLowerCase() : '';
      return { id, loaded: state === '' ? true : state === 'loaded' };
    })
    .filter(model => model.id.length > 0);
}

/**
 * Asks the running server what it has.
 *
 * `/v1/models` is authoritative for what can be served right now. LM Studio's
 * native listing is consulted as a fallback because it also reports models
 * that are downloaded but not yet loaded — useful information, since the honest
 * answer there is "installed, but not loaded".
 */
async function discoverModels(): Promise<{ reachable: boolean; models: DiscoveredModel[] }> {
  const compat = await getJson(`${LMSTUDIO_URL}/models`, probeTimeoutMs);
  const fromCompat = readOpenAiList(compat);
  if (fromCompat.length > 0) return { reachable: true, models: fromCompat };

  const native = await getJson(nativeModelsUrl(LMSTUDIO_URL), probeTimeoutMs);
  const fromNative = readNativeList(native);
  if (fromNative.length > 0) return { reachable: true, models: fromNative };

  // `/api/v0/models` answering at all proves the server is up; an empty list is
  // a real (if unhelpful) state rather than an unreachable server.
  return { reachable: compat !== null || native !== null, models: [] };
}

/**
 * Ranks candidate ids so a coder model beats a base model.
 *
 * Only ever used when `LMSTUDIO_MODEL` is unset or names nothing the server
 * reports. It is a preference order, not a guess: if several models are loaded
 * and none matches, the first is returned and the selector shows every option,
 * so the user can choose. Nothing is invented — every candidate here came from
 * the server's own listing.
 */
function scoreCandidate(id: string): number {
  const value = id.toLowerCase();
  let score = 0;
  if (value.includes('coder')) score += 100;
  if (value.includes('qwen3')) score += 60;
  if (value.includes('qwen')) score += 20;
  if (value.includes('instruct') || value.includes('chat')) score += 10;
  if (/\b30b\b/.test(value) || value.includes('30b')) score += 8;
  if (value.includes('a3b')) score += 4;
  if (value.includes('gguf')) score += 2;
  return score;
}

function pickBest(models: DiscoveredModel[]): DiscoveredModel | null {
  if (models.length === 0) return null;
  return [...models].sort((a, b) => {
    const byLoaded = Number(Boolean(b.loaded)) - Number(Boolean(a.loaded));
    if (byLoaded !== 0) return byLoaded;
    const byScore = scoreCandidate(b.id) - scoreCandidate(a.id);
    if (byScore !== 0) return byScore;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Turns a slug into something a person can read in a dropdown.
 *
 * The two families ArcGPT ships with are named explicitly; anything else falls
 * back to a prettified id so an unrecognised model is still selectable rather
 * than invisible.
 */
export function displayNameForModel(id: string): string {
  const value = id.toLowerCase();
  if (value.includes('qwen3') && value.includes('coder')) {
    return /30b/.test(value) ? 'Qwen3-Coder 30B' : 'Qwen3-Coder';
  }
  if (value.includes('qwen2.5') && value.includes('coder')) {
    return /7b/.test(value) ? 'Qwen2.5-Coder 7B' : 'Qwen2.5-Coder';
  }
  if (value.includes('qwen3')) return 'Qwen3';
  return id
    .replace(/\.gguf$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

export class LmStudioProvider implements LlmProvider {
  public readonly id = 'lmstudio' as const;
  public readonly label = 'LM Studio';
  public readonly baseUrl = LMSTUDIO_URL;
  public readonly configuredModel = LMSTUDIO_MODEL;

  public async describe(): Promise<LlmModelDescriptor> {
    const { reachable, models } = await discoverModels();

    if (!reachable) {
      return {
        id: LMSTUDIO_MODEL || 'lmstudio',
        name: LMSTUDIO_MODEL ? displayNameForModel(LMSTUDIO_MODEL) : 'LM Studio model',
        provider: this.id,
        providerLabel: this.label,
        available: false,
        detail: 'LM Studio is not reachable. Start its local server, then reload this model list.',
      };
    }

    const listed = models.map(model => model.id);
    const listedLower = new Set(listed.map(value => value.toLowerCase()));
    const candidate = LMSTUDIO_MODEL && listedLower.has(LMSTUDIO_MODEL.toLowerCase())
      ? models.find(model => model.id.toLowerCase() === LMSTUDIO_MODEL.toLowerCase())!
      : pickBest(models);

    if (!candidate) {
      return {
        id: LMSTUDIO_MODEL || 'lmstudio',
        name: LMSTUDIO_MODEL ? displayNameForModel(LMSTUDIO_MODEL) : 'LM Studio model',
        provider: this.id,
        providerLabel: this.label,
        available: false,
        detail: 'LM Studio is running but has no model loaded.',
      };
    }

    const isConfiguredMatch = LMSTUDIO_MODEL
      ? candidate.id.toLowerCase() === LMSTUDIO_MODEL.toLowerCase()
      : false;
    const loaded = candidate.loaded !== false;

    if (!loaded) {
      return {
        id: candidate.id,
        name: displayNameForModel(candidate.id),
        provider: this.id,
        providerLabel: this.label,
        available: false,
        detail: `${candidate.id} is downloaded but not loaded. Load it in LM Studio, then try again.`,
      };
    }

    const mismatchedConfig = LMSTUDIO_MODEL && !isConfiguredMatch
      ? ` LMSTUDIO_MODEL=${LMSTUDIO_MODEL} was not found on the server, so the best match below is used.`
      : '';

    return {
      id: candidate.id,
      name: displayNameForModel(candidate.id),
      provider: this.id,
      providerLabel: this.label,
      available: true,
      detail: `Detected from the LM Studio server.${mismatchedConfig}`,
    };
  }

  private async request(model: string, body: Record<string, unknown>, jsonMode: boolean): Promise<unknown> {
    const payload = jsonMode ? { ...body, response_format: { type: 'json_object' } } : body;
    let response: Response;
    try {
      response = await fetch(`${LMSTUDIO_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      throw translateTransportError(error, this.id, 'LM Studio');
    }

    if (!response.ok) {
      // Same reasoning as the Ollama provider: a local server that cannot
      // allocate memory for the model is running and configured, so the advice
      // must be about unloading the other model, not about starting this one.
      const body = await response.text().catch(() => '');
      if (/out[- ]of[- ]memory|cudaMalloc|failed to allocate|insufficient (gpu )?(memory|resources)/i.test(body)) {
        throw new LlmProviderError(
          'out_of_memory',
          this.id,
          'LM Studio could not allocate enough memory to load the model.',
          response.status
        );
      }
      throw new LlmProviderError(
        response.status === 404 ? 'model_not_loaded' : 'request_failed',
        this.id,
        `LM Studio returned status ${response.status}.`,
        response.status
      );
    }
    return response.json();
  }

  public async generateSql(model: string, request: LlmSqlRequest): Promise<LlmSqlResponse> {
    const body: Record<string, unknown> = {
      model,
      stream: false,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1200,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    };

    let data: any;
    try {
      data = await this.request(model, body, true);
    } catch (error) {
      // Older LM Studio builds reject `response_format`. Dropping it costs
      // grammar-constrained decoding but the JSON is still requested in the
      // prompt, so the request succeeds instead of failing outright.
      if (error instanceof LlmProviderError && error.reason === 'request_failed' && error.status === 400) {
        data = await this.request(model, body, false);
      } else {
        throw error;
      }
    }

    const content = typeof data?.choices?.[0]?.message?.content === 'string'
      ? data.choices[0].message.content
      : '';
    const parsed = parseStructuredSqlResponse(content);
    if (!parsed) {
      throw new LlmProviderError(
        'malformed_output',
        this.id,
        data?.error?.message || 'LM Studio returned a response that was not the requested JSON structure.'
      );
    }
    return parsed;
  }

  /**
   * Ordinary conversation over the same OpenAI-compatible endpoint.
   *
   * `jsonMode` is false, so no `response_format` is attached — asking for JSON
   * here is exactly the bug that made "hi" fail. Everything else about the call
   * is identical to `generateSql`, including the model id, so a user who picks
   * Qwen3-Coder 30B for chat gets exactly the weights they selected for SQL.
   */
  public async chat(model: string, request: LlmChatRequest): Promise<string> {
    const body: Record<string, unknown> = {
      model,
      stream: false,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 1500,
      messages: [
        { role: 'system', content: request.systemPrompt },
        ...(request.history ?? []).map((turn: LlmChatTurn) => ({
          role: turn.role,
          content: turn.content,
        })),
        { role: 'user', content: request.userPrompt },
      ],
    };

    // Constrained decoding, used only by the intent router. Some LM Studio
    // builds reject `response_format` outright — Qwen3-Coder does — and
    // `generateSql` already handles that by retrying without it. The router
    // needs the same fallback, or intent detection fails open on one engine and
    // works on the other, which is the worst possible asymmetry: the same
    // question would be answered from the database by Ollama and declined by
    // LM Studio. The router prompt still asks for JSON, and its parser is
    // forgiving, so the retry produces the same verdict.
    if (!request.jsonSchema) return this.readContent(await this.request(model, body, false));

    let data: unknown;
    try {
      data = await this.request(model, body, true);
    } catch (error) {
      if (error instanceof LlmProviderError && error.reason === 'request_failed' && error.status === 400) {
        data = await this.request(model, body, false);
      } else {
        throw error;
      }
    }
    return this.readContent(data);
  }

  private readContent(data: unknown): string {
    const content = (data as any)?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  }
}

export const lmStudioProvider = new LmStudioProvider();