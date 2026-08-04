import { randomBytes } from 'node:crypto';
import { config, GOOGLE_SCOPES } from '../config.js';
import { all, get, run } from '../db/index.js';
import { encrypt, tryDecrypt } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getSetting } from './settings.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Refresh this far before actual expiry so a long send never trips over it mid-flight. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface AccountRow {
  id: number;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: number | null;
  scope: string | null;
  is_default: number;
  connected_at: string | null;
  last_refreshed_at: string | null;
  last_error: string | null;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getOAuthCredentials(): OAuthCredentials {
  const clientId = getSetting('google_client_id');
  const clientSecret = getSetting('google_client_secret');
  const redirectUri = getSetting('google_redirect_uri') || `${config.apiUrl}/api/google/callback`;

  if (!clientId || !clientSecret) {
    throw AppError.badRequest(
      'Google OAuth is not configured. Add your Client ID and Client Secret on the Gmail Connection page first.',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// ---------------------------------------------------------------------------
// Authorisation handshake
// ---------------------------------------------------------------------------

/** Creates a single-use `state` nonce and returns the Google consent URL. */
export function buildAuthUrl(userId: number): string {
  const { clientId, redirectUri } = getOAuthCredentials();

  const state = randomBytes(24).toString('base64url');
  run('INSERT INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)', state, userId, Date.now());
  run('DELETE FROM oauth_states WHERE created_at < ?', Date.now() - 15 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // `offline` + `consent` guarantees a refresh_token even on a repeat authorisation.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export function consumeState(state: string): number | null {
  const row = get<{ user_id: number; created_at: number }>(
    'SELECT user_id, created_at FROM oauth_states WHERE state = ?',
    state,
  );
  run('DELETE FROM oauth_states WHERE state = ?', state);
  if (!row) return null;
  if (Date.now() - row.created_at > 15 * 60 * 1000) return null;
  return row.user_id;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }

  if (!response.ok) {
    const error = String(payload.error ?? '');
    const description = String(payload.error_description ?? payload.error ?? text.slice(0, 300));

    // A 4xx from the token endpoint is never transient: the grant was revoked
    // (`invalid_grant`) or the client credentials are wrong (`invalid_client`).
    // Retrying just reproduces the same failure for every remaining recipient, so
    // these are flagged fatal and the caller stops the run instead of grinding on.
    if (response.status >= 400 && response.status < 500) {
      const fatalCode = error === 'invalid_grant' ? 'reauth_required' : 'auth_config_error';
      throw new AppError(401, `Google rejected the token request: ${description}`, fatalCode, {
        status: response.status,
        error,
      });
    }

    throw AppError.upstream(`Google token endpoint is unavailable: ${description}`, {
      status: response.status,
      error,
    });
  }
  return payload as unknown as TokenResponse;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = getOAuthCredentials();
  return postToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  );
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw AppError.upstream('Could not read the Google account profile after authorisation.');
  }
  const profile = (await response.json()) as { email?: string };
  if (!profile.email) throw AppError.upstream('Google did not return an email address for this account.');
  return profile.email.toLowerCase();
}

/** Persists a newly authorised account (or refreshes the tokens of an existing one). */
export async function saveAccountFromTokens(tokens: TokenResponse): Promise<AccountRow> {
  const email = await fetchUserEmail(tokens.access_token);
  const expiry = Date.now() + tokens.expires_in * 1000;
  const existing = get<AccountRow>('SELECT * FROM accounts WHERE email = ?', email);

  if (existing) {
    run(
      `UPDATE accounts
         SET access_token = ?, token_expiry = ?, scope = ?, connected_at = datetime('now'),
             last_refreshed_at = datetime('now'), last_error = NULL
             ${tokens.refresh_token ? ', refresh_token = ?' : ''}
       WHERE id = ?`,
      ...(tokens.refresh_token
        ? [encrypt(tokens.access_token), expiry, tokens.scope ?? '', encrypt(tokens.refresh_token), existing.id]
        : [encrypt(tokens.access_token), expiry, tokens.scope ?? '', existing.id]),
    );
  } else {
    if (!tokens.refresh_token) {
      throw AppError.badRequest(
        'Google did not return a refresh token. Remove this app from your Google account permissions and connect again.',
      );
    }
    run(
      `INSERT INTO accounts (email, access_token, refresh_token, token_expiry, scope, is_default, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      email,
      encrypt(tokens.access_token),
      encrypt(tokens.refresh_token),
      expiry,
      tokens.scope ?? '',
      countAccounts() === 0 ? 1 : 0,
    );
  }

  const saved = get<AccountRow>('SELECT * FROM accounts WHERE email = ?', email);
  if (!saved) throw new AppError(500, 'Failed to persist the connected account');
  if (countAccounts() === 1) run('UPDATE accounts SET is_default = 1 WHERE id = ?', saved.id);
  logger.info(`connected Google account ${email}`);
  return saved;
}

// ---------------------------------------------------------------------------
// Token lifecycle
// ---------------------------------------------------------------------------

export function countAccounts(): number {
  return get<{ count: number }>('SELECT COUNT(*) AS count FROM accounts')?.count ?? 0;
}

export function listAccounts(): AccountRow[] {
  return all<AccountRow>('SELECT * FROM accounts ORDER BY is_default DESC, id ASC');
}

export function getAccount(id: number): AccountRow | undefined {
  return get<AccountRow>('SELECT * FROM accounts WHERE id = ?', id);
}

export function getDefaultAccount(): AccountRow | undefined {
  return (
    get<AccountRow>('SELECT * FROM accounts WHERE is_default = 1') ??
    get<AccountRow>('SELECT * FROM accounts ORDER BY id ASC LIMIT 1')
  );
}

/**
 * Returns a usable access token for the account, refreshing it first when it is
 * expired or close to expiring. This is the single entry point every Google API
 * call goes through, so token refresh is automatic everywhere.
 */
export async function getAccessToken(accountId: number): Promise<string> {
  const account = getAccount(accountId);
  if (!account) throw AppError.notFound('That Gmail account is no longer connected.');

  const accessToken = tryDecrypt(account.access_token);
  const stillFresh = account.token_expiry !== null && account.token_expiry - REFRESH_SKEW_MS > Date.now();
  if (accessToken && stillFresh) return accessToken;

  return refreshAccessToken(account);
}

export async function refreshAccessToken(account: AccountRow): Promise<string> {
  const refreshToken = tryDecrypt(account.refresh_token);
  if (!refreshToken) {
    markAccountError(account.id, 'Refresh token missing. Reconnect this Gmail account.');
    throw new AppError(401, 'This Gmail account needs to be reconnected (no refresh token stored).', 'reauth_required');
  }

  const { clientId, clientSecret } = getOAuthCredentials();

  try {
    const tokens = await postToken(
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    );

    run(
      `UPDATE accounts
          SET access_token = ?, token_expiry = ?, last_refreshed_at = datetime('now'), last_error = NULL
              ${tokens.refresh_token ? ', refresh_token = ?' : ''}
        WHERE id = ?`,
      ...(tokens.refresh_token
        ? [encrypt(tokens.access_token), Date.now() + tokens.expires_in * 1000, encrypt(tokens.refresh_token), account.id]
        : [encrypt(tokens.access_token), Date.now() + tokens.expires_in * 1000, account.id]),
    );

    logger.debug(`refreshed access token for ${account.email}`);
    return tokens.access_token;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed';
    markAccountError(account.id, message);

    if (error instanceof AppError && error.code === 'reauth_required') {
      throw new AppError(
        401,
        'Google revoked this authorisation. Please reconnect the Gmail account.',
        'reauth_required',
      );
    }
    if (error instanceof AppError && error.code === 'auth_config_error') {
      throw new AppError(
        401,
        `Google rejected your OAuth credentials: ${message}. Check the Client ID and Client Secret on the Gmail Connection page.`,
        'auth_config_error',
      );
    }
    throw error;
  }
}

export function markAccountError(accountId: number, message: string): void {
  run('UPDATE accounts SET last_error = ? WHERE id = ?', message.slice(0, 500), accountId);
}

export function setDefaultAccount(accountId: number): void {
  run('UPDATE accounts SET is_default = 0');
  run('UPDATE accounts SET is_default = 1 WHERE id = ?', accountId);
}

export async function disconnectAccount(accountId: number): Promise<void> {
  const account = getAccount(accountId);
  if (!account) throw AppError.notFound('Account not found');

  // Best effort: tell Google to drop the grant. Local removal happens either way.
  const token = tryDecrypt(account.refresh_token) || tryDecrypt(account.access_token);
  if (token) {
    try {
      await fetch(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
    } catch (error) {
      logger.warn('token revocation failed (removing locally anyway)', error);
    }
  }

  const wasDefault = account.is_default === 1;
  run('DELETE FROM accounts WHERE id = ?', accountId);

  if (wasDefault) {
    const next = get<AccountRow>('SELECT * FROM accounts ORDER BY id ASC LIMIT 1');
    if (next) run('UPDATE accounts SET is_default = 1 WHERE id = ?', next.id);
  }
  logger.info(`disconnected Google account ${account.email}`);
}

/** Shape returned to the dashboard — never includes token material. */
export function publicAccount(account: AccountRow) {
  const expiry = account.token_expiry ?? 0;
  return {
    id: account.id,
    email: account.email,
    isDefault: account.is_default === 1,
    connectedAt: account.connected_at,
    lastRefreshedAt: account.last_refreshed_at,
    lastError: account.last_error,
    accessToken: {
      present: Boolean(tryDecrypt(account.access_token)),
      expiresAt: expiry ? new Date(expiry).toISOString() : null,
      expired: expiry ? expiry <= Date.now() : true,
      expiresInSeconds: expiry ? Math.max(0, Math.round((expiry - Date.now()) / 1000)) : 0,
    },
    refreshToken: {
      present: Boolean(tryDecrypt(account.refresh_token)),
    },
    scopes: (account.scope ?? '').split(' ').filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Authenticated request helper
// ---------------------------------------------------------------------------

export interface GoogleRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Set for endpoints that return non-JSON. */
  raw?: boolean;
}

/**
 * Calls a Google API with the account's token, retrying once after a forced token
 * refresh if the API answers 401 (the token was revoked between our check and the call).
 */
export async function googleFetch<T>(
  accountId: number,
  url: string,
  options: GoogleRequestOptions = {},
): Promise<T> {
  const attempt = async (token: string): Promise<Response> =>
    fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  let token = await getAccessToken(accountId);
  let response = await attempt(token);

  if (response.status === 401) {
    const account = getAccount(accountId);
    if (account) {
      token = await refreshAccessToken(account);
      response = await attempt(token);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; status?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep raw text */
    }
    throw mapGoogleError(response.status, message);
  }

  return (options.raw ? await response.text() : await response.json()) as T;
}

/** Translates Google's HTTP codes into messages that tell the user what to do. */
export function mapGoogleError(status: number, message: string): AppError {
  switch (status) {
    case 401:
      return new AppError(401, `Google authorisation expired: ${message}. Reconnect the account.`, 'reauth_required');
    case 403:
      if (/quota|rate|limit/i.test(message)) {
        return new AppError(429, `Google rate limit reached: ${message}`, 'rate_limited');
      }
      return new AppError(
        403,
        `Google denied access: ${message}. Check that the required API is enabled and the account has permission.`,
        'google_forbidden',
      );
    case 404:
      return new AppError(404, `Google could not find that resource: ${message}`, 'not_found');
    case 429:
      return new AppError(429, `Google rate limit reached: ${message}`, 'rate_limited');
    default:
      return new AppError(status >= 500 ? 502 : status, `Google API error: ${message}`, 'google_error');
  }
}
