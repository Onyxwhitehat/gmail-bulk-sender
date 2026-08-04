export interface SessionUser {
  id: number;
  email: string;
  name: string | null;
}

export interface AuthState {
  needsSetup: boolean;
  authenticated: boolean;
  user: SessionUser | null;
}

export interface GmailAccount {
  id: number;
  email: string;
  isDefault: boolean;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
  accessToken: {
    present: boolean;
    expiresAt: string | null;
    expired: boolean;
    expiresInSeconds: number;
  };
  refreshToken: { present: boolean };
  scopes: string[];
}

export interface AppSettings {
  google_client_id: string;
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

export type EngineState = 'idle' | 'running' | 'paused' | 'cancelling' | 'completed';

export interface ProgressSnapshot {
  state: EngineState;
  campaignId: number | null;
  campaignName: string | null;
  subject: string | null;
  accountEmail: string | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  remaining: number;
  currentIndex: number;
  currentEmail: string | null;
  currentName: string | null;
  startedAt: string | null;
  elapsedMs: number;
  etaMs: number | null;
  perMinute: number;
  lastError: string | null;
  pauseReason: string | null;
  dailySent: number;
  dailyLimit: number;
}

export interface Recipient {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  source: string;
  groupId: number | null;
  unsubscribed: boolean;
  bounced: boolean;
  createdAt: string;
}

export interface RecipientGroup {
  id: number;
  name: string;
  member_count?: number;
  created_at: string;
}

export interface SendLog {
  id: number;
  campaignId: number | null;
  campaignName: string | null;
  accountEmail: string | null;
  recipient: string;
  recipientName: string | null;
  subject: string | null;
  status: 'sent' | 'failed' | 'skipped';
  messageId: string | null;
  error: string | null;
  attempts: number;
  durationMs: number | null;
  createdAt: string;
}

export interface DashboardStats {
  gmail: {
    connected: boolean;
    account: GmailAccount | null;
    accountCount: number;
  };
  recipients: { total: number; unsubscribed: number; groups: number };
  sending: {
    sentToday: number;
    failedToday: number;
    sentAllTime: number;
    failedAllTime: number;
    successRate: number | null;
    dailyLimit: number;
    dailyRemaining: number;
  };
  campaigns: { total: number; running: number; completed: number };
  progress: ProgressSnapshot;
  recentActivity: Array<{
    id: number;
    recipient: string;
    status: string;
    subject: string | null;
    created_at: string;
    error: string | null;
  }>;
  dailySeries: Array<{ day: string; sent: number; failed: number }>;
}

export interface Campaign {
  id: number;
  name: string | null;
  subject: string;
  bodyHtml: string;
  status: string;
  accountId: number | null;
  total: number;
  sent: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  attachmentCount: number;
}

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  bodyHtml: string;
  createdAt: string;
  updatedAt: string;
}

export interface Worksheet {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface Spreadsheet {
  spreadsheetId: string;
  title: string;
  url: string;
  worksheets: Worksheet[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  content: string;
  size: number;
}
