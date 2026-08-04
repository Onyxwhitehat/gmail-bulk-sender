import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const keyByUserOrIp = (req: Request): string =>
  req.user ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;

/** Baseline limit for the whole API. Generous enough for normal dashboard use. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  // We key by session first and fall back to the raw IP; the library's IPv6-subnet
  // validator does not apply here, and its warning is noise on boot.
  validate: false,
  message: { error: 'Too many requests. Please slow down.', code: 'rate_limited' },
});

/** Tight limit on credential endpoints to blunt brute-force attempts. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.', code: 'rate_limited' },
});

/** Guards the expensive endpoints: Google API calls and bulk imports. */
export const heavyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  // We key by session first and fall back to the raw IP; the library's IPv6-subnet
  // validator does not apply here, and its warning is noise on boot.
  validate: false,
  message: { error: 'Too many requests to this endpoint. Please wait a moment.', code: 'rate_limited' },
});
