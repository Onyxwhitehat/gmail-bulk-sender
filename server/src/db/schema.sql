-- Bulk Email Sender — schema.
-- Executed on every boot; every statement is IF NOT EXISTS so it doubles as the migration.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Application users (dashboard login — distinct from the connected Gmail account)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- ---------------------------------------------------------------------------
-- Key/value settings. `encrypted = 1` means `value` is an AES-256-GCM envelope.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  encrypted  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Connected Google accounts. Tokens are stored encrypted at rest.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  access_token      TEXT,
  refresh_token     TEXT,
  token_expiry      INTEGER,             -- epoch milliseconds
  scope             TEXT,
  is_default        INTEGER NOT NULL DEFAULT 0,
  connected_at      TEXT,
  last_refreshed_at TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Short-lived CSRF state values for the OAuth handshake.
CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,
  user_id    INTEGER,
  created_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Recipients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipient_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name       TEXT,
  company    TEXT,
  source     TEXT NOT NULL DEFAULT 'manual',  -- manual | sheets | csv
  source_ref TEXT,                            -- sheet id / filename
  group_id   INTEGER REFERENCES recipient_groups(id) ON DELETE SET NULL,
  is_valid   INTEGER NOT NULL DEFAULT 1,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  bounced    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipients_group  ON recipients(group_id);
CREATE INDEX IF NOT EXISTS idx_recipients_source ON recipients(source);

-- ---------------------------------------------------------------------------
-- Campaigns (a subject + body sent to a set of recipients)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT,
  subject      TEXT NOT NULL,
  body_html    TEXT NOT NULL,
  attachments  TEXT,                    -- JSON array: [{filename, mimeType, size, content(base64)}]
  status       TEXT NOT NULL DEFAULT 'draft',  -- draft|queued|running|paused|completed|cancelled|failed
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  total        INTEGER NOT NULL DEFAULT 0,
  sent         INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT,
  finished_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- ---------------------------------------------------------------------------
-- Per-recipient send queue for a campaign
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  name         TEXT,
  company      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|sending|sent|failed|skipped
  attempts     INTEGER NOT NULL DEFAULT 0,
  message_id   TEXT,
  thread_id    TEXT,
  error        TEXT,
  sent_at      TEXT,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_queue_campaign ON queue_items(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_position ON queue_items(campaign_id, position);

-- ---------------------------------------------------------------------------
-- Immutable send log (survives campaign deletion for auditing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS send_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   INTEGER,
  campaign_name TEXT,
  account_email TEXT,
  recipient     TEXT NOT NULL,
  recipient_name TEXT,
  subject       TEXT,
  status        TEXT NOT NULL,          -- sent | failed | skipped
  message_id    TEXT,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 1,
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON send_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_status  ON send_logs(status);
CREATE INDEX IF NOT EXISTS idx_logs_recip   ON send_logs(recipient);

-- ---------------------------------------------------------------------------
-- Reusable email templates / drafts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  body_html  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
