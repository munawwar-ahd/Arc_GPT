import { LlmSqlResponse } from './types.js';

/**
 * Turns a model's reply into `{ intent, tables, sql }`.
 *
 * Both providers are asked for JSON, but neither can be *trusted* to return
 * only JSON: a small local model wraps it in a fence, prepends "Sure!", or
 * returns prose when it cannot answer. So this is deliberately forgiving about
 * framing and completely strict about shape — anything that is not an object
 * with three usable fields is rejected, and the caller treats that as a
 * malformed generation rather than trying to rescue it.
 *
 * It never repairs or rewrites `sql`. The validator downstream is the only
 * thing allowed to decide whether a statement is safe, and it must see exactly
 * what the model produced.
 */
export function parseStructuredSqlResponse(content: string): LlmSqlResponse | null {
  if (typeof content !== 'string' || !content.trim()) return null;

  let candidate = content.trim();

  // Unwrap a fenced block, allowing for a fence that opens after a short
  // preamble ("Here is the JSON:\n```json ... ```").
  const fence = candidate.match(/```(?:json|sql)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1];

  candidate = candidate.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // A bare object on its own is the common case; anything else is tried as a
  // substring so a leading or trailing sentence does not discard a good answer.
  const attempt = (text: string): LlmSqlResponse | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const value = parsed as Record<string, unknown>;
    if (typeof value.intent !== 'string' || !Array.isArray(value.tables) || typeof value.sql !== 'string') {
      return null;
    }

    const tables = value.tables
      .filter((table): table is string => typeof table === 'string')
      .map(table => table.trim().toLowerCase())
      .filter(Boolean);

    const sql = value.sql.trim();
    if (!sql || tables.length === 0) return null;
    return { intent: value.intent.trim() || 'database query', tables, sql };
  };

  const direct = attempt(candidate);
  if (direct) return direct;

  // Salvage only when the content was not JSON in the first place.
  //
  // The distinction matters: a reply that parses cleanly as JSON but has the
  // wrong shape — an array, an object missing `sql` — is a model that did not
  // follow the contract, and re-slicing the first `{...}` out of it would let
  // an unexpected wrapper through. Prose wrapped around a genuine object is the
  // case worth rescuing.
  let parsedWhole: unknown;
  try {
    parsedWhole = JSON.parse(candidate);
  } catch {
    parsedWhole = undefined;
  }
  if (parsedWhole !== undefined) return null;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) return attempt(candidate.slice(start, end + 1));

  return null;
}