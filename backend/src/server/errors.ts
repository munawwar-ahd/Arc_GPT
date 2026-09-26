/**
 * Turns an unknown thrown value into a message worth showing.
 *
 * This exists because `error.message` is not reliably populated. `pg` reports a
 * refused or unresolvable connection as an `AggregateError` whose `message` is
 * the empty string and whose only useful detail is on `code`
 * (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`). Every `error.message` in this
 * codebase therefore printed a blank line at best — and in the route handlers
 * that forward the message to the client, returned `{"error": ""}`, which tells
 * the caller nothing at all.
 *
 * Prefer this over `error instanceof Error ? error.message : '...'`.
 */
export function describeError(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    if (message) return message;

    // No usable message. Fall back to the error's identity, e.g. a connection
    // failure becomes "AggregateError ECONNREFUSED".
    const code = (error as { code?: unknown }).code;
    const parts = [error.name, typeof code === 'string' && code ? code : undefined].filter(
      (part): part is string => Boolean(part)
    );
    const label = parts.join(' ');
    if (label && label !== 'Error') return label;
    return fallback;
  }

  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}
