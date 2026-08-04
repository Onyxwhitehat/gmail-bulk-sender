import { Router } from 'express';
import { all, get } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDefaultAccount, listAccounts, publicAccount } from '../services/google.js';
import { countRecipients } from '../services/recipients.js';
import { sender } from '../services/sender.js';
import { getNumberSetting } from '../services/settings.js';

export const statsRouter = Router();

const countOf = (sql: string, ...params: unknown[]): number =>
  get<{ count: number }>(sql, ...params)?.count ?? 0;

/** Everything the dashboard cards need, in one round trip. */
statsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const account = getDefaultAccount();

    const sentToday = countOf(
      "SELECT COUNT(*) AS count FROM send_logs WHERE status = 'sent' AND date(created_at, 'localtime') = date('now', 'localtime')",
    );
    const failedToday = countOf(
      "SELECT COUNT(*) AS count FROM send_logs WHERE status = 'failed' AND date(created_at, 'localtime') = date('now', 'localtime')",
    );
    const sentAllTime = countOf("SELECT COUNT(*) AS count FROM send_logs WHERE status = 'sent'");
    const failedAllTime = countOf("SELECT COUNT(*) AS count FROM send_logs WHERE status = 'failed'");
    const attempted = sentAllTime + failedAllTime;

    const dailyLimit = getNumberSetting('daily_limit');

    res.json({
      gmail: {
        connected: Boolean(account),
        account: account ? publicAccount(account) : null,
        accountCount: listAccounts().length,
      },
      recipients: {
        total: countRecipients(),
        unsubscribed: countOf('SELECT COUNT(*) AS count FROM recipients WHERE unsubscribed = 1'),
        groups: countOf('SELECT COUNT(*) AS count FROM recipient_groups'),
      },
      sending: {
        sentToday,
        failedToday,
        sentAllTime,
        failedAllTime,
        successRate: attempted === 0 ? null : Number(((sentAllTime / attempted) * 100).toFixed(1)),
        dailyLimit,
        dailyRemaining: Math.max(0, dailyLimit - sentToday),
      },
      campaigns: {
        total: countOf('SELECT COUNT(*) AS count FROM campaigns'),
        running: countOf("SELECT COUNT(*) AS count FROM campaigns WHERE status IN ('running', 'paused')"),
        completed: countOf("SELECT COUNT(*) AS count FROM campaigns WHERE status = 'completed'"),
      },
      progress: sender.status(),
      recentActivity: all(
        `SELECT id, recipient, status, subject, created_at, error
           FROM send_logs ORDER BY id DESC LIMIT 8`,
      ),
      dailySeries: all(
        `SELECT date(created_at, 'localtime') AS day,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
           FROM send_logs
          WHERE created_at >= datetime('now', '-13 days')
          GROUP BY day ORDER BY day`,
      ),
    });
  }),
);
