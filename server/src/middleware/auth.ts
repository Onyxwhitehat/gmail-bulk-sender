import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { get, run } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface SessionUser {
  id: number;
  email: string;
  name: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  password_hash: string;
}

export function countUsers(): number {
  const row = get<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  return row?.count ?? 0;
}

export async function createUser(email: string, password: string, name?: string): Promise<SessionUser> {
  if (password.length < 8) {
    throw AppError.badRequest('Password must be at least 8 characters long');
  }
  const existing = get<UserRow>('SELECT * FROM users WHERE email = ?', email.toLowerCase());
  if (existing) throw AppError.conflict('An account with that email already exists');

  const hash = await bcrypt.hash(password, 12);
  const result = run(
    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
    email.toLowerCase(),
    hash,
    name ?? null,
  );
  return { id: result.lastInsertRowid, email: email.toLowerCase(), name: name ?? null };
}

export async function verifyCredentials(email: string, password: string): Promise<SessionUser> {
  const row = get<UserRow>('SELECT * FROM users WHERE email = ?', email.toLowerCase());

  // Always run a hash comparison so a missing user and a wrong password take the
  // same amount of time — otherwise the response time enumerates valid accounts.
  const hash = row?.password_hash ?? '$2a$12$0000000000000000000000000000000000000000000000000000';
  const ok = await bcrypt.compare(password, hash);

  if (!row || !ok) throw AppError.unauthorized('Invalid email or password');

  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", row.id);
  return { id: row.id, email: row.email, name: row.name };
}

export function issueSession(res: Response, user: SessionUser): void {
  const token = jwt.sign({ sub: String(user.id), email: user.email, name: user.name }, config.sessionSecret, {
    expiresIn: `${config.sessionTtlHours}h`,
  });

  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: config.cookieSameSite,
    maxAge: config.sessionTtlHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: config.cookieSameSite,
    path: '/',
  });
}

function readSession(req: Request): SessionUser | null {
  const token = req.cookies?.[config.cookieName];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.sessionSecret) as jwt.JwtPayload;
    const id = Number(payload.sub);
    if (!Number.isFinite(id)) return null;
    // Confirm the user still exists — a deleted account must not keep a live session.
    const row = get<UserRow>('SELECT id, email, name FROM users WHERE id = ?', id);
    return row ? { id: row.id, email: row.email, name: row.name } : null;
  } catch (error) {
    logger.debug('session token rejected', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Populates `req.user` when a valid session exists, but never blocks the request. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const user = readSession(req);
  if (user) req.user = user;
  next();
}

/** Rejects the request unless a valid session is present. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(AppError.unauthorized('Please sign in to continue'));
    return;
  }
  next();
}
