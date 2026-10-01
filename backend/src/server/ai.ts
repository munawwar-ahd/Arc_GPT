import dotenv from 'dotenv';
import {
  LlmProviderError,
  LlmSqlResponse,
  OLLAMA_MODEL,
  OLLAMA_URL,
  ollamaProvider,
  parseStructuredSqlResponse,
} from './llm/index.js';

dotenv.config();

/**
 * Back-compatible facade over the LLM provider layer.
 *
 * ArcGPT now has a router (`src/server/llm/`) with one provider per inference
 * server. This module keeps the original three exports working, so nothing that
 * predates the router has to change: `/api/health`, the integration test and any
 * existing import of `generateStructuredAiResponse`.
 *
 * The routing itself lives in the router. What stays here is only the old
 * "Ollama, and null on failure" contract.
 */

export { OLLAMA_URL, OLLAMA_MODEL };

export interface StructuredAiResponse {
  intent: string;
  tables: string[];
  sql: string;
}

export { checkOllamaStatus } from './llm/ollama.provider.js';

/** Kept for callers that want the engine and address together. */
export async function getActiveLocalAgentStatus(): Promise<{
  engine: 'Ollama' | 'Offline';
  model?: string;
  url: string;
}> {
  const status = await ollamaProvider.describe();
  return status.available
    ? { engine: 'Ollama', model: status.id, url: OLLAMA_URL }
    : { engine: 'Offline', url: OLLAMA_URL };
}

/**
 * Generates SQL through Ollama, preserving the original contract: `null` when
 * Ollama is unreachable, when its model is not installed, or when the reply is
 * not the requested JSON structure. Unexpected transport failures still throw,
 * exactly as before.
 *
 * The query pipeline no longer calls this — it goes through the router so a
 * selected model can be honoured — but anything importing it keeps working.
 */
export async function generateStructuredAiResponse(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}): Promise<LlmSqlResponse | null> {
  const descriptor = await ollamaProvider.describe();
  if (!descriptor.available) return null;

  try {
    return await ollamaProvider.generateSql(descriptor.id, {
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      temperature: params.temperature,
    });
  } catch (error) {
    if (error instanceof LlmProviderError) {
      if (error.reason === 'unavailable' || error.reason === 'malformed_output' || error.reason === 'model_not_loaded') {
        return null;
      }
      throw error;
    }
    throw error;
  }
}

export { parseStructuredSqlResponse };
export type { StructuredAiResponse as StructuredSqlResponse };