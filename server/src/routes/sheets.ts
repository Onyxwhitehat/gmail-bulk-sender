import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimit.js';
import { getAccount, getDefaultAccount } from '../services/google.js';
import { extractGid, extractRecipients, extractSpreadsheetId, getSpreadsheet, readWorksheet } from '../services/sheets.js';
import { saveRecipients } from '../services/recipients.js';

export const sheetsRouter = Router();

function resolveAccountId(explicit?: number): number {
  const account = explicit ? getAccount(explicit) : getDefaultAccount();
  if (!account) {
    throw AppError.badRequest(
      'Connect a Google account first — Google Sheets is read using the same OAuth connection as Gmail.',
    );
  }
  return account.id;
}

const loadSchema = z.object({
  url: z.string().trim().min(1, 'Paste a Google Sheets URL'),
  accountId: z.number().int().positive().optional(),
});

/** Step 1: resolve the URL and list the worksheets inside it. */
sheetsRouter.post(
  '/load',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const { url, accountId } = loadSchema.parse(req.body);
    const spreadsheetId = extractSpreadsheetId(url);
    const summary = await getSpreadsheet(resolveAccountId(accountId), spreadsheetId);

    // Preselect the tab the user was looking at when they copied the link.
    const gid = extractGid(url);
    const preselected = gid === null ? summary.worksheets[0] : summary.worksheets.find((w) => w.sheetId === gid);

    res.json({ spreadsheet: summary, preselectedWorksheet: preselected?.title ?? summary.worksheets[0]?.title ?? null });
  }),
);

const previewSchema = z.object({
  spreadsheetId: z.string().trim().min(1),
  worksheet: z.string().trim().min(1),
  hasHeaderRow: z.boolean().default(true),
  accountId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

/** Step 2: read the worksheet and return a preview plus column suggestions. */
sheetsRouter.post(
  '/preview',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const { spreadsheetId, worksheet, hasHeaderRow, accountId, limit } = previewSchema.parse(req.body);
    const data = await readWorksheet(resolveAccountId(accountId), spreadsheetId, worksheet, hasHeaderRow);

    res.json({
      worksheet: data.worksheet,
      header: data.header,
      rows: data.rows.slice(0, limit),
      totalRows: data.totalRows,
      suggestedEmailColumn: data.suggestedEmailColumn,
      suggestedNameColumn: data.suggestedNameColumn,
    });
  }),
);

const importSchema = z.object({
  spreadsheetId: z.string().trim().min(1),
  worksheet: z.string().trim().min(1),
  emailColumn: z.number().int().min(0),
  nameColumn: z.number().int().min(-1).default(-1),
  companyColumn: z.number().int().min(-1).default(-1),
  hasHeaderRow: z.boolean().default(true),
  accountId: z.number().int().positive().optional(),
  groupId: z.number().int().positive().nullable().default(null),
});

/** Step 3: import the selected column into the recipients table. */
sheetsRouter.post(
  '/import',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const input = importSchema.parse(req.body);
    const data = await readWorksheet(
      resolveAccountId(input.accountId),
      input.spreadsheetId,
      input.worksheet,
      input.hasHeaderRow,
    );

    const extracted = extractRecipients(data.rows, input.emailColumn, input.nameColumn, input.companyColumn);
    const saved = saveRecipients(extracted.recipients, {
      source: 'sheets',
      sourceRef: `${input.spreadsheetId}#${input.worksheet}`,
      groupId: input.groupId,
    });

    res.json({
      imported: saved.inserted,
      updated: saved.updated,
      alreadyPresent: saved.skipped,
      invalid: extracted.invalid.length,
      invalidSamples: extracted.invalid.slice(0, 10),
      duplicatesInSheet: extracted.duplicatesRemoved,
      scannedRows: extracted.scanned,
      totalRecipients: saved.total,
    });
  }),
);
