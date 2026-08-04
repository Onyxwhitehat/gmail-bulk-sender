import { all, get, run } from '../db/index.js';
import { encrypt, maskSecret, tryDecrypt } from '../lib/crypto.js';
import { config } from '../config.js';

/** Every setting the app understands, with its default and whether it is a secret. */
export const SETTING_DEFS = {
  google_client_id: { default: '', secret: false },
  google_client_secret: { default: '', secret: true },
  google_redirect_uri: { default: '', secret: false },
  sender_name: { default: '', secret: false },
  reply_to: { default: '', secret: false },
  delay_min_ms: { default: '2000', secret: false },
  delay_max_ms: { default: '5000', secret: false },
  daily_limit: { default: '450', secret: false },
  max_retries: { default: '3', secret: false },
  signature_html: { default: '', secret: false },
  batch_pause_every: { default: '0', secret: false },
  batch_pause_ms: { default: '60000', secret: false },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;

interface SettingRow {
  key: string;
  value: string | null;
  encrypted: number;
}

/** Reads a single setting, transparently decrypting secrets. */
export function getSetting(key: SettingKey): string {
  const row = get<SettingRow>('SELECT key, value, encrypted FROM settings WHERE key = ?', key);
  if (!row || row.value === null || row.value === '') {
    return envFallback(key) || SETTING_DEFS[key].default;
  }
  return row.encrypted ? tryDecrypt(row.value) : row.value;
}

export function getNumberSetting(key: SettingKey): number {
  const parsed = Number(getSetting(key));
  return Number.isFinite(parsed) ? parsed : Number(SETTING_DEFS[key].default);
}

export function setSetting(key: SettingKey, value: string): void {
  const isSecret = SETTING_DEFS[key].secret;
  const stored = isSecret && value ? encrypt(value) : value;
  run(
    `INSERT INTO settings (key, value, encrypted, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted, updated_at = datetime('now')`,
    key,
    stored,
    isSecret ? 1 : 0,
  );
}

/** `.env` values act as a fallback when nothing has been saved through the UI. */
function envFallback(key: SettingKey): string {
  switch (key) {
    case 'google_client_id':
      return config.googleClientId;
    case 'google_client_secret':
      return config.googleClientSecret;
    case 'google_redirect_uri':
      return config.googleRedirectUri || `${config.apiUrl}/api/google/callback`;
    default:
      return '';
  }
}

export interface PublicSettings {
  google_client_id: string;
  /** Masked — the real secret never leaves the backend. */
  google_client_secret_masked: string;
  google_client_secret_set: boolean;
  google_redirect_uri: string;
  sender_name: string;
  reply_to: string;
  delay_min_ms: number;
  delay_max_ms: number;
  daily_limit: number;
  max_retries: number;
  signature_html: string;
  batch_pause_every: number;
  batch_pause_ms: number;
}

/** Settings shaped for the dashboard. Secrets are masked, never sent in the clear. */
export function getPublicSettings(): PublicSettings {
  const secret = getSetting('google_client_secret');
  return {
    google_client_id: getSetting('google_client_id'),
    google_client_secret_masked: maskSecret(secret),
    google_client_secret_set: Boolean(secret),
    google_redirect_uri: getSetting('google_redirect_uri') || `${config.apiUrl}/api/google/callback`,
    sender_name: getSetting('sender_name'),
    reply_to: getSetting('reply_to'),
    delay_min_ms: getNumberSetting('delay_min_ms'),
    delay_max_ms: getNumberSetting('delay_max_ms'),
    daily_limit: getNumberSetting('daily_limit'),
    max_retries: getNumberSetting('max_retries'),
    signature_html: getSetting('signature_html'),
    batch_pause_every: getNumberSetting('batch_pause_every'),
    batch_pause_ms: getNumberSetting('batch_pause_ms'),
  };
}

export function listRawSettings(): SettingRow[] {
  return all<SettingRow>('SELECT key, value, encrypted FROM settings ORDER BY key');
}
