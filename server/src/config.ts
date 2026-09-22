import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy server/.env.example to server/.env and fill it in.`,
    );
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

/**
 * In development we tolerate missing secrets by deriving deterministic ones, so the
 * app boots on a fresh clone. In production we refuse to start without real values —
 * a generated-at-boot secret would silently invalidate sessions and, worse, make
 * stored OAuth refresh tokens undecryptable after a restart.
 */
function secret(name: string, devFallbackSeed: string): string {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (isProduction) {
    throw new Error(
      `${name} must be set to a strong random value (>= 32 chars) in production. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }
  // eslint-disable-next-line no-console
  console.warn(`[config] ${name} is not set — using an insecure development default.`);
  return createHash('sha256').update(`dev-only::${devFallbackSeed}`).digest('base64url');
}

const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const apiUrl = (process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, '');

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * True when the dashboard and the API are served from different hosts — for
 * example a Vercel frontend talking to a Railway backend.
 *
 * This matters because browsers only attach `SameSite=Lax` cookies to same-site
 * requests. In a split deployment the session cookie would be silently dropped
 * from every `fetch`, so sign-in appears to succeed and then every subsequent
 * request 401s. Cross-site cookies must be `SameSite=None`, which browsers only
 * accept when `Secure` is also set (so it requires HTTPS on both sides).
 *
 * Note ports are irrelevant to "site", so localhost:3000 -> localhost:4000 stays
 * same-site and keeps the stricter Lax default.
 */
const isCrossSite = Boolean(hostOf(appUrl) && hostOf(apiUrl) && hostOf(appUrl) !== hostOf(apiUrl));

const sameSiteOverride = process.env.COOKIE_SAMESITE?.toLowerCase();
const cookieSameSite: 'lax' | 'none' | 'strict' =
  sameSiteOverride === 'none' || sameSiteOverride === 'lax' || sameSiteOverride === 'strict'
    ? sameSiteOverride
    : isCrossSite
      ? 'none'
      : 'lax';

// `SameSite=None` without `Secure` is rejected outright by every current browser,
// so a cross-site deployment implies secure cookies whether or not it was set.
const secureCookies = process.env.SECURE_COOKIES === 'true' || isProduction || cookieSameSite === 'none';

if (cookieSameSite === 'none' && !apiUrl.startsWith('https://')) {
  // eslint-disable-next-line no-console
  console.warn(
    `[config] APP_URL (${appUrl}) and API_URL (${apiUrl}) are on different hosts, which requires ` +
      'SameSite=None; Secure cookies — but API_URL is not HTTPS. Sign-in will fail until both sides use HTTPS.',
  );
}

export const config = {
  isProduction,
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',

  /** Public URL of the frontend. Used for CORS and post-OAuth redirects. */
  appUrl,
  /** Public URL of this API. Used to build the default OAuth redirect URI. */
  apiUrl,
  isCrossSite,
  cookieSameSite,

  databaseFile: resolve(process.env.DATABASE_FILE ?? './data/app.db'),

  sessionSecret: secret('SESSION_SECRET', 'session'),
  /** Master key for AES-256-GCM encryption of OAuth tokens and the client secret. */
  encryptionKey: secret('ENCRYPTION_KEY', 'encryption'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  cookieName: process.env.COOKIE_NAME ?? 'bes_session',
  csrfCookieName: 'bes_csrf',
  /** True when serving over HTTPS, or forced on by a cross-site deployment. */
  secureCookies,

  /** Optional bootstrap admin. If set, the account is created on first boot. */
  bootstrapAdminEmail: process.env.ADMIN_EMAIL ?? '',
  bootstrapAdminPassword: process.env.ADMIN_PASSWORD ?? '',

  /** Optional fallback Google credentials; the UI-stored values take precedence. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? '',

  trustProxy: process.env.TRUST_PROXY ?? '',
  logLevel: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
} as const;

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export function newId(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export { required };
