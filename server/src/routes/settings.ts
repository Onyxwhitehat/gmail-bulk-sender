import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { sanitizeHtml } from '../lib/html.js';
import { requireAuth } from '../middleware/auth.js';
import { getPublicSettings, setSetting } from '../services/settings.js';
import { config } from '../config.js';

export const settingsRouter = Router();

/**
 * Note the deliberate asymmetry: secrets can be written but are only ever read
 * back masked. An empty string means "leave the stored value alone", so the UI can
 * submit the whole form without needing to re-type the client secret every time.
 */
const updateSchema = z.object({
  google_client_id: z.string().trim().max(300).optional(),
  google_client_secret: z.string().trim().max(300).optional(),
  google_redirect_uri: z.string().trim().max(500).optional(),
  sender_name: z.string().trim().max(120).optional(),
  reply_to: z.union([z.string().trim().email('Reply-To must be a valid email address'), z.literal('')]).optional(),
  delay_min_ms: z.coerce.number().int().min(0).max(600_000).optional(),
  delay_max_ms: z.coerce.number().int().min(0).max(600_000).optional(),
  daily_limit: z.coerce.number().int().min(1).max(10_000).optional(),
  max_retries: z.coerce.number().int().min(0).max(10).optional(),
  signature_html: z.string().max(100_000).optional(),
  batch_pause_every: z.coerce.number().int().min(0).max(10_000).optional(),
  batch_pause_ms: z.coerce.number().int().min(0).max(3_600_000).optional(),
});

settingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      settings: getPublicSettings(),
      defaults: {
        redirectUri: `${config.apiUrl}/api/google/callback`,
        appUrl: config.appUrl,
        apiUrl: config.apiUrl,
      },
    });
  }),
);

settingsRouter.put(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);

    if (
      input.delay_min_ms !== undefined &&
      input.delay_max_ms !== undefined &&
      input.delay_min_ms > input.delay_max_ms
    ) {
      res.status(400).json({ error: 'Minimum delay cannot be greater than the maximum delay.', code: 'bad_request' });
      return;
    }

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      // A blank secret means "keep what is stored" rather than "erase it".
      if (key === 'google_client_secret' && value === '') continue;

      const stringValue = key === 'signature_html' ? sanitizeHtml(String(value)) : String(value);
      setSetting(key as keyof typeof input, stringValue);
    }

    res.json({ settings: getPublicSettings() });
  }),
);
