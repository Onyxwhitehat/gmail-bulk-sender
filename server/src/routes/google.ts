import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimit.js';
import { events } from '../services/events.js';
import { getProfile, sendTestMessage } from '../services/gmail.js';
import {
  buildAuthUrl,
  consumeState,
  disconnectAccount,
  exchangeCodeForTokens,
  getAccount,
  getDefaultAccount,
  listAccounts,
  publicAccount,
  refreshAccessToken,
  saveAccountFromTokens,
  setDefaultAccount,
} from '../services/google.js';
import { getSetting } from '../services/settings.js';
import { sanitizeHtml } from '../lib/html.js';

export const googleRouter = Router();

/** Starts the OAuth handshake: returns the Google consent URL for the browser to visit. */
googleRouter.post(
  '/connect',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const url = buildAuthUrl(req.user!.id);
    res.json({ url });
  }),
);

/**
 * OAuth redirect target. Google sends the browser here, so this responds with a
 * redirect back into the dashboard rather than JSON.
 */
googleRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const redirect = (params: Record<string, string>) =>
      res.redirect(`${config.appUrl}/gmail?${new URLSearchParams(params).toString()}`);

    const { code, state, error: oauthError } = req.query as Record<string, string | undefined>;

    if (oauthError) {
      logger.warn(`OAuth denied by user: ${oauthError}`);
      return redirect({ status: 'error', message: `Google returned: ${oauthError}` });
    }
    if (!code || !state) {
      return redirect({ status: 'error', message: 'Missing authorisation code or state parameter.' });
    }
    if (consumeState(state) === null) {
      return redirect({ status: 'error', message: 'This authorisation link expired or was already used. Try again.' });
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      const account = await saveAccountFromTokens(tokens);
      events.broadcast({ type: 'account', payload: publicAccount(account) });
      return redirect({ status: 'connected', email: account.email });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authorisation failed';
      logger.error('OAuth callback failed', message);
      return redirect({ status: 'error', message });
    }
  }),
);

googleRouter.get(
  '/accounts',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ accounts: listAccounts().map(publicAccount) });
  }),
);

googleRouter.get(
  '/status',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const account = getDefaultAccount();
    res.json({
      connected: Boolean(account),
      account: account ? publicAccount(account) : null,
      accountCount: listAccounts().length,
    });
  }),
);

/** Forces a token refresh so the user can prove the refresh flow works. */
googleRouter.post(
  '/accounts/:id/refresh',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const account = getAccount(Number(req.params.id));
    if (!account) throw AppError.notFound('Account not found');

    await refreshAccessToken(account);
    const updated = getAccount(account.id)!;
    events.broadcast({ type: 'account', payload: publicAccount(updated) });
    res.json({ account: publicAccount(updated) });
  }),
);

googleRouter.post(
  '/accounts/:id/default',
  requireAuth,
  asyncHandler(async (req, res) => {
    const account = getAccount(Number(req.params.id));
    if (!account) throw AppError.notFound('Account not found');
    setDefaultAccount(account.id);
    res.json({ accounts: listAccounts().map(publicAccount) });
  }),
);

googleRouter.delete(
  '/accounts/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await disconnectAccount(Number(req.params.id));
    res.json({ accounts: listAccounts().map(publicAccount) });
  }),
);

/** Live check against the Gmail API — confirms the token really works. */
googleRouter.get(
  '/accounts/:id/profile',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const account = getAccount(Number(req.params.id));
    if (!account) throw AppError.notFound('Account not found');
    const profile = await getProfile(account.id);
    res.json({ profile });
  }),
);

const testEmailSchema = z.object({
  to: z.string().trim().email().optional(),
  subject: z.string().trim().min(1).max(500).default('Test email from Bulk Email Sender'),
  html: z.string().max(500_000).default('<p>This is a test email. Your Gmail connection is working.</p>'),
});

googleRouter.post(
  '/accounts/:id/test',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const account = getAccount(Number(req.params.id));
    if (!account) throw AppError.notFound('Account not found');

    const { to, subject, html } = testEmailSchema.parse(req.body ?? {});
    const result = await sendTestMessage(account.id, {
      from: account.email,
      fromName: getSetting('sender_name') || undefined,
      replyTo: getSetting('reply_to') || undefined,
      to,
      subject,
      html: sanitizeHtml(html),
    });

    res.json({ ok: true, messageId: result.id, to: to ?? account.email });
  }),
);
