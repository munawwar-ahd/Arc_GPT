import dotenv from 'dotenv';

dotenv.config();

export const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
// Note the tag format. Ollama models are named `repo:tag`. The previous default
// of `qwen2.5-coder-7b-instruct` is a Hugging Face style name that does not
// exist in the Ollama registry, so pulling it fails with
// "pull model manifest: file does not exist".
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b';

export interface StructuredAiResponse {
  intent: string;
  tables: string[];
  sql: string;
}

export async function checkOllamaStatus(): Promise<{ available: boolean; model?: string }> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return { available: false };
    const data = await response.json() as { models?: Array<{ name?: string; model?: string }> };
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

export async function getActiveLocalAgentStatus(): Promise<{
  engine: 'Ollama' | 'Offline';
  model?: string;
  url: string;
}> {
  const status = await checkOllamaStatus();
  return status.available
    ? { engine: 'Ollama', model: status.model, url: OLLAMA_URL }
    : { engine: 'Offline', url: OLLAMA_URL };
}

function parseStructuredContent(content: string): StructuredAiResponse | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Record<string, unknown>;
  if (typeof value.intent !== 'string' || !Array.isArray(value.tables) || typeof value.sql !== 'string') return null;
  const tables = value.tables.filter((table): table is string => typeof table === 'string').map(table => table.toLowerCase());
  const sql = value.sql.trim();
  if (!sql || tables.length === 0) return null;
  return { intent: value.intent, tables, sql };
}

export async function generateStructuredAiResponse(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}): Promise<StructuredAiResponse | null> {
  const status = await checkOllamaStatus();
  if (!status.available || !status.model) return null;

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model: status.model,
      stream: false,
      format: {
        type: 'object',
        properties: {
          intent: { type: 'string' },
          tables: { type: 'array', items: { type: 'string' } },
          sql: { type: 'string' },
        },
        required: ['intent', 'tables', 'sql'],
      },
      options: {
        temperature: params.temperature ?? 0.1,
        num_predict: 1200,
      },
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}.`);
  }
  const data = await response.json() as { message?: { content?: string } };
  const content = data.message?.content;
  return content ? parseStructuredContent(content) : null;
}
