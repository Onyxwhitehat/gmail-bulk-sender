/**
 * Recipient list parsing, validation and de-duplication.
 *
 * The parser is intentionally permissive about *separators* (comma, semicolon,
 * newline, tab, pipe) and strict about the *addresses* themselves, so a user can
 * paste almost anything from a spreadsheet or mail client and get a clean list.
 */

/** Pragmatic RFC 5322 subset — rejects the exotic forms Gmail would reject anyway. */
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  if (email.length === 0 || email.length > 254) return false;
  const [local] = email.split('@');
  if (!local || local.length > 64) return false;
  if (email.includes('..')) return false;
  return EMAIL_RE.test(email);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export interface ParsedRecipient {
  email: string;
  name?: string;
}

export interface ParseResult {
  valid: ParsedRecipient[];
  invalid: string[];
  duplicates: string[];
  /** Raw token count before validation/dedupe. */
  total: number;
}

/** Extracts `Name <email@host>` or a bare address from a single token. */
function parseToken(token: string): ParsedRecipient | null {
  const trimmed = token.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return null;

  const angled = trimmed.match(/^(.*?)<\s*([^<>\s]+)\s*>$/);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, '');
    return { email: angled[2].trim(), name: name || undefined };
  }

  // "John Doe john@example.com" or "john@example.com (John Doe)"
  const parenthesised = trimmed.match(/^([^\s(]+@[^\s()]+)\s*\((.+)\)$/);
  if (parenthesised) {
    return { email: parenthesised[1], name: parenthesised[2].trim() };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    const emailPart = parts.find((p) => p.includes('@'));
    if (emailPart) {
      const name = parts.filter((p) => p !== emailPart).join(' ').trim();
      return { email: emailPart, name: name || undefined };
    }
  }

  return { email: trimmed };
}

/**
 * Parses a free-form blob of addresses.
 * Auto-detects the separator, validates syntax, and removes duplicates
 * (case-insensitively, keeping the first occurrence and its name).
 */
export function parseRecipientList(input: string): ParseResult {
  const tokens = input
    .split(/[,;\n\r\t|]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const valid: ParsedRecipient[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const parsed = parseToken(token);
    if (!parsed) continue;

    const email = normalizeEmail(parsed.email);
    if (!isValidEmail(email)) {
      invalid.push(token);
      continue;
    }
    if (seen.has(email)) {
      duplicates.push(email);
      continue;
    }
    seen.add(email);
    valid.push({ email, name: parsed.name });
  }

  return { valid, invalid, duplicates, total: tokens.length };
}

/** De-duplicates an already-structured list, keeping the first entry per address. */
export function dedupeRecipients(list: ParsedRecipient[]): {
  unique: ParsedRecipient[];
  removed: number;
} {
  const seen = new Set<string>();
  const unique: ParsedRecipient[] = [];
  let removed = 0;
  for (const item of list) {
    const email = normalizeEmail(item.email);
    if (seen.has(email)) {
      removed += 1;
      continue;
    }
    seen.add(email);
    unique.push({ ...item, email });
  }
  return { unique, removed };
}

/** Splits a CSV/TSV blob into rows, honouring quoted fields containing separators. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const source = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sep = delimiter ?? detectDelimiter(source);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.map((r) => r.map((cell) => cell.trim())).filter((r) => r.some((cell) => cell !== ''));
}

function detectDelimiter(text: string): string {
  const sample = text.split('\n').slice(0, 5).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = sample.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/** Picks the column index most likely to hold email addresses. */
export function guessEmailColumn(header: string[], sampleRows: string[][]): number {
  const byName = header.findIndex((h) => /e[-_ ]?mail/i.test(h ?? ''));
  if (byName >= 0) return byName;

  let bestIndex = 0;
  let bestScore = -1;
  const columnCount = Math.max(header.length, ...sampleRows.map((r) => r.length), 1);

  for (let col = 0; col < columnCount; col += 1) {
    const score = sampleRows.reduce((acc, row) => acc + (isValidEmail(row[col] ?? '') ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = col;
    }
  }
  return bestIndex;
}

/** Picks the column index most likely to hold a person's name. */
export function guessNameColumn(header: string[], emailColumn: number): number {
  const index = header.findIndex((h, i) => i !== emailColumn && /name|full[-_ ]?name|first/i.test(h ?? ''));
  return index;
}
