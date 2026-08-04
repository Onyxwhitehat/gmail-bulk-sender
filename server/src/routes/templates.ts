import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../db/index.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { sanitizeHtml } from '../lib/html.js';
import { requireAuth } from '../middleware/auth.js';

export const templatesRouter = Router();

interface TemplateRow {
  id: number;
  name: string;
  subject: string;
  body_html: string;
  created_at: string;
  updated_at: string;
}

const templateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().max(1000).default(''),
  bodyHtml: z.string().max(2_000_000).default(''),
});

templatesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ templates: all<TemplateRow>('SELECT * FROM templates ORDER BY updated_at DESC').map(toPublic) });
  }),
);

templatesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = templateSchema.parse(req.body);
    const result = run(
      'INSERT INTO templates (name, subject, body_html) VALUES (?, ?, ?)',
      input.name,
      input.subject,
      sanitizeHtml(input.bodyHtml),
    );
    res.status(201).json({ template: toPublic(requireTemplate(result.lastInsertRowid)) });
  }),
);

templatesRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    requireTemplate(id);
    const input = templateSchema.parse(req.body);
    run(
      "UPDATE templates SET name = ?, subject = ?, body_html = ?, updated_at = datetime('now') WHERE id = ?",
      input.name,
      input.subject,
      sanitizeHtml(input.bodyHtml),
      id,
    );
    res.json({ template: toPublic(requireTemplate(id)) });
  }),
);

templatesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    run('DELETE FROM templates WHERE id = ?', Number(req.params.id));
    res.json({ ok: true });
  }),
);

function requireTemplate(id: number): TemplateRow {
  const row = get<TemplateRow>('SELECT * FROM templates WHERE id = ?', id);
  if (!row) throw AppError.notFound('Template not found');
  return row;
}

function toPublic(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.body_html,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
