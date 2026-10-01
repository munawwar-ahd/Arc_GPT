/**
 * The single seam between the ArcGPT UI and ArcGPT-Backend.
 *
 * The chat and admin surfaces are not allowed to know anything backend-specific:
 * no base URL, no cookie handling, no error shape, no status vocabulary. They
 * call the small typed helpers below and receive plain data.
 *
 * Why this layer exists at all, when the two projects' payloads already line up:
 *
 *  - `VITE_BACKEND_URL` is the only place a backend address is allowed to
 *    appear. It defaults to empty, which means same-origin, which is the normal
 *    deployment: the Express server serves this bundle *and* the API, so the
 *    `sameSite: 'strict'` session cookie is always presented.
 *  - The session cookie is HTTP-only, so the browser attaches it on its own.
 *    `credentials: 'include'` is what makes that happen for the cross-origin
 *    case too.
 *  - A 401 means "no usable session". In development the backend answers this
 *    with a bootstrap session on the very next request, so the failure is
 *    retried once transparently rather than surfacing as a broken chat.
 *  - The backend's `status` vocabulary is wider than the original frontend's
 *    (`empty` and `unauthorized` were added with the new backend). Normalising
 *    here keeps that detail out of the components.
 */

const RAW_BASE_URL = __ARCGPT_BACKEND_URL__;

/** Trailing slashes are stripped so joining never produces `//api/...`. */
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Drop-in replacement for `fetch` that resolves the path against
 * `VITE_BACKEND_URL` and attaches the session cookie.
 *
 * The response is passed through untouched, so the admin surfaces' existing
 * `res.ok` checks and `.then(r => r.json())` chains keep working exactly as
 * they did. This exists so the base URL lives in this one file rather than
 * being assumed to be same-origin in a dozen components.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), { ...init, credentials: 'include' });
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
  } catch {
    // A non-JSON error body is not worth surfacing; fall through to the status.
  }
  return `Request failed with status ${response.status}.`;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { ...init, credentials: 'include' });
}

/**
 * Performs the request, retrying once on 401.
 *
 * The retry is deliberately narrow: it exists for the development bootstrap
 * session, where the first call establishes the cookie and the second carries
 * it. Anything that is not a plain 401 — an aborted request, a network error, a
 * 500 from the pipeline — is surfaced immediately so the chat's existing error
 * handling is not delayed.
 */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await send(path, init);
  if (response.status !== 401) return response;

  const retry = await send(path, { ...init, headers: { ...(init.headers ?? {}), 'x-arcgpt-session-retry': '1' } });
  if (retry.status === 401) {
    throw new ApiError('Your ArcGPT session is not active. Sign in again to continue.', 401);
  }
  return retry;
}

/** Performs a request and decodes a JSON response, throwing `ApiError` on failure. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await request(path, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError('ArcGPT could not reach the local backend service.', 0);
  }

  if (!response.ok) throw new ApiError(await readErrorMessage(response), response.status);
  return (await response.json()) as T;
}

/** Performs a request and discards the response body. */
export async function apiVoid(path: string, init: RequestInit = {}): Promise<void> {
  let response: Response;
  try {
    response = await request(path, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError('ArcGPT could not reach the local backend service.', 0);
  }
  if (!response.ok) throw new ApiError(await readErrorMessage(response), response.status);
}

export function apiPost(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    ...(signal ? { signal } : {}),
  };
}
