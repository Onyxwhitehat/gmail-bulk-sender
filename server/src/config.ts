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

export const config = {
  isProduction,
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',

  /** Public URL of the frontend. Used for CORS and post-OAuth redirects. */
  appUrl: (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  /** Public URL of this API. Used to build the default OAuth redirect URI. */
  apiUrl: (process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, ''),

  databaseFile: resolve(process.env.DATABASE_FILE ?? './data/app.db'),

  sessionSecret: secret('SESSION_SECRET', 'session'),
  /** Master key for AES-256-GCM encryption of OAuth tokens and the client secret. */
  encryptionKey: secret('ENCRYPTION_KEY', 'encryption'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  cookieName: process.env.COOKIE_NAME ?? 'bes_session',
  csrfCookieName: 'bes_csrf',
  /** Set to true when serving over HTTPS (required for `Secure` cookies). */
  secureCookies: process.env.SECURE_COOKIES === 'true' || isProduction,

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
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export function newId(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export { required };
