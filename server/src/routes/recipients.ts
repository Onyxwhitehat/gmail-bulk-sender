import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { dedupeRecipients, guessEmailColumn, guessNameColumn, parseDelimited, parseRecipientList } from '../lib/emails.js';
import { requireAuth } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimit.js';
import {
  countAwaitingFirstContact,
  countRecipients,
  createGroup,
  deleteAllRecipients,
  deleteContactedRecipients,
  deleteGroup,
  deleteRecipients,
  listGroups,
  listRecipients,
  markUnsubscribed,
  removeDuplicates,
  saveRecipients,
} from '../services/recipients.js';

export const recipientsRouter = Router();

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  groupId: z.coerce.number().int().positive().nullable().optional(),
  source: z.enum(['manual', 'csv']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  includeUnsubscribed: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** The Add Recipient list proper: contacts with no outreach on record. */
  awaitingFirstContact: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

recipientsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const { rows, total } = listRecipients(query);
    res.json({
      recipients: rows.map(toPublic),
      total,
      // What a first-contact campaign would actually reach, whatever this page
      // is currently filtered to.
      awaitingTotal: countAwaitingFirstContact(),
      limit: query.limit,
      offset: query.offset,
    });
  }),
);

/**
 * Parses a pasted blob without saving it — powers the live "N valid, M duplicates"
 * counter in the manual-entry box.
 */
const parseSchema = z.object({ text: z.string().max(5_000_000) });

recipientsRouter.post(
  '/parse',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { text } = parseSchema.parse(req.body);
    const result = parseRecipientList(text);

    res.json({
      valid: result.valid.length,
      invalid: result.invalid.length,
      duplicates: result.duplicates.length,
      totalTokens: result.total,
      preview: result.valid.slice(0, 100),
      invalidSamples: result.invalid.slice(0, 20),
    });
  }),
);

const manualImportSchema = z.object({
  text: z.string().max(5_000_000),
  groupId: z.number().int().positive().nullable().default(null),
});

recipientsRouter.post(
  '/import/manual',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const { text, groupId } = manualImportSchema.parse(req.body);
    const parsed = parseRecipientList(text);
    const saved = saveRecipients(parsed.valid, { source: 'manual', groupId });

    res.json({
      imported: saved.inserted,
      updated: saved.updated,
      alreadyPresent: saved.skipped,
      invalid: parsed.invalid.length,
      invalidSamples: parsed.invalid.slice(0, 20),
      duplicatesInInput: parsed.duplicates.length,
      totalRecipients: saved.total,
    });
  }),
);

const csvSchema = z.object({
  content: z.string().max(20_000_000),
  filename: z.string().max(255).optional(),
  hasHeaderRow: z.boolean().default(true),
  emailColumn: z.number().int().min(-1).default(-1),
  nameColumn: z.number().int().min(-1).default(-1),
  groupId: z.number().int().positive().nullable().default(null),
  /** When true, only analyse the file and return column suggestions. */
  previewOnly: z.boolean().default(false),
});

/** CSV / TSV upload. The client posts the file's text, so no multipart handling is needed. */
recipientsRouter.post(
  '/import/csv',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const input = csvSchema.parse(req.body);
    const rows = parseDelimited(input.content);

    if (rows.length === 0) {
      res.status(400).json({ error: 'That file appears to be empty.', code: 'empty_file' });
      return;
    }

    const header = input.hasHeaderRow ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`);
    const dataRows = input.hasHeaderRow ? rows.slice(1) : rows;

    const emailColumn = input.emailColumn >= 0 ? input.emailColumn : guessEmailColumn(header, dataRows.slice(0, 25));
    const nameColumn = input.nameColumn >= -1 && input.nameColumn !== -1 ? input.nameColumn : guessNameColumn(header, emailColumn);

    if (input.previewOnly) {
      res.json({
        header,
        rows: dataRows.slice(0, 50),
        totalRows: dataRows.length,
        suggestedEmailColumn: emailColumn,
        suggestedNameColumn: nameColumn,
      });
      return;
    }

    const candidates = dataRows
      .map((row) => ({
        email: row[emailColumn] ?? '',
        name: nameColumn >= 0 ? row[nameColumn] || undefined : undefined,
      }))
      .filter((r) => r.email.trim() !== '');

    const { unique, removed } = dedupeRecipients(candidates);
    const saved = saveRecipients(unique, {
      source: 'csv',
      sourceRef: input.filename ?? null,
      groupId: input.groupId,
    });

    res.json({
      imported: saved.inserted,
      updated: saved.updated,
      alreadyPresent: saved.skipped,
      invalid: saved.invalid,
      duplicatesInFile: removed,
      scannedRows: dataRows.length,
      totalRecipients: saved.total,
    });
  }),
);

recipientsRouter.post(
  '/dedupe',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ removed: removeDuplicates() });
  }),
);

/** Housekeeping: drop the contacts that have already been written to. */
recipientsRouter.post(
  '/prune-contacted',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ removed: deleteContactedRecipients(), total: countRecipients() });
  }),
);

const deleteSchema = z.object({ ids: z.array(z.number().int().positive()).max(50_000) });

recipientsRouter.post(
  '/delete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { ids } = deleteSchema.parse(req.body);
    res.json({ deleted: deleteRecipients(ids) });
  }),
);

recipientsRouter.delete(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = req.query.groupId ? Number(req.query.groupId) : null;
    res.json({ deleted: deleteAllRecipients(groupId) });
  }),
);

recipientsRouter.post(
  '/:email/unsubscribe',
  requireAuth,
  asyncHandler(async (req, res) => {
    markUnsubscribed(req.params.email, req.body?.value !== false);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

recipientsRouter.get(
  '/groups/all',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ groups: listGroups() });
  }),
);

recipientsRouter.post(
  '/groups',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    res.status(201).json({ group: createGroup(name) });
  }),
);

recipientsRouter.delete(
  '/groups/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    deleteGroup(Number(req.params.id));
    res.json({ ok: true });
  }),
);

function toPublic(row: {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  source: string;
  group_id: number | null;
  unsubscribed: number;
  bounced: number;
  created_at: string;
  contacted_at?: string | null;
  contacted_via?: string | null;
}) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    company: row.company,
    source: row.source,
    groupId: row.group_id,
    unsubscribed: row.unsubscribed === 1,
    bounced: row.bounced === 1,
    createdAt: row.created_at,
    // Set once a campaign has written to this address. Empty means the contact
    // is still waiting for its first email.
    contactedAt: row.contacted_at || null,
    contactedVia: row.contacted_via || null,
  };
}
