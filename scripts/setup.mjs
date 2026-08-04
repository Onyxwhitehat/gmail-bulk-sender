#!/usr/bin/env node
/**
 * First-run setup: generates strong secrets and writes the .env files.
 * Safe to re-run — existing files are never overwritten.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secret = () => randomBytes(48).toString('base64url');

function ensure(target, template, transform) {
  const targetPath = resolve(root, target);
  if (existsSync(targetPath)) {
    console.log(`  skip   ${target} (already exists)`);
    return;
  }

  const templatePath = resolve(root, template);
  if (!existsSync(templatePath)) {
    console.log(`  warn   ${template} not found`);
    return;
  }

  let content = readFileSync(templatePath, 'utf8');
  if (transform) content = transform(content);
  writeFileSync(targetPath, content);
  console.log(`  create ${target}`);
}

const fillSecrets = (content) =>
  content.replace(/^SESSION_SECRET=$/m, `SESSION_SECRET=${secret()}`).replace(/^ENCRYPTION_KEY=$/m, `ENCRYPTION_KEY=${secret()}`);

console.log('\nBulk Email Sender — setup\n');

ensure('server/.env', 'server/.env.example', fillSecrets);
ensure('web/.env.local', 'web/.env.example');
ensure('.env', '.env.example', fillSecrets);

console.log(`
Generated secrets have been written where they were blank.

Next steps:
  1. npm run dev                     Start the API (:4000) and dashboard (:3000)
  2. Open http://localhost:3000      Create your admin account
  3. Gmail Connection page           Paste your Google Client ID + Secret, then connect

Google Cloud setup (one time):
  - Enable the Gmail API and the Google Sheets API
  - Create an OAuth 2.0 Web application client
  - Add this Authorised redirect URI:
      http://localhost:4000/api/google/callback

Keep ENCRYPTION_KEY safe: changing it makes stored OAuth tokens unreadable.
`);
