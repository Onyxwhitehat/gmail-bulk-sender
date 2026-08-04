import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, transaction } from '../db/index.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { sanitizeHtml } from '../lib/html.js';
import { requireAuth } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimit.js';
import { getDefaultAccount } from '../services/google.js';
import { getNumberSetting, getSetting } from '../services/settings.js';
import { renderTemplate, sender, type CampaignRow } from '../services/sender.js';

export const campaignsRouter = Router();

/** 25 MB is Gmail's message ceiling; base64 inflates by ~33%, so cap the raw bytes lower. */
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

const attachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(255).default('application/octet-stream'),
  content: z.string().max(30_000_000),
  size: z.number().int().nonnegative().optional(),
});

const campaignSchema = z.object({
  name: z.string().trim().max(200).optional(),
  subject: z.string().trim().min(1, 'Subject is required').max(1000),
  bodyHtml: z.string().max(2_000_000),
  attachments: z.array(attachmentSchema).max(10).default([]),
  accountId: z.number().int().positive().nullable().default(null),
  /** Which recipients to queue. */
  recipientIds: z.array(z.number().int().positive()).max(100_000).optional(),
  groupId: z.number().int().positive().nullable().default(null),
  includeAll: z.boolean().default(true),
});

function assertAttachmentSize(attachments: Array<{ content: string }>): void {
  const bytes = attachments.reduce((sum, a) => sum + Math.floor((a.content.length * 3) / 4), 0);
  if (bytes > MAX_ATTACHMENT_BYTES) {
    throw AppError.badRequest(
      `Attachments total roughly ${(bytes / 1024 / 1024).toFixed(1)} MB. Gmail rejects messages over 25 MB — keep attachments under 18 MB.`,
    );
  }
}

/** Creates a campaign and materialises its send queue in one transaction. */
campaignsRouter.post(
  '/',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const input = campaignSchema.parse(req.body);
    assertAttachmentSize(input.attachments);

    const bodyHtml = sanitizeHtml(input.bodyHtml);
    if (!bodyHtml.trim()) throw AppError.badRequest('The email body cannot be empty.');

    const recipients = resolveRecipients(input);
    if (recipients.length === 0) {
      throw AppError.badRequest('No recipients matched your selection. Import or select recipients first.');
    }

    const accountId = input.accountId ?? getDefaultAccount()?.id ?? null;

    const campaignId = transaction(() => {
      const created = run(
        `INSERT INTO campaigns (name, subject, body_html, attachments, status, account_id, total)
         VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
        input.name?.trim() || `Campaign ${new Date().toLocaleString()}`,
        input.subject,
        bodyHtml,
        input.attachments.length ? JSON.stringify(input.attachments) : null,
        accountId,
        recipients.length,
      );

      recipients.forEach((recipient, index) => {
        run(
          'INSERT INTO queue_items (campaign_id, recipient_id, email, name, company, position) VALUES (?, ?, ?, ?, ?, ?)',
          created.lastInsertRowid,
          recipient.id,
          recipient.email,
          recipient.name,
          recipient.company,
          index,
        );
      });

      return created.lastInsertRowid;
    });

    res.status(201).json({ campaign: publicCampaign(requireCampaign(campaignId)), queued: recipients.length });
  }),
);

campaignsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const rows = all<CampaignRow>('SELECT * FROM campaigns ORDER BY id DESC LIMIT 100');
    res.json({ campaigns: rows.map(publicCampaign) });
  }),
);

campaignsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaign = requireCampaign(Number(req.params.id));
    const queue = all<{ status: string; count: number }>(
      'SELECT status, COUNT(*) AS count FROM queue_items WHERE campaign_id = ? GROUP BY status',
      campaign.id,
    );
    res.json({
      campaign: publicCampaign(campaign),
      queue: Object.fromEntries(queue.map((q) => [q.status, q.count])),
    });
  }),
);

campaignsRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (sender.status().campaignId === id && sender.isBusy()) {
      throw AppError.conflict('Cancel the running send before deleting this campaign.');
    }
    run('DELETE FROM campaigns WHERE id = ?', id);
    res.json({ ok: true });
  }),
);

/**
 * Preview without persisting anything: rendered subject/body for the first recipient,
 * plus the estimated wall-clock time for the whole run.
 */
const previewSchema = z.object({
  subject: z.string().max(1000).default(''),
  bodyHtml: z.string().max(2_000_000).default(''),
  recipientIds: z.array(z.number().int().positive()).max(100_000).optional(),
  groupId: z.number().int().positive().nullable().default(null),
  includeAll: z.boolean().default(true),
});

campaignsRouter.post(
  '/preview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = previewSchema.parse(req.body);
    const recipients = resolveRecipients(input);
    const sample = recipients[0] ?? { email: 'sample@example.com', name: 'Sample Person', company: null, id: 0 };

    const delayMin = getNumberSetting('delay_min_ms');
    const delayMax = getNumberSetting('delay_max_ms');
    const avgDelay = (delayMin + delayMax) / 2;
    // ~1.2s of API round-trip per message on a typical connection.
    const estimatedMs = recipients.length * (avgDelay + 1200);

    res.json({
      recipientCount: recipients.length,
      sampleRecipients: recipients.slice(0, 25).map((r) => ({ email: r.email, name: r.name })),
      renderedSubject: renderTemplate(input.subject, sample),
      renderedBody: sanitizeHtml(renderTemplate(input.bodyHtml, sample)) + signatureSuffix(sample),
      estimate: {
        totalMs: Math.round(estimatedMs),
        human: humanDuration(estimatedMs),
        delayRange: [delayMin, delayMax],
      },
      dailyLimit: getNumberSetting('daily_limit'),
      dailySent: sender.dailySentCount(),
    });
  }),
);

// ---------------------------------------------------------------------------
// Send controls
// ---------------------------------------------------------------------------

campaignsRouter.post(
  '/:id/send',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const campaign = requireCampaign(Number(req.params.id));
    res.json({ progress: await sender.start(campaign.id) });
  }),
);

campaignsRouter.post(
  '/:id/pause',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ progress: sender.pause() });
  }),
);

campaignsRouter.post(
  '/:id/resume',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ progress: sender.resume() });
  }),
);

campaignsRouter.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ progress: await sender.cancel() });
  }),
);

campaignsRouter.post(
  '/:id/clear-queue',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(sender.clearQueue(Number(req.params.id)));
  }),
);

/** Re-queues everything that failed, so a transient outage can be retried in one click. */
campaignsRouter.post(
  '/:id/retry-failed',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    requireCampaign(id);
    const result = run(
      "UPDATE queue_items SET status = 'pending', attempts = 0, error = NULL WHERE campaign_id = ? AND status = 'failed'",
      id,
    );
    res.json({ requeued: result.changes });
  }),
);

campaignsRouter.get(
  '/:id/queue',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);

    const rows = status
      ? all('SELECT * FROM queue_items WHERE campaign_id = ? AND status = ? ORDER BY position LIMIT ?', id, status, limit)
      : all('SELECT * FROM queue_items WHERE campaign_id = ? ORDER BY position LIMIT ?', id, limit);

    res.json({ items: rows });
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ResolvedRecipient {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
}

function resolveRecipients(input: {
  recipientIds?: number[];
  groupId?: number | null;
  includeAll?: boolean;
}): ResolvedRecipient[] {
  if (input.recipientIds && input.recipientIds.length > 0) {
    const placeholders = input.recipientIds.map(() => '?').join(',');
    return all<ResolvedRecipient>(
      `SELECT id, email, name, company FROM recipients
        WHERE id IN (${placeholders}) AND unsubscribed = 0 ORDER BY id`,
      ...input.recipientIds,
    );
  }

  if (input.groupId) {
    return all<ResolvedRecipient>(
      'SELECT id, email, name, company FROM recipients WHERE group_id = ? AND unsubscribed = 0 ORDER BY id',
      input.groupId,
    );
  }

  if (input.includeAll === false) return [];

  // Everyone. Note this is deliberately unpaginated — the list endpoint caps results
  // for the UI, but a send has to cover the entire address book.
  return all<ResolvedRecipient>('SELECT id, email, name, company FROM recipients WHERE unsubscribed = 0 ORDER BY id');
}

function signatureSuffix(sample: { email: string; name: string | null; company: string | null }): string {
  const signature = getSetting('signature_html');
  return signature.trim() ? `<br /><br />${sanitizeHtml(renderTemplate(signature, sample))}` : '';
}

function requireCampaign(id: number): CampaignRow {
  const campaign = get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', id);
  if (!campaign) throw AppError.notFound('Campaign not found');
  return campaign;
}

function publicCampaign(row: CampaignRow) {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.body_html,
    status: row.status,
    accountId: row.account_id,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    attachmentCount: row.attachments ? (JSON.parse(row.attachments) as unknown[]).length : 0,
  };
}

function humanDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
