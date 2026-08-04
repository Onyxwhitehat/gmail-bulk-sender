# Bulk Email Sender

A full-stack dashboard for sending personalised bulk email through the **Gmail API** with OAuth 2.0 — no SMTP, no app passwords. Import recipients from Google Sheets or paste them in, compose once, and watch delivery progress live.

<br />

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Google Cloud setup](#google-cloud-setup)
- [Configuration](#configuration)
- [Running with Docker](#running-with-docker)
- [Deploying to a VPS](#deploying-to-a-vps)
- [Using the app](#using-the-app)
- [Security](#security)
- [API reference](#api-reference)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

<br />

## Features

**Connection**
- Google OAuth 2.0 with automatic access-token refresh (refreshed 5 minutes before expiry)
- Multiple Gmail accounts, one marked as the default sender
- Live token status, forced refresh, and a one-click test email

**Recipients**
- Import from Google Sheets: pick the worksheet and the email/name/company columns
- Paste addresses separated by commas, semicolons, newlines, tabs or pipes — auto-detected
- CSV/TSV upload with drag-and-drop and automatic column detection
- Parses `Name <email@host>` and `email@host (Name)` forms
- Case-insensitive de-duplication and RFC-based validation on every path
- Optional groups for segmenting the address book

**Composing**
- Rich text editor: bold, italic, underline, strikethrough, headings, lists, quotes, links, images
- Raw HTML mode for hand-written markup
- Variables: `{{name}}`, `{{first_name}}`, `{{email}}`, `{{company}}`
- File attachments, reusable templates, and autosaved drafts
- Preview showing the rendered message, recipient count, and estimated run time

**Sending**
- Sequential delivery with a configurable randomised delay (default 2–5 s)
- Pause, resume, cancel, clear queue, and retry-failed
- Up to 3 retries with exponential backoff on transient errors
- Invalid addresses are skipped, not attempted; one failure never stops the run
- Configuration and authorisation failures stop the run immediately instead of burning through the queue
- Daily sending limit enforced with an automatic pause
- Optional long pause every N messages for very large lists

**Monitoring**
- Live progress over Server-Sent Events: progress bar, current recipient, sent/remaining/failed, elapsed time, ETA and rate
- Full send log with the Gmail message ID and error for every attempt
- Search, status and date filters, plus CSV and Excel export
- Dashboard cards and a 14-day volume chart

**Experience**
- Responsive layout for desktop and mobile
- Light, dark and system themes with no flash on load
- Toast notifications, loading states, and typed confirmation for destructive actions

<br />

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────────┐
│  Next.js 15 dashboard    │  HTTPS  │  Express API                 │
│  React 19 · Tailwind v4  │◄───────►│  TypeScript · SQLite         │
│  React Hook Form         │   SSE   │  Session auth · CSRF · CORS  │
└──────────────────────────┘         └───────────────┬──────────────┘
                                                     │ OAuth 2.0
                                     ┌───────────────▼──────────────┐
                                     │  Gmail API · Sheets API      │
                                     └──────────────────────────────┘
```

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, React Hook Form | — |
| Backend | Node.js 22+, Express, TypeScript | — |
| Database | SQLite via the built-in `node:sqlite` module | Zero native dependencies, so `npm install` never needs a compiler |
| Real-time | Server-Sent Events | One-directional traffic; survives proxies and reconnects automatically |
| Email | Gmail REST API (`users.messages.send`) | OAuth-only, returns message IDs, no app passwords |
| Google client | Direct `fetch` against Google's REST endpoints | Avoids the multi-megabyte `googleapis` package |

> **Note on SQLite:** the app uses Node's built-in `node:sqlite`, which requires **Node 22.5 or newer**. This removes the usual `better-sqlite3` native build step — a common source of install failures on Windows.

<br />

## Quick start

**Requirements:** Node.js 22.5+ (24 LTS recommended) and npm 10+.

```bash
git clone <your-repo-url> "Email Sender"
cd "Email Sender"

npm install      # installs both workspaces
npm run setup    # generates secrets and writes .env files
npm run dev      # API on :4000, dashboard on :3000
```

Open **http://localhost:3000**, create your admin account, then follow [Google Cloud setup](#google-cloud-setup) to connect Gmail.

### Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API and dashboard together with hot reload |
| `npm run build` | Production build of both workspaces |
| `npm start` | Run the production builds |
| `npm run typecheck` | TypeScript check across both workspaces |
| `npm run setup` | Generate secrets and `.env` files (safe to re-run) |
| `npm run dev:server` / `npm run dev:web` | Run one side only |

<br />

## Google Cloud setup

This is a one-time configuration. It takes about five minutes.

### 1. Create a project

Go to the [Google Cloud Console](https://console.cloud.google.com/projectcreate) and create a project, or select an existing one.

### 2. Enable the APIs

**APIs & Services → Library**, then enable both:

- **Gmail API**
- **Google Sheets API**

### 3. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**

| Field | Value |
| --- | --- |
| User type | **External** (unless you have Google Workspace) |
| App name | Anything — your users see this on the consent screen |
| Support email | Your address |

Add these scopes:

```
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/spreadsheets.readonly
https://www.googleapis.com/auth/userinfo.email
```

While the app is in **Testing** mode, add every Gmail address you intend to connect under **Test users**. Without this, authorisation fails with `access_denied`.

### 4. Create OAuth client credentials

**APIs & Services → Credentials → Create credentials → OAuth client ID**

| Field | Value |
| --- | --- |
| Application type | **Web application** |
| Authorised redirect URI | `http://localhost:4000/api/google/callback` |

For production, use your real domain instead:

```
https://api.yourdomain.com/api/google/callback
```

The redirect URI must match **character for character**, including the scheme and any trailing path.

### 5. Connect in the dashboard

Copy the **Client ID** and **Client Secret** into the **Gmail Connection** page, save, then press **Connect Gmail**. The secret is encrypted before it is stored and is never sent back to the browser.

<br />

## Configuration

### Backend — `server/.env`

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `APP_URL` | `http://localhost:3000` | Dashboard origin — used for CORS and OAuth redirects |
| `API_URL` | `http://localhost:4000` | Public API URL — used to build the default redirect URI |
| `SESSION_SECRET` | — | **Required in production.** Signs session cookies |
| `ENCRYPTION_KEY` | — | **Required in production.** Encrypts OAuth tokens at rest |
| `DATABASE_FILE` | `./data/app.db` | SQLite file path |
| `SECURE_COOKIES` | `false` | Set `true` when serving over HTTPS |
| `SESSION_TTL_HOURS` | `12` | Session lifetime |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Optional: create the first login on boot |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Optional fallback; UI-stored values win |
| `TRUST_PROXY` | — | Set to `1` behind a reverse proxy so rate limiting sees real client IPs |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |

> ⚠️ **`ENCRYPTION_KEY` is not rotatable in place.** Changing it makes every stored OAuth token undecryptable, and each Gmail account has to be reconnected. Back it up with your other secrets.

In development, missing secrets fall back to a deterministic insecure value with a warning. In production the server refuses to start without them — a boot-time random secret would silently invalidate sessions and stored tokens on every restart.

### Frontend — `web/.env.local`

| Variable | Default | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API URL as seen **by the browser** |

This is inlined into the client bundle at build time. Changing it requires a rebuild, and it can never be an internal Docker hostname.

### In-app settings

These live in the database and are edited on the **Settings** page:

Client ID · Client Secret · Redirect URI · Sender name · Reply-To · Signature · Delay range · Daily limit · Max retries · Batch pause

<br />

## Running with Docker

```bash
cp .env.example .env

# Fill in the two required secrets
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # ENCRYPTION_KEY

docker compose up -d --build
```

The dashboard is on `http://localhost:3000` and the API on `http://localhost:4000`. The SQLite database lives in the `email-data` named volume and survives rebuilds.

```bash
docker compose logs -f          # follow logs
docker compose down             # stop (data is kept)
docker compose down -v          # stop and delete the database
```

Because `NEXT_PUBLIC_API_URL` is baked in at build time, changing `API_URL` requires `docker compose up -d --build`, not just a restart.

<br />

## Deploying to a VPS

### 1. Build and run

```bash
git clone <your-repo-url> /opt/bulk-email
cd /opt/bulk-email
cp .env.example .env      # set APP_URL / API_URL to your real domains + secrets
docker compose up -d --build
```

### 2. Terminate TLS with nginx

```nginx
# Dashboard
server {
    listen 443 ssl http2;
    server_name mail.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/mail.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mail.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# API
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for the live progress stream: no buffering, no read timeout.
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 24h;
        proxy_set_header   Connection '';
        proxy_http_version 1.1;
    }
}
```

### 3. Update configuration for production

In `.env`:

```env
APP_URL=https://mail.yourdomain.com
API_URL=https://api.yourdomain.com
SECURE_COOKIES=true
TRUST_PROXY=1
```

Then in the Google Cloud Console, add the production redirect URI:

```
https://api.yourdomain.com/api/google/callback
```

Rebuild so the new API URL is baked into the frontend bundle:

```bash
docker compose up -d --build
```

### Backups

Everything lives in one SQLite file:

```bash
docker run --rm -v bulk-email_email-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/backup-$(date +%F).tar.gz -C /data .
```

Back up your `ENCRYPTION_KEY` alongside it — the database is useless without it.

<br />

## Using the app

### 1. Connect Gmail
**Gmail Connection** → save your Client ID and Secret → **Connect Gmail** → approve on Google. Send a test email to confirm the whole path works.

### 2. Add recipients

| Source | How |
| --- | --- |
| Google Sheets | **Google Sheets** → paste the URL → pick the worksheet and columns → **Import** |
| Paste | **Recipients** → paste into the box → **Add recipients** |
| CSV | **Recipients** → drop a file onto the upload area |

Duplicates and invalid addresses are removed on every path.

### 3. Compose and send
**Compose** → subject and body → check the preview → **Send emails** → confirm.

Sends of 100 or more recipients require typing `SEND` to confirm — a deliberate speed bump on an irreversible action.

### 4. Monitor
Live progress appears on the Compose page and in the sidebar. **Sending Logs** has the full history with search, filters and CSV/Excel export.

### Variables

| Variable | Replaced with | Fallback |
| --- | --- | --- |
| `{{name}}` | Recipient's full name | The part of the address before `@` |
| `{{first_name}}` | First word of the name | The part before `@` |
| `{{email}}` | Email address | — |
| `{{company}}` | Company | Empty string |

Unrecognised variables are left as-is, so a typo is visible in the preview instead of silently producing a blank.

### Gmail sending limits

| Account type | Approximate daily limit |
| --- | --- |
| Free Gmail | ~500 recipients/day |
| Google Workspace | ~2,000 recipients/day |

Exceeding the limit gets sending blocked for around 24 hours. Set the **Daily sending limit** in Settings to a value below your real cap; the engine pauses automatically when it is reached. Keep the delay at 2 seconds or more — sub-second delays substantially increase the risk of rate limiting.

<br />

## Security

| Concern | Approach |
| --- | --- |
| Client secret exposure | Stored server-side only, AES-256-GCM encrypted, returned to the UI masked (`GOCS••••••••alue`) |
| Token storage | Access and refresh tokens encrypted at rest with a key derived via scrypt |
| Dashboard auth | bcrypt (cost 12) password hashing, signed httpOnly session cookies, constant-time comparison so response timing cannot enumerate accounts |
| CSRF | Double-submit cookie; every mutating request must echo the token in `X-CSRF-Token` |
| XSS | Email HTML sanitised server-side with a strict tag/attribute allow-list; all event handlers, `javascript:` URLs and SVG data URLs stripped |
| CSP | Strict policy with a per-request nonce issued by Next.js middleware — no `unsafe-inline` scripts |
| Header injection | CR/LF stripped from every value interpolated into a MIME header |
| CSV injection | Cells beginning `=`, `+`, `-` or `@` are prefixed so spreadsheets cannot execute log content |
| Rate limiting | 300 req/min overall, 30 req/min on Google-facing endpoints, 10 sign-in attempts per 15 min |
| Endpoint protection | Every route except `/api/health`, the auth endpoints and the OAuth callback requires a session |
| Input validation | Zod schemas on every request body and query string |
| Transport | HSTS in production; `SECURE_COOKIES=true` for the `Secure` flag |
| Other headers | Helmet: `nosniff`, `frame-ancestors 'none'`, `no-referrer` |

The OAuth callback is exempt from CSRF because it is a top-level redirect from Google; it is protected instead by a single-use, 15-minute `state` nonce.

<br />

## API reference

All endpoints are under `/api`. Everything except `/health`, `/auth/*` and `/google/callback` requires a session cookie; every mutating request requires the `X-CSRF-Token` header.

<details>
<summary><strong>Authentication</strong></summary>

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/state` | Session state; also issues the CSRF cookie |
| `POST` | `/auth/setup` | Create the first admin (only while none exists) |
| `POST` | `/auth/login` | Sign in |
| `POST` | `/auth/logout` | Sign out |
| `GET` | `/auth/me` | Current user |
| `POST` | `/auth/change-password` | Change the dashboard password |

</details>

<details>
<summary><strong>Google / Gmail</strong></summary>

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/google/connect` | Returns the Google consent URL |
| `GET` | `/google/callback` | OAuth redirect target |
| `GET` | `/google/status` | Connection status of the default account |
| `GET` | `/google/accounts` | List connected accounts |
| `POST` | `/google/accounts/:id/refresh` | Force a token refresh |
| `POST` | `/google/accounts/:id/default` | Set the default sender |
| `POST` | `/google/accounts/:id/test` | Send a test email |
| `GET` | `/google/accounts/:id/profile` | Live Gmail profile check |
| `DELETE` | `/google/accounts/:id` | Disconnect and revoke |

</details>

<details>
<summary><strong>Google Sheets</strong></summary>

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/sheets/load` | Resolve a URL and list worksheets |
| `POST` | `/sheets/preview` | Read rows with column suggestions |
| `POST` | `/sheets/import` | Import the selected columns |

</details>

<details>
<summary><strong>Recipients</strong></summary>

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/recipients` | List with search, group filter and pagination |
| `POST` | `/recipients/parse` | Validate a pasted blob without saving |
| `POST` | `/recipients/import/manual` | Import pasted addresses |
| `POST` | `/recipients/import/csv` | Import CSV/TSV content |
| `POST` | `/recipients/dedupe` | Remove duplicates |
| `POST` | `/recipients/delete` | Delete by ID |
| `DELETE` | `/recipients` | Delete all (optionally by group) |
| `GET` | `/recipients/groups/all` | List groups |
| `POST` | `/recipients/groups` | Create a group |
| `DELETE` | `/recipients/groups/:id` | Delete a group |

</details>

<details>
<summary><strong>Campaigns and sending</strong></summary>

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/campaigns` | Create a campaign and build its queue |
| `GET` | `/campaigns` | List campaigns |
| `GET` | `/campaigns/:id` | Campaign detail with queue counts |
| `POST` | `/campaigns/preview` | Render a preview and estimate the run time |
| `POST` | `/campaigns/:id/send` | Start sending |
| `POST` | `/campaigns/:id/pause` | Pause |
| `POST` | `/campaigns/:id/resume` | Resume |
| `POST` | `/campaigns/:id/cancel` | Cancel |
| `POST` | `/campaigns/:id/clear-queue` | Remove unsent items |
| `POST` | `/campaigns/:id/retry-failed` | Re-queue failures |
| `GET` | `/campaigns/:id/queue` | Inspect queue items |
| `DELETE` | `/campaigns/:id` | Delete a campaign |

</details>

<details>
<summary><strong>Logs, settings, stats, stream</strong></summary>

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/logs` | Search and filter logs |
| `GET` | `/logs/export.csv` | CSV export |
| `GET` | `/logs/export.xls` | Excel export |
| `DELETE` | `/logs` | Clear logs |
| `GET` | `/settings` | Read settings (secrets masked) |
| `PUT` | `/settings` | Update settings |
| `GET` | `/stats` | Dashboard metrics |
| `GET` | `/templates` | Email templates (with POST/PUT/DELETE) |
| `GET` | `/stream` | Server-Sent Events progress feed |
| `GET` | `/health` | Health check (unauthenticated) |

</details>

<br />

## Project layout

```
.
├── server/                     Express + TypeScript API
│   ├── src/
│   │   ├── config.ts           Environment and secret handling
│   │   ├── db/
│   │   │   ├── index.ts        node:sqlite connection and helpers
│   │   │   └── schema.sql      Schema (idempotent, applied on boot)
│   │   ├── lib/
│   │   │   ├── crypto.ts       AES-256-GCM encryption
│   │   │   ├── emails.ts       Parsing, validation, de-duplication
│   │   │   ├── errors.ts       AppError and the error middleware
│   │   │   ├── html.ts         HTML sanitiser and HTML-to-text
│   │   │   └── logger.ts       Levelled logger
│   │   ├── middleware/         auth · csrf · rateLimit
│   │   ├── routes/             One router per resource
│   │   └── services/
│   │       ├── google.ts       OAuth handshake and token lifecycle
│   │       ├── gmail.ts        messages.send
│   │       ├── sheets.ts       Spreadsheet reading
│   │       ├── mime.ts         RFC 5322 message builder
│   │       ├── sender.ts       The sending engine
│   │       ├── events.ts       SSE hub
│   │       ├── recipients.ts   Recipient storage
│   │       └── settings.ts     Settings with encrypted values
│   └── Dockerfile
├── web/                        Next.js 15 dashboard
│   ├── app/                    Routes: dashboard, gmail, sheets,
│   │                           recipients, compose, logs, settings, login
│   ├── components/
│   │   ├── AppShell.tsx        Sidebar, header, auth gate
│   │   ├── providers.tsx       Theme, toasts, session, confirm dialogs
│   │   ├── RichTextEditor.tsx  Dependency-free editor
│   │   └── ui.tsx              Buttons, cards, inputs, icons
│   ├── lib/                    api · hooks · format · types
│   ├── middleware.ts           CSP nonce
│   └── Dockerfile
├── scripts/setup.mjs
├── docker-compose.yml
└── README.md
```

<br />

## Troubleshooting

<details>
<summary><strong>"redirect_uri_mismatch" during authorisation</strong></summary>

The redirect URI in the dashboard must exactly match one listed in your Google OAuth client — scheme, host, port and path all included. `http://localhost:4000/api/google/callback` and `http://127.0.0.1:4000/api/google/callback` are different values to Google.
</details>

<details>
<summary><strong>"access_denied" during authorisation</strong></summary>

While the consent screen is in **Testing**, only addresses listed under **Test users** can authorise. Add the Gmail address there, or publish the app.
</details>

<details>
<summary><strong>"Google did not return a refresh token"</strong></summary>

Google only issues a refresh token on first consent. Remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and connect again.
</details>

<details>
<summary><strong>Sending stops with "Google rejected your OAuth credentials"</strong></summary>

The Client ID or Secret is wrong, or the credential was deleted in Google Cloud. Re-enter both on the Gmail Connection page. The run pauses rather than failing every remaining recipient, so you can fix it and press **Resume**.
</details>

<details>
<summary><strong>Live progress does not update</strong></summary>

The header shows **Live** when the event stream is connected. If it shows **Offline**:
- Confirm `NEXT_PUBLIC_API_URL` matches the API's real origin
- Behind nginx, confirm `proxy_buffering off` and a long `proxy_read_timeout` (see above)
- Check the browser console for a CORS or CSP error
</details>

<details>
<summary><strong>"Invalid or missing CSRF token"</strong></summary>

Reload the page to reissue the token. If it persists, the browser is likely blocking cookies — check that `APP_URL` matches the origin you are actually using, and that `SECURE_COOKIES` is `false` when serving over plain HTTP.
</details>

<details>
<summary><strong>Emails land in spam</strong></summary>

- Set SPF, DKIM and DMARC records for your sending domain
- Keep the delay at 2 seconds or more
- Avoid spam-trigger phrasing and link shorteners
- Warm up gradually — a brand-new account sending 500 messages on day one is a strong spam signal
- Include a genuine unsubscribe path
</details>

<details>
<summary><strong>Server will not start: "SESSION_SECRET must be set"</strong></summary>

Production requires real secrets. Run `npm run setup`, or generate them manually:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
</details>

<details>
<summary><strong>"Cannot find module 'node:sqlite'"</strong></summary>

Your Node.js is older than 22.5. Check with `node -v` and upgrade to Node 22.5+ (24 LTS recommended).
</details>

<br />

## Licence

MIT — use it as you like.

**Please send responsibly.** Only email people who have agreed to hear from you, and honour unsubscribe requests. Bulk email is regulated by CAN-SPAM, GDPR and similar laws depending on where you and your recipients are.
