import type { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

/**
 * Double-submit cookie CSRF protection.
 *
 * The token lives in a readable (non-httpOnly) cookie; the client echoes it in the
 * `X-CSRF-Token` header. A cross-site attacker can cause the cookie to be *sent*,
 * but same-origin policy prevents them from *reading* it to build the header.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(res: Response): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(config.csrfCookieName, token, {
    httpOnly: false, // must be readable by the dashboard's JS
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlHours * 3600 * 1000,
  });
  return token;
}

/** Ensures a CSRF cookie exists on every safe request so the client always has one. */
export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) && !req.cookies?.[config.csrfCookieName]) {
    issueCsrfToken(res);
  }
  next();
}

export function verifyCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // The OAuth callback is a top-level redirect from Google and carries its own
  // `state` nonce, which serves the same purpose.
  if (req.path.startsWith('/api/google/callback')) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[config.csrfCookieName];
  const headerToken = req.get('x-csrf-token') ?? '';

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    next(new AppError(403, 'Invalid or missing CSRF token. Refresh the page and try again.', 'csrf_error'));
    return;
  }

  next();
}
