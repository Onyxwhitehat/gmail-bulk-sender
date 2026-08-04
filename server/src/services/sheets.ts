import { AppError } from '../lib/errors.js';
import { googleFetch } from './google.js';
import { guessEmailColumn, guessNameColumn, isValidEmail, normalizeEmail } from '../lib/emails.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Accepts a full Google Sheets URL or a bare spreadsheet ID.
 * URLs look like: https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
 */
export function extractSpreadsheetId(input: string): string {
  const value = input.trim();
  const fromUrl = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;

  throw AppError.badRequest(
    'That does not look like a Google Sheets link. Paste the full URL from your browser, e.g. https://docs.google.com/spreadsheets/d/…/edit',
  );
}

/** Reads `gid=` from a sheet URL so we can preselect the tab the user was viewing. */
export function extractGid(input: string): number | null {
  const match = input.match(/[#&?]gid=(\d+)/);
  return match ? Number(match[1]) : null;
}

interface SpreadsheetMetadata {
  spreadsheetId: string;
  properties: { title: string };
  sheets: Array<{
    properties: {
      sheetId: number;
      title: string;
      index: number;
      gridProperties?: { rowCount: number; columnCount: number };
    };
  }>;
}

export interface WorksheetSummary {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetSummary {
  spreadsheetId: string;
  title: string;
  url: string;
  worksheets: WorksheetSummary[];
}

export async function getSpreadsheet(accountId: number, spreadsheetId: string): Promise<SpreadsheetSummary> {
  const data = await request<SpreadsheetMetadata>(
    accountId,
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties`,
  );

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? 'Untitled spreadsheet',
    url: `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    worksheets: (data.sheets ?? []).map((sheet) => ({
      sheetId: sheet.properties.sheetId,
      title: sheet.properties.title,
      index: sheet.properties.index,
      rowCount: sheet.properties.gridProperties?.rowCount ?? 0,
      columnCount: sheet.properties.gridProperties?.columnCount ?? 0,
    })),
  };
}

export interface WorksheetData {
  worksheet: string;
  header: string[];
  rows: string[][];
  /** Zero-based index of the column that most likely holds email addresses. */
  suggestedEmailColumn: number;
  /** Zero-based index of a likely name column, or -1. */
  suggestedNameColumn: number;
  totalRows: number;
}

/** Reads a whole worksheet. `A:ZZ` covers every realistic contact sheet in one call. */
export async function readWorksheet(
  accountId: number,
  spreadsheetId: string,
  worksheetTitle: string,
  hasHeaderRow = true,
): Promise<WorksheetData> {
  const range = `${quoteSheetTitle(worksheetTitle)}!A:ZZ`;
  const data = await request<{ values?: string[][] }>(
    accountId,
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  );

  const values = (data.values ?? []).map((row) => row.map((cell) => String(cell ?? '').trim()));
  if (values.length === 0) {
    return {
      worksheet: worksheetTitle,
      header: [],
      rows: [],
      suggestedEmailColumn: 0,
      suggestedNameColumn: -1,
      totalRows: 0,
    };
  }

  const header = hasHeaderRow ? values[0] : values[0].map((_, i) => `Column ${columnLetter(i)}`);
  const rows = hasHeaderRow ? values.slice(1) : values;
  const width = Math.max(header.length, ...rows.map((r) => r.length));
  const paddedHeader = Array.from({ length: width }, (_, i) => header[i] || `Column ${columnLetter(i)}`);
  const paddedRows = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''));

  const emailColumn = guessEmailColumn(paddedHeader, paddedRows.slice(0, 25));

  return {
    worksheet: worksheetTitle,
    header: paddedHeader,
    rows: paddedRows,
    suggestedEmailColumn: emailColumn,
    suggestedNameColumn: guessNameColumn(paddedHeader, emailColumn),
    totalRows: paddedRows.length,
  };
}

export interface ExtractedRecipient {
  email: string;
  name?: string;
  company?: string;
}

export interface ExtractionResult {
  recipients: ExtractedRecipient[];
  invalid: string[];
  duplicatesRemoved: number;
  scanned: number;
}

/** Pulls the chosen columns out of sheet rows, validating and de-duplicating as it goes. */
export function extractRecipients(
  rows: string[][],
  emailColumn: number,
  nameColumn = -1,
  companyColumn = -1,
): ExtractionResult {
  const recipients: ExtractedRecipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const row of rows) {
    const rawEmail = (row[emailColumn] ?? '').trim();
    if (!rawEmail) continue;

    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      invalid.push(rawEmail);
      continue;
    }
    if (seen.has(email)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(email);
    recipients.push({
      email,
      name: nameColumn >= 0 ? (row[nameColumn] ?? '').trim() || undefined : undefined,
      company: companyColumn >= 0 ? (row[companyColumn] ?? '').trim() || undefined : undefined,
    });
  }

  return { recipients, invalid, duplicatesRemoved, scanned: rows.length };
}

/** Sheet titles containing spaces or quotes must be single-quoted in an A1 range. */
function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function columnLetter(index: number): string {
  let result = '';
  let n = index;
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

/** Wraps googleFetch so Sheets-specific permission problems get an actionable message. */
async function request<T>(accountId: number, url: string): Promise<T> {
  try {
    return await googleFetch<T>(accountId, url);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.status === 403) {
        throw new AppError(
          403,
          'Access to that spreadsheet was denied. Make sure the connected Google account can open it, and that the Google Sheets API is enabled for your project.',
          'sheets_forbidden',
        );
      }
      if (error.status === 404) {
        throw new AppError(
          404,
          'Spreadsheet not found. Check the link, and confirm the connected Google account has at least view access.',
          'sheets_not_found',
        );
      }
    }
    throw error;
  }
}
