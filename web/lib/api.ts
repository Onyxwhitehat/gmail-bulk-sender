/**
 * Typed API client.
 *
 * Everything goes through `request()`, which attaches credentials, echoes the CSRF
 * cookie into the `X-CSRF-Token` header, and turns error responses into a thrown
 * `ApiError` carrying the server's message — so callers can surface real text to
 * the user instead of "something went wrong".
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the user simply needs to sign in again. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip JSON parsing (used for file downloads). */
  raw?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;
  const method = rest.method ?? (body === undefined ? 'GET' : 'POST');

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  // The backend uses double-submit CSRF: the cookie is readable, and echoing it
  // back in a header proves the request came from our own origin.
  const csrf = readCookie('bes_csrf');
  if (csrf) finalHeaders['X-CSRF-Token'] = csrf;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      method,
      headers: finalHeaders,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      `Cannot reach the API at ${API_URL}. Check that the backend is running and NEXT_PUBLIC_API_URL is correct.`,
      'network_error',
    );
  }

  if (raw) {
    if (!response.ok) throw new ApiError(response.status, await response.text(), 'error');
    return (await response.text()) as T;
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text.slice(0, 300) };
    }
  }

  if (!response.ok) {
    const data = (payload ?? {}) as { error?: string; code?: string; details?: unknown };
    throw new ApiError(
      response.status,
      data.error ?? `Request failed with status ${response.status}`,
      data.code ?? 'error',
      data.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Triggers a browser download for an authenticated endpoint.
 * A plain <a href> would not carry the session cookie cross-origin, so the file
 * is fetched, turned into a blob, and handed to a synthetic link.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text.slice(0, 300) || 'Download failed');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
