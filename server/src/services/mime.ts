import { randomBytes } from 'node:crypto';
import { htmlToText } from '../lib/html.js';

export interface Attachment {
  filename: string;
  mimeType: string;
  /** Base64-encoded file content. */
  content: string;
  size?: number;
}

export interface MessageInput {
  from: string;
  fromName?: string;
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: Attachment[];
  headers?: Record<string, string>;
}

/** RFC 2047 encoded-word, needed whenever a header contains non-ASCII characters. */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Strips CR/LF so a crafted display name cannot inject extra headers. */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function formatAddress(email: string, name?: string): string {
  const cleanEmail = sanitizeHeaderValue(email);
  if (!name) return cleanEmail;
  const cleanName = sanitizeHeaderValue(name);
  return `${encodeHeaderWord(cleanName)} <${cleanEmail}>`;
}

/** Splits base64 into 76-character lines as required by RFC 2045. */
function chunk76(value: string): string {
  return value.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
}

function encodeBody(content: string): string {
  return chunk76(Buffer.from(content, 'utf8').toString('base64'));
}

/**
 * Builds a complete RFC 5322 message.
 *
 * Layout: multipart/mixed( multipart/alternative( text/plain, text/html ), ...attachments )
 * The plain-text alternative meaningfully improves deliverability, so it is always included.
 */
export function buildMimeMessage(input: MessageInput): string {
  const attachments = input.attachments ?? [];
  const altBoundary = `alt_${randomBytes(12).toString('hex')}`;
  const mixedBoundary = `mix_${randomBytes(12).toString('hex')}`;
  const hasAttachments = attachments.length > 0;

  const headers: string[] = [
    `From: ${formatAddress(input.from, input.fromName)}`,
    `To: ${formatAddress(input.to, input.toName)}`,
    `Subject: ${encodeHeaderWord(sanitizeHeaderValue(input.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ];

  if (input.replyTo) headers.push(`Reply-To: ${sanitizeHeaderValue(input.replyTo)}`);
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    headers.push(`${sanitizeHeaderValue(key)}: ${sanitizeHeaderValue(value)}`);
  }

  const plain = input.text ?? htmlToText(input.html) ?? '';

  const alternative = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(plain),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(input.html),
    '',
    `--${altBoundary}--`,
  ];

  if (!hasAttachments) {
    return [...headers, ...alternative].join('\r\n');
  }

  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    ...alternative,
    '',
  ];

  for (const attachment of attachments) {
    const filename = sanitizeHeaderValue(attachment.filename || 'attachment');
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${sanitizeHeaderValue(attachment.mimeType || 'application/octet-stream')}; name="${encodeHeaderWord(filename)}"`,
      `Content-Disposition: attachment; filename="${encodeHeaderWord(filename)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      chunk76(attachment.content.replace(/\s+/g, '')),
      '',
    );
  }

  parts.push(`--${mixedBoundary}--`);
  return parts.join('\r\n');
}

/** Gmail's `raw` field expects base64url without padding. */
export function toBase64Url(message: string): string {
  return Buffer.from(message, 'utf8').toString('base64url');
}
