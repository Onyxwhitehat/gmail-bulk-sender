import { all, get, run } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { isValidEmail } from '../lib/emails.js';
import { logger } from '../lib/logger.js';
import { sendMessage } from './gmail.js';
import { events } from './events.js';
import { getAccount, getDefaultAccount, markAccountError } from './google.js';
import { getNumberSetting, getSetting } from './settings.js';
import type { Attachment } from './mime.js';

export type EngineState = 'idle' | 'running' | 'paused' | 'cancelling' | 'completed';

export interface CampaignRow {
  id: number;
  name: string | null;
  subject: string;
  body_html: string;
  attachments: string | null;
  status: string;
  account_id: number | null;
  total: number;
  sent: number;
  failed: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface QueueItemRow {
  id: number;
  campaign_id: number;
  recipient_id: number | null;
  email: string;
  name: string | null;
  company: string | null;
  status: string;
  attempts: number;
  message_id: string | null;
  error: string | null;
  position: number;
}

export interface ProgressSnapshot {
  state: EngineState;
  campaignId: number | null;
  campaignName: string | null;
  subject: string | null;
  accountEmail: string | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  remaining: number;
  currentIndex: number;
  currentEmail: string | null;
  currentName: string | null;
  startedAt: string | null;
  elapsedMs: number;
  etaMs: number | null;
  perMinute: number;
  lastError: string | null;
  pauseReason: string | null;
  dailySent: number;
  dailyLimit: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Error codes that make the rest of the queue pointless: the account needs
 * re-authorising, or the OAuth client itself is misconfigured. Both stop the run.
 */
const FATAL_CODES = new Set(['reauth_required', 'auth_config_error', 'google_forbidden']);

/**
 * Sequential bulk-send engine.
 *
 * One campaign runs at a time. Sending strictly one message at a time (with a
 * randomised human-like delay) is the single most effective way to stay inside
 * Gmail's per-account limits and out of spam filters — parallelism here would be
 * a false economy.
 */
class SendEngine {
  private state: EngineState = 'idle';
  private campaignId: number | null = null;
  private accountEmail: string | null = null;
  private startedAtMs: number | null = null;
  private currentItem: QueueItemRow | null = null;
  private currentIndex = 0;
  private skipped = 0;
  private lastError: string | null = null;
  private pauseReason: string | null = null;
  private cancelRequested = false;
  private loop: Promise<void> | null = null;

  /** Recovers from an unclean shutdown: anything mid-flight goes back to pending. */
  recoverOnBoot(): void {
    const reset = run("UPDATE queue_items SET status = 'pending' WHERE status = 'sending'");
    if (reset.changes > 0) {
      logger.warn(`recovered ${reset.changes} in-flight queue item(s) after restart`);
    }
    run("UPDATE campaigns SET status = 'paused' WHERE status = 'running'");
  }

  isBusy(): boolean {
    return this.state === 'running' || this.state === 'paused' || this.state === 'cancelling';
  }

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  async start(campaignId: number): Promise<ProgressSnapshot> {
    if (this.isBusy()) {
      throw AppError.conflict(
        `A send is already ${this.state}. Cancel or finish it before starting another campaign.`,
      );
    }

    const campaign = this.requireCampaign(campaignId);

    const pending = this.countByStatus(campaignId, 'pending');
    if (pending === 0) {
      throw AppError.badRequest('There is nothing left to send in this campaign. Add recipients first.');
    }

    const account = campaign.account_id ? getAccount(campaign.account_id) : getDefaultAccount();
    if (!account) {
      throw AppError.badRequest('No Gmail account is connected. Connect one on the Gmail Connection page first.');
    }

    run("UPDATE campaigns SET account_id = ?, status = 'running', started_at = COALESCE(started_at, datetime('now')), finished_at = NULL, updated_at = datetime('now') WHERE id = ?", account.id, campaignId);

    this.campaignId = campaignId;
    this.accountEmail = account.email;
    this.state = 'running';
    this.startedAtMs = Date.now();
    this.currentIndex = 0;
    this.skipped = 0;
    this.lastError = null;
    this.pauseReason = null;
    this.cancelRequested = false;

    logger.info(`campaign #${campaignId} started with ${pending} pending recipient(s) via ${account.email}`);
    this.loop = this.processQueue(account.id).catch((error) => {
      logger.error('send loop crashed', error);
      this.lastError = error instanceof Error ? error.message : String(error);
      this.state = 'paused';
      this.pauseReason = this.lastError;
      this.emitProgress();
    });

    return this.status();
  }

  pause(reason?: string): ProgressSnapshot {
    if (this.state !== 'running') {
      throw AppError.badRequest('Nothing is sending right now.');
    }
    this.state = 'paused';
    this.pauseReason = reason ?? 'Paused manually';
    if (this.campaignId) {
      run("UPDATE campaigns SET status = 'paused', updated_at = datetime('now') WHERE id = ?", this.campaignId);
    }
    logger.info(`campaign #${this.campaignId} paused: ${this.pauseReason}`);
    this.emitProgress();
    return this.status();
  }

  resume(): ProgressSnapshot {
    if (this.state !== 'paused') {
      throw AppError.badRequest('The queue is not paused.');
    }
    this.state = 'running';
    this.pauseReason = null;
    if (this.campaignId) {
      run("UPDATE campaigns SET status = 'running', updated_at = datetime('now') WHERE id = ?", this.campaignId);
    }
    logger.info(`campaign #${this.campaignId} resumed`);
    this.emitProgress();
    return this.status();
  }

  /** Requests cancellation; the loop stops after the in-flight message completes. */
  async cancel(): Promise<ProgressSnapshot> {
    if (!this.isBusy()) {
      throw AppError.badRequest('Nothing is sending right now.');
    }
    this.cancelRequested = true;
    this.state = 'cancelling';
    this.pauseReason = null;
    this.emitProgress();

    if (this.loop) await this.loop;
    return this.status();
  }

  /** Removes not-yet-sent items. Sent items and their logs are always preserved. */
  clearQueue(campaignId: number): { removed: number } {
    if (this.isBusy() && this.campaignId === campaignId) {
      throw AppError.conflict('Cancel the running send before clearing its queue.');
    }
    const result = run("DELETE FROM queue_items WHERE campaign_id = ? AND status IN ('pending', 'failed', 'skipped')", campaignId);
    this.syncCampaignCounts(campaignId);
    this.emitProgress();
    return { removed: result.changes };
  }

  // -------------------------------------------------------------------------
  // The loop
  // -------------------------------------------------------------------------

  private async processQueue(accountId: number): Promise<void> {
    const campaignId = this.campaignId;
    if (campaignId === null) return;

    const campaign = this.requireCampaign(campaignId);
    const attachments = this.parseAttachments(campaign.attachments);
    const maxRetries = Math.max(0, Math.min(10, getNumberSetting('max_retries')));
    const dailyLimit = getNumberSetting('daily_limit');
    const batchEvery = getNumberSetting('batch_pause_every');
    const batchPauseMs = getNumberSetting('batch_pause_ms');

    const senderName = getSetting('sender_name');
    const replyTo = getSetting('reply_to');
    const signature = getSetting('signature_html');

    let sentThisRun = 0;
    this.emitProgress();

    for (;;) {
      if (this.cancelRequested) break;

      // Idle-wait while paused, staying responsive to cancel.
      while (this.state === 'paused' && !this.cancelRequested) {
        await sleep(250);
      }
      if (this.cancelRequested) break;

      const item = get<QueueItemRow>(
        "SELECT * FROM queue_items WHERE campaign_id = ? AND status = 'pending' ORDER BY position ASC, id ASC LIMIT 1",
        campaignId,
      );
      if (!item) break;

      if (this.dailySentCount() >= dailyLimit) {
        this.pause(
          `Daily sending limit of ${dailyLimit} reached. The queue will resume when you press Resume (ideally tomorrow).`,
        );
        continue;
      }

      this.currentItem = item;
      this.currentIndex += 1;
      run("UPDATE queue_items SET status = 'sending' WHERE id = ?", item.id);
      this.emitProgress();

      if (!isValidEmail(item.email)) {
        this.finishItem(item, 'skipped', {
          error: 'Invalid email address — skipped without sending',
          campaign,
          attempts: 0,
        });
        this.skipped += 1;
        continue;
      }

      const startedAt = Date.now();
      const outcome = await this.attemptSend({
        accountId,
        item,
        campaign,
        attachments,
        maxRetries,
        senderName,
        replyTo,
        signature,
      });

      if (outcome.kind === 'sent') {
        this.finishItem(item, 'sent', {
          messageId: outcome.messageId,
          threadId: outcome.threadId,
          attempts: outcome.attempts,
          durationMs: Date.now() - startedAt,
          campaign,
        });
        sentThisRun += 1;
      } else {
        this.finishItem(item, 'failed', {
          error: outcome.error,
          attempts: outcome.attempts,
          durationMs: Date.now() - startedAt,
          campaign,
        });
        this.lastError = outcome.error;

        if (outcome.fatal) {
          // Reauth or configuration failures affect every remaining message —
          // stop rather than burning through the queue generating identical errors.
          markAccountError(accountId, outcome.error);
          this.pause(`Sending stopped: ${outcome.error}`);
          continue;
        }
      }

      if (this.cancelRequested) break;

      // Optional long pause every N messages, on top of the per-message delay.
      if (batchEvery > 0 && sentThisRun > 0 && sentThisRun % batchEvery === 0) {
        logger.info(`batch pause: ${batchPauseMs}ms after ${sentThisRun} sends`);
        await this.interruptibleSleep(batchPauseMs);
      }

      const remaining = this.countByStatus(campaignId, 'pending');
      if (remaining > 0) await this.interruptibleSleep(this.nextDelay());
    }

    this.finishRun();
  }

  private async attemptSend(options: {
    accountId: number;
    item: QueueItemRow;
    campaign: CampaignRow;
    attachments: Attachment[];
    maxRetries: number;
    senderName: string;
    replyTo: string;
    signature: string;
  }): Promise<
    | { kind: 'sent'; messageId: string; threadId: string; attempts: number }
    | { kind: 'failed'; error: string; attempts: number; fatal: boolean }
  > {
    const { accountId, item, campaign, attachments, maxRetries } = options;
    const html = renderBody(campaign.body_html, options.signature, item);
    const subject = renderTemplate(campaign.subject, item);

    let attempts = 0;
    let lastError = 'Unknown error';

    while (attempts <= maxRetries) {
      attempts += 1;
      try {
        const result = await sendMessage(accountId, {
          from: this.accountEmail ?? '',
          fromName: options.senderName || undefined,
          to: item.email,
          toName: item.name ?? undefined,
          subject,
          html,
          replyTo: options.replyTo || undefined,
          attachments,
        });
        return { kind: 'sent', messageId: result.id, threadId: result.threadId, attempts };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        const status = error instanceof AppError ? error.status : 0;
        const code = error instanceof AppError ? error.code : '';

        // Authorisation and configuration problems will not fix themselves on
        // retry, and they affect every remaining recipient equally — stop the run
        // rather than replaying the same failure hundreds of times.
        if (FATAL_CODES.has(code) || status === 401 || status === 403) {
          return { kind: 'failed', error: lastError, attempts, fatal: true };
        }
        // A malformed address is this recipient's problem alone — fail fast, keep going.
        if (status === 400) {
          return { kind: 'failed', error: lastError, attempts, fatal: false };
        }
        if (attempts > maxRetries) break;

        // Exponential backoff with a ceiling; rate limits get extra room.
        const backoff = Math.min(30_000, 1000 * 2 ** (attempts - 1)) + (status === 429 ? 5000 : 0);
        logger.warn(`send to ${item.email} failed (attempt ${attempts}/${maxRetries + 1}): ${lastError} — retrying in ${backoff}ms`);
        run('UPDATE queue_items SET attempts = ? WHERE id = ?', attempts, item.id);
        this.emitProgress();
        await this.interruptibleSleep(backoff);
        if (this.cancelRequested) break;
      }
    }

    return { kind: 'failed', error: lastError, attempts, fatal: false };
  }

  /** Sleeps in slices so pause/cancel take effect promptly during long waits. */
  private async interruptibleSleep(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.cancelRequested) return;
      await sleep(Math.min(200, deadline - Date.now()));
    }
  }

  private nextDelay(): number {
    const min = Math.max(0, getNumberSetting('delay_min_ms'));
    const max = Math.max(min, getNumberSetting('delay_max_ms'));
    return Math.round(min + Math.random() * (max - min));
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  private finishItem(
    item: QueueItemRow,
    status: 'sent' | 'failed' | 'skipped',
    extra: {
      messageId?: string;
      threadId?: string;
      error?: string;
      attempts: number;
      durationMs?: number;
      campaign: CampaignRow;
    },
  ): void {
    run(
      `UPDATE queue_items
          SET status = ?, attempts = ?, message_id = ?, thread_id = ?, error = ?, sent_at = ?
        WHERE id = ?`,
      status,
      extra.attempts,
      extra.messageId ?? null,
      extra.threadId ?? null,
      extra.error ?? null,
      status === 'sent' ? new Date().toISOString() : null,
      item.id,
    );

    run(
      `INSERT INTO send_logs
        (campaign_id, campaign_name, account_email, recipient, recipient_name, subject, status, message_id, error, attempts, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      extra.campaign.id,
      extra.campaign.name ?? null,
      this.accountEmail,
      item.email,
      item.name ?? null,
      extra.campaign.subject,
      status,
      extra.messageId ?? null,
      extra.error ?? null,
      extra.attempts,
      extra.durationMs ?? null,
    );

    this.syncCampaignCounts(extra.campaign.id);

    events.broadcast({
      type: 'log',
      payload: {
        campaignId: extra.campaign.id,
        recipient: item.email,
        name: item.name,
        status,
        messageId: extra.messageId ?? null,
        error: extra.error ?? null,
        attempts: extra.attempts,
        at: new Date().toISOString(),
      },
    });

    this.emitProgress();
  }

  private syncCampaignCounts(campaignId: number): void {
    run(
      `UPDATE campaigns SET
         total  = (SELECT COUNT(*) FROM queue_items WHERE campaign_id = ?),
         sent   = (SELECT COUNT(*) FROM queue_items WHERE campaign_id = ? AND status = 'sent'),
         failed = (SELECT COUNT(*) FROM queue_items WHERE campaign_id = ? AND status = 'failed'),
         updated_at = datetime('now')
       WHERE id = ?`,
      campaignId,
      campaignId,
      campaignId,
      campaignId,
    );
  }

  private finishRun(): void {
    const campaignId = this.campaignId;
    if (campaignId !== null) {
      const pending = this.countByStatus(campaignId, 'pending');
      const status = this.cancelRequested ? 'cancelled' : pending > 0 ? 'paused' : 'completed';
      run(
        "UPDATE campaigns SET status = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        status,
        campaignId,
      );
      logger.info(`campaign #${campaignId} ${status} (${this.countByStatus(campaignId, 'sent')} sent, ${this.countByStatus(campaignId, 'failed')} failed)`);
    }

    this.state = this.cancelRequested ? 'idle' : 'completed';
    this.currentItem = null;
    this.cancelRequested = false;
    this.loop = null;
    this.emitProgress();
  }

  private countByStatus(campaignId: number, status: string): number {
    return (
      get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM queue_items WHERE campaign_id = ? AND status = ?',
        campaignId,
        status,
      )?.count ?? 0
    );
  }

  /** Messages successfully sent since local midnight — the daily-limit counter. */
  dailySentCount(): number {
    return (
      get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM send_logs WHERE status = 'sent' AND date(created_at, 'localtime') = date('now', 'localtime')",
      )?.count ?? 0
    );
  }

  private parseAttachments(json: string | null): Attachment[] {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json) as Attachment[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private requireCampaign(campaignId: number): CampaignRow {
    const campaign = get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', campaignId);
    if (!campaign) throw AppError.notFound('Campaign not found');
    return campaign;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  status(): ProgressSnapshot {
    const campaignId = this.campaignId;
    const campaign = campaignId ? get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', campaignId) : undefined;

    const counts = campaignId
      ? Object.fromEntries(
          all<{ status: string; count: number }>(
            'SELECT status, COUNT(*) AS count FROM queue_items WHERE campaign_id = ? GROUP BY status',
            campaignId,
          ).map((r) => [r.status, r.count]),
        )
      : {};

    const sent = counts.sent ?? 0;
    const failed = counts.failed ?? 0;
    const skipped = counts.skipped ?? 0;
    const pending = (counts.pending ?? 0) + (counts.sending ?? 0);
    const total = sent + failed + skipped + pending;

    const elapsedMs = this.startedAtMs ? Date.now() - this.startedAtMs : 0;
    const processed = sent + failed + skipped;
    const perMs = processed > 0 && elapsedMs > 0 ? processed / elapsedMs : 0;
    const etaMs = perMs > 0 && pending > 0 ? Math.round(pending / perMs) : null;

    return {
      state: this.state,
      campaignId,
      campaignName: campaign?.name ?? null,
      subject: campaign?.subject ?? null,
      accountEmail: this.accountEmail,
      total,
      sent,
      failed,
      skipped,
      pending,
      remaining: pending,
      currentIndex: this.currentIndex,
      currentEmail: this.currentItem?.email ?? null,
      currentName: this.currentItem?.name ?? null,
      startedAt: this.startedAtMs ? new Date(this.startedAtMs).toISOString() : null,
      elapsedMs,
      etaMs,
      perMinute: elapsedMs > 0 ? Number(((processed / elapsedMs) * 60_000).toFixed(1)) : 0,
      lastError: this.lastError,
      pauseReason: this.pauseReason,
      dailySent: this.dailySentCount(),
      dailyLimit: getNumberSetting('daily_limit'),
    };
  }

  emitProgress(): void {
    events.broadcast({ type: 'progress', payload: this.status() });
  }
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Substitutes `{{name}}`, `{{email}}` and `{{company}}` placeholders.
 * Unknown variables are left intact so a typo is visible rather than silently blank.
 */
export function renderTemplate(template: string, item: { email: string; name?: string | null; company?: string | null }): string {
  const values: Record<string, string> = {
    email: item.email,
    name: item.name?.trim() || item.email.split('@')[0],
    first_name: (item.name?.trim() || '').split(/\s+/)[0] || item.email.split('@')[0],
    company: item.company?.trim() || '',
  };

  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    const value = values[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

function renderBody(bodyHtml: string, signature: string, item: QueueItemRow): string {
  const body = renderTemplate(bodyHtml, item);
  if (!signature.trim()) return body;
  return `${body}<br /><br />${renderTemplate(signature, item)}`;
}

export const sender = new SendEngine();
