import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { clearSession, countUsers, createUser, issueSession, requireAuth, verifyCredentials } from '../middleware/auth.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { authLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().max(120).optional(),
});

/** Tells the login screen whether the very first admin account still needs creating. */
authRouter.get(
  '/state',
  asyncHandler(async (req, res) => {
    res.json({
      needsSetup: countUsers() === 0,
      authenticated: Boolean(req.user),
      user: req.user ?? null,
      csrfToken: issueCsrfToken(res),
    });
  }),
);

/** One-time bootstrap: only available while no user exists. */
authRouter.post(
  '/setup',
  authLimiter,
  asyncHandler(async (req, res) => {
    if (countUsers() > 0) {
      res.status(409).json({ error: 'Setup has already been completed. Please sign in.', code: 'already_setup' });
      return;
    }
    const { email, password, name } = credentialsSchema.parse(req.body);
    const user = await createUser(email, password, name);
    issueSession(res, user);
    issueCsrfToken(res);
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = credentialsSchema.pick({ email: true, password: true }).parse(req.body);
    const user = await verifyCredentials(email, password);
    issueSession(res, user);
    issueCsrfToken(res);
    res.json({ user });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = passwordChangeSchema.parse(req.body);
    const user = req.user!;
    await verifyCredentials(user.email, currentPassword);

    const bcrypt = (await import('bcryptjs')).default;
    const { run } = await import('../db/index.js');
    run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(newPassword, 12), user.id);

    res.json({ ok: true });
  }),
);
