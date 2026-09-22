# Bulk Email Sender

A private dashboard, running on your own computer, for sending personalised bulk emails through your own Gmail account. No coding knowledge needed to set it up — just follow the steps below in order.

**What makes this different from a normal "mail merge"?** It talks to Gmail directly and securely (the same way, technically, that apps like Google Calendar do), so you never have to type or store your real Gmail password anywhere. Everything — your recipient list, your sent history, your settings — stays on your own computer. Nothing is uploaded to any company's server.

<br />

## Contents

- [Is this for me?](#is-this-for-me)
- [What you'll need](#what-youll-need)
- [Step-by-step setup](#step-by-step-setup)
- [Connect your Gmail account](#connect-your-gmail-account)
- [Add your recipients](#add-your-recipients)
- [Write and send your first email](#write-and-send-your-first-email)
- [Using it day to day](#using-it-day-to-day)
- [Troubleshooting](#troubleshooting)
- [Technical reference](#technical-reference) *(for developers — skip unless you need it)*
- [Licence](#licence)

<br />

## Is this for me?

Use this if you want to send the same email — personalised with each person's name — to a list of people (a newsletter, an announcement, an outreach list) using your own Gmail account, without paying for a mailing-list service and without your recipient list ever leaving your computer.

It can:

- Take a list of email addresses — pasted in, or uploaded as a CSV/Excel-style file
- Let you write one email (with a rich text editor, like a simple version of Word) with placeholders like `{{first_name}}` that get swapped for each person's real name
- Send them out one at a time through your own Gmail account, with a small random pause between each so Gmail doesn't flag you as spam
- Show you a live progress bar while it sends, and a full history afterwards of what was sent and what failed

It is **not** a cloud service — there's nothing to sign up for. You run it on your own Windows, Mac or Linux computer, and it only runs while you have it open.

<br />

## What you'll need

- A Windows, Mac, or Linux computer
- About 15–20 minutes for the one-time setup
- A Gmail (or Google Workspace) account you want to send from
- An internet connection

You do **not** need to know how to code. You will need to copy and paste a few commands into a black-and-white window called a "terminal" — every command you need to type is given to you exactly, so you can just copy and paste it.

<br />

## Step-by-step setup

### Step 1 — Install Node.js

This app runs on a free program called **Node.js**. Think of it as the engine the app needs to run.

1. Go to **[nodejs.org](https://nodejs.org)**
2. Download the version marked **LTS** (Long-Term Support) — this is the stable, recommended one
3. Run the installer you downloaded and click through it with the default options (just keep clicking "Next")
4. When it's done, confirm it worked:
   - **Windows:** press the Windows key, type `cmd`, press Enter to open **Command Prompt**
   - **Mac:** press `Cmd + Space`, type `Terminal`, press Enter
   - In the window that opens, type `node -v` and press Enter. You should see a version number like `v22.x.x` or higher. If you see an error instead, the install didn't finish — try again or restart your computer.

### Step 2 — Download the app

1. Go to **[github.com/Onyxwhitehat/gmail-bulk-sender](https://github.com/Onyxwhitehat/gmail-bulk-sender)**
2. Click the green **`<> Code`** button, then **Download ZIP**
3. Find the downloaded ZIP file (usually in your **Downloads** folder) and **extract/unzip it** — on Windows, right-click it and choose **Extract All**; on Mac, just double-click it
4. You should now have a folder named something like `gmail-bulk-sender-main`. Move it somewhere easy to find, like your Desktop, and rename it to whatever you like (e.g. `Email Sender`)

> If you already know Git, `git clone https://github.com/Onyxwhitehat/gmail-bulk-sender.git` does the same thing.

### Step 3 — Open a terminal inside the folder

The "terminal" is the same black-and-white command window from Step 1. You need to open it **inside** the folder you just created.

- **Windows 11:** open the folder in File Explorer, right-click on an empty area inside it, and choose **Open in Terminal**
- **Windows 10:** open the folder, hold `Shift` and right-click an empty area, choose **Open PowerShell window here**
- **Mac:** open **Terminal**, type `cd ` (with a trailing space), then drag the folder from Finder into the Terminal window and press Enter — this fills in the path for you

You'll know it worked because the folder name (e.g. `Email Sender`) appears in the terminal prompt.

### Step 4 — Install and set up the app

In that same terminal window, type each of these commands one at a time, pressing Enter after each and waiting for it to finish before typing the next:

```bash
npm install
```

This downloads everything the app needs to run. It can take a minute or two — that's normal.

```bash
npm run setup
```

This creates the app's configuration files and generates the random security keys it needs. Safe to run more than once if something goes wrong.

### Step 5 — Start the app

```bash
npm run dev
```

Leave this terminal window **open** — closing it stops the app. You should see some text appear ending with something like "ready" or a port number. That means it's running.

### Step 6 — Create your login

1. Open your web browser (Chrome, Edge, Firefox, Safari — any of them)
2. Go to **http://localhost:3000**
3. You'll see a setup screen — choose a username/email and password for your own dashboard. This is just a login for your own computer; it has nothing to do with your Gmail password and is never sent anywhere.

You now have the app running. Next, connect it to your Gmail account.

<br />

## Connect your Gmail account

Google requires every app to have its own free "credentials" before it's allowed to send email through Gmail on your behalf — this is what keeps your account secure. It sounds technical, but it's a one-time, five-minute, click-through process. Follow every step exactly as written.

### 1. Create a Google Cloud project

1. Go to the **[Google Cloud Console](https://console.cloud.google.com/projectcreate)** (sign in with the Gmail account you'll send from, if asked)
2. Give the project any name you like (e.g. "My Email Sender") and click **Create**
3. Wait a few seconds for it to finish, then make sure that new project is selected (check the dropdown at the top of the page)

### 2. Turn on the Gmail API

1. In the search bar at the top of the page, type **Gmail API** and click it in the results
2. Click the blue **Enable** button

### 3. Set up the consent screen

This is the permission screen Google will show you when you connect your account — it just needs a few details filled in.

1. In the left-hand menu, go to **APIs & Services → OAuth consent screen**
2. Choose **External** as the user type (unless you have a paid Google Workspace account), then **Create**
3. Fill in:
   - **App name:** anything you like, e.g. "My Email Sender"
   - **User support email:** your email address
   - **Developer contact email:** your email address
4. Click through **Save and Continue** on each screen until you reach **Scopes**
5. Click **Add or Remove Scopes** and manually add these three (paste them into the "manually add scopes" box):
   ```
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/userinfo.email
   ```
6. Keep clicking **Save and Continue** until you get to **Test users**, and add the exact Gmail address(es) you plan to send from. **This step is easy to miss and causes a common error later, so don't skip it.**
7. Finish and return to the dashboard

### 4. Create your credentials

1. Left-hand menu → **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. **Application type:** choose **Web application**
4. Under **Authorized redirect URIs**, click **+ Add URI** and paste exactly:
   ```
   http://localhost:4000/api/google/callback
   ```
5. Click **Create**. A box will pop up showing a **Client ID** and **Client Secret** — keep this window open, you need both in the next step

### 5. Connect it in the app

1. Back in your browser, go to your running app and open the **Gmail Connection** page
2. Paste in the **Client ID** and **Client Secret** from Google, and click **Save**
3. Click **Connect Gmail**, choose your Google account, and click **Allow** on Google's permission screen
4. You'll land back in the dashboard showing your account as connected. Use the **Send test email** button to confirm everything works

Your Client Secret is encrypted before it's stored and is never shown again in full — this is expected and normal.

<br />

## Add your recipients

Go to the **Recipients** page. You have two options:

- **Paste them in:** copy a list of email addresses from anywhere (an email, a spreadsheet, a text file) and paste it into the box. Commas, new lines, semicolons — it doesn't matter how they're separated, the app figures it out.
- **Upload a file:** drag and drop a CSV or Excel-exported file onto the upload area. The app will try to automatically detect which column is the email, name, and company.

Duplicate and invalid addresses are automatically removed either way.

<br />

## Write and send your first email

1. Go to the **Compose** page
2. Write a subject and your message using the toolbar (bold, links, images, etc. — like a simple word processor)
3. Optionally personalise it using these placeholders anywhere in your text — they get swapped automatically for each recipient:

   | Type this | Becomes |
   | --- | --- |
   | `{{name}}` | the recipient's full name |
   | `{{first_name}}` | just their first name |
   | `{{email}}` | their email address |
   | `{{company}}` | their company, if you provided one |

4. Check the **Preview** to see exactly what recipients will receive, and how long the send will take
5. Click **Send emails** and confirm

If you're sending to 100 people or more, you'll be asked to type the word `SEND` to confirm — this is a deliberate safety check, since a bulk send can't be undone once it starts.

While it's sending, you'll see a live progress bar with how many are sent, how many remain, and any failures. Full history is under **Sending Logs**, with search and export to CSV/Excel.

<br />

## Using it day to day

- **To stop the app:** click into the terminal window and press `Ctrl + C` (Mac: `Cmd + C` also works in most terminals)
- **To start it again later:** open a terminal in the app's folder (see Step 3 above) and run `npm run dev` again, then open http://localhost:3000
- **Where is my data?** Everything — your recipients, sent history, settings — is stored in a single file on your own computer, inside the app's `server/data` folder. Nothing is sent to any third party.
- **Is my Gmail password stored anywhere?** No. You never type your Gmail password into this app — Google's own login screen handles that, and only hands the app a permission token, which is encrypted before it's saved.

<br />

## Troubleshooting

<details>
<summary><strong>Typing <code>node -v</code> says "not recognized" / "command not found"</strong></summary>

Node.js isn't installed, or your terminal was opened before the install finished. Close the terminal window fully, reopen it, and try again. If it still fails, reinstall Node.js from [nodejs.org](https://nodejs.org) and restart your computer.
</details>

<details>
<summary><strong><code>npm install</code> fails partway through</strong></summary>

Usually a flaky internet connection. Just run `npm install` again — it picks up where it left off. If it keeps failing, restart your computer and try once more.
</details>

<details>
<summary><strong>"redirect_uri_mismatch" when connecting Gmail</strong></summary>

The address in Google Cloud Console must match **exactly** what you pasted in Step 4 of [Connect your Gmail account](#connect-your-gmail-account): `http://localhost:4000/api/google/callback`. Double-check for typos or extra spaces on the Google side.
</details>

<details>
<summary><strong>"access_denied" when connecting Gmail</strong></summary>

You skipped adding your Gmail address under **Test users** in step 3 of the Google Cloud setup. Go back to **OAuth consent screen → Test users** in the Google Cloud Console and add it.
</details>

<details>
<summary><strong>"Google did not return a refresh token"</strong></summary>

This happens if you'd already connected this app to Google before. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions), remove the app's access, then connect again from the Gmail Connection page.
</details>

<details>
<summary><strong>The app says a port is already in use</strong></summary>

Something else on your computer (maybe an old copy of this app still running) is using the same address. Close any other terminal windows running the app, or restart your computer, then try `npm run dev` again.
</details>

<details>
<summary><strong>Emails are landing in spam</strong></summary>

- Keep the delay between sends at 2 seconds or more (this is the default)
- Avoid spammy phrasing and link shorteners
- If it's a brand-new Gmail account, send smaller batches at first rather than hundreds on day one
- Include a way for people to unsubscribe or reply to opt out
</details>

<details>
<summary><strong>Live progress bar doesn't move / says "Offline"</strong></summary>

Refresh the page. If it's still offline, make sure the terminal window running `npm run dev` is still open — closing it stops the whole app.
</details>

<details>
<summary><strong>None of this worked</strong></summary>

Close the terminal, delete the `node_modules` folder inside the app folder, reopen a terminal in the folder (Step 3), and run `npm install` followed by `npm run setup` and `npm run dev` again.
</details>

<br />

## Technical reference

*Everything from here down is for developers — deploying to a server, environment variables, the API, and how the app is built internally. If you just want to run this on your own computer, you're already done — you don't need to read any further.*

### Features

**Connection**
- Google OAuth 2.0 with automatic access-token refresh (refreshed 5 minutes before expiry)
- Multiple Gmail accounts, one marked as the default sender
- Live token status, forced refresh, and a one-click test email

**Recipients**
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

### Architecture

```
┌──────────────────────────┐         ┌──────────────────────────────┐
│  Next.js 15 dashboard    │  HTTPS  │  Express API                 │
│  React 19 · Tailwind v4  │◄───────►│  TypeScript · SQLite         │
│  React Hook Form         │   SSE   │  Session auth · CSRF · CORS  │
└──────────────────────────┘         └───────────────┬──────────────┘
                                                     │ OAuth 2.0
                                     ┌───────────────▼──────────────┐
                                     │  Gmail API                   │
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

### Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API and dashboard together with hot reload |
| `npm run build` | Production build of both workspaces |
| `npm start` | Run the production builds |
| `npm run typecheck` | TypeScript check across both workspaces |
| `npm run setup` | Generate secrets and `.env` files (safe to re-run) |
| `npm run dev:server` / `npm run dev:web` | Run one side only |

### Configuration

#### Backend — `server/.env`

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

#### Frontend — `web/.env.local`

| Variable | Default | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API URL as seen **by the browser** |

This is inlined into the client bundle at build time. Changing it requires a rebuild, and it can never be an internal Docker hostname.

#### In-app settings

These live in the database and are edited on the **Settings** page:

Client ID · Client Secret · Redirect URI · Sender name · Reply-To · Signature · Delay range · Daily limit · Max retries · Batch pause

### Running with Docker

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

### Deploying the API to Railway

The API is a long-running stateful process — it holds queue state in memory and
writes SQLite to disk — so it needs a container host, not a serverless platform.
Railway fits; **Vercel does not** (see [Why not Vercel](#why-not-vercel)).

`railway.toml` in the repo root already selects `server/Dockerfile`, pins the
service to one replica, and points the health check at `/api/health`.

#### 1. Create the service

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Pick `gmail-bulk-sender`
3. Railway reads `railway.toml` and builds `server/Dockerfile` automatically

#### 2. Add a volume — do this before the first real use

**Settings → Volumes → Add Volume**, mount path:

```
/app/server/data
```

Without a volume the container filesystem is ephemeral, and every redeploy wipes
your OAuth tokens, recipients and logs.

#### 3. Set variables

**Variables** tab:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_FILE` | `/app/server/data/app.db` |
| `SESSION_SECRET` | a fresh 48-byte random string |
| `ENCRYPTION_KEY` | a fresh 48-byte random string |
| `APP_URL` | where the dashboard runs, e.g. `http://localhost:3000` |
| `API_URL` | your Railway public domain, e.g. `https://<name>.up.railway.app` |
| `TRUST_PROXY` | `1` |
| `LOG_LEVEL` | `info` |

Generate the two secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Do **not** set `PORT` — Railway injects it, and the app reads it.

`SECURE_COOKIES` is not needed either: the app detects that `APP_URL` and
`API_URL` are on different hosts and automatically switches the session cookie to
`SameSite=None; Secure`, which is required for cross-site requests to carry it.
Override with `COOKIE_SAMESITE` only if you know you need to.

#### 4. Generate the domain

**Settings → Networking → Generate Domain**, then set `API_URL` to that
`https://…` URL and redeploy.

#### 5. Register the new redirect URI with Google

Add this to your OAuth client's **Authorized redirect URIs**:

```
https://<your-app>.up.railway.app/api/google/callback
```

Keep the localhost one too — both can coexist, so local development still works.

#### 6. Point the dashboard at it

In `web/.env.local`:

```env
NEXT_PUBLIC_API_URL=https://<your-app>.up.railway.app
```

Restart the dashboard. Sign in, reconnect Gmail, re-import recipients.

> **A Railway deployment starts empty.** The database is deliberately not in git,
> so your existing account, Gmail connection and recipients do not travel with it.
> To migrate instead of starting fresh, reuse your local `ENCRYPTION_KEY` (tokens
> are undecryptable without it) and copy `server/data/app.db` onto the volume.

#### Why not Vercel

| Requirement | Serverless reality |
| --- | --- |
| A send runs for minutes (110 emails ≈ 8 min) | Functions cap at 10–300s and are killed mid-run |
| SQLite on disk | Filesystem is ephemeral; the database vanishes between invocations |
| Pause/resume/cancel held in memory | No shared memory across invocations |
| SSE progress stream | Long-lived connections are terminated |

Deploy `web/` to Vercel if you like — it is a normal Next.js app. Just keep the
API on a container host.

### Deploying to a VPS

#### 1. Build and run

```bash
git clone https://github.com/Onyxwhitehat/gmail-bulk-sender.git /opt/bulk-email
cd /opt/bulk-email
cp .env.example .env      # set APP_URL / API_URL to your real domains + secrets
docker compose up -d --build
```

#### 2. Terminate TLS with nginx

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

#### 3. Update configuration for production

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

#### Backups

Everything lives in one SQLite file:

```bash
docker run --rm -v bulk-email_email-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/backup-$(date +%F).tar.gz -C /data .
```

Back up your `ENCRYPTION_KEY` alongside it — the database is useless without it.

### Gmail sending limits

| Account type | Approximate daily limit |
| --- | --- |
| Free Gmail | ~500 recipients/day |
| Google Workspace | ~2,000 recipients/day |

Exceeding the limit gets sending blocked for around 24 hours. Set the **Daily sending limit** in Settings to a value below your real cap; the engine pauses automatically when it is reached. Keep the delay at 2 seconds or more — sub-second delays substantially increase the risk of rate limiting.

### Security

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

### API reference

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

### Project layout

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
│   │       ├── mime.ts         RFC 5322 message builder
│   │       ├── sender.ts       The sending engine
│   │       ├── events.ts       SSE hub
│   │       ├── recipients.ts   Recipient storage
│   │       └── settings.ts     Settings with encrypted values
│   └── Dockerfile
├── web/                        Next.js 15 dashboard
│   ├── app/                    Routes: dashboard, gmail, recipients,
│   │                           compose, logs, settings, login
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

### Developer troubleshooting

<details>
<summary><strong>Sending stops with "Google rejected your OAuth credentials"</strong></summary>

The Client ID or Secret is wrong, or the credential was deleted in Google Cloud. Re-enter both on the Gmail Connection page. The run pauses rather than failing every remaining recipient, so you can fix it and press **Resume**.
</details>

<details>
<summary><strong>"Invalid or missing CSRF token"</strong></summary>

Reload the page to reissue the token. If it persists, the browser is likely blocking cookies — check that `APP_URL` matches the origin you are actually using, and that `SECURE_COOKIES` is `false` when serving over plain HTTP.
</details>

<details>
<summary><strong>Live progress does not update (behind a reverse proxy)</strong></summary>

The header shows **Live** when the event stream is connected. If it shows **Offline**:
- Confirm `NEXT_PUBLIC_API_URL` matches the API's real origin
- Behind nginx, confirm `proxy_buffering off` and a long `proxy_read_timeout` (see [Deploying to a VPS](#deploying-to-a-vps))
- Check the browser console for a CORS or CSP error
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
