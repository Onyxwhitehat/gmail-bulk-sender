import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import { escapeHtml } from '../lib/html.js';
import { requireAuth } from '../middleware/auth.js';

export const logsRouter = Router();

interface LogRow {
  id: number;
  campaign_id: number | null;
  campaign_name: string | null;
  account_email: string | null;
  recipient: string;
  recipient_name: string | null;
  subject: string | null;
  status: string;
  message_id: string | null;
  error: string | null;
  attempts: number;
  duration_ms: number | null;
  created_at: string;
}

const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['sent', 'failed', 'skipped']).optional(),
  campaignId: z.coerce.number().int().positive().optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

type LogQuery = z.infer<typeof querySchema>;

function buildWhere(query: LogQuery): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.search) {
    where.push('(recipient LIKE ? OR IFNULL(recipient_name, "") LIKE ? OR IFNULL(subject, "") LIKE ? OR IFNULL(error, "") LIKE ? OR IFNULL(message_id, "") LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like, like, like);
  }
  if (query.status) {
    where.push('status = ?');
    params.push(query.status);
  }
  if (query.campaignId) {
    where.push('campaign_id = ?');
    params.push(query.campaignId);
  }
  if (query.from) {
    where.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('created_at <= ?');
    params.push(`${query.to} 23:59:59`);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

logsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const { clause, params } = buildWhere(query);

    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM send_logs ${clause}`, ...params)?.count ?? 0;
    const rows = all<LogRow>(
      `SELECT * FROM send_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...params,
      query.limit,
      query.offset,
    );

    const counts = all<{ status: string; count: number }>(
      `SELECT status, COUNT(*) AS count FROM send_logs ${clause} GROUP BY status`,
      ...params,
    );

    res.json({
      logs: rows.map(toPublic),
      total,
      limit: query.limit,
      offset: query.offset,
      counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
    });
  }),
);

const EXPORT_COLUMNS = [
  'Timestamp',
  'Recipient',
  'Name',
  'Status',
  'Subject',
  'Campaign',
  'From Account',
  'Message ID',
  'Attempts',
  'Duration (ms)',
  'Error',
] as const;

function exportRows(query: LogQuery): string[][] {
  const { clause, params } = buildWhere(query);
  const rows = all<LogRow>(`SELECT * FROM send_logs ${clause} ORDER BY id DESC LIMIT 100000`, ...params);
  return rows.map((row) => [
    row.created_at,
    row.recipient,
    row.recipient_name ?? '',
    row.status,
    row.subject ?? '',
    row.campaign_name ?? (row.campaign_id ? `#${row.campaign_id}` : ''),
    row.account_email ?? '',
    row.message_id ?? '',
    String(row.attempts),
    row.duration_ms === null ? '' : String(row.duration_ms),
    row.error ?? '',
  ]);
}

function csvCell(value: string): string {
  // Prefix formula-triggering characters so a spreadsheet cannot execute log content.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

logsRouter.get(
  '/export.csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const rows = exportRows(query);
    const csv = [EXPORT_COLUMNS.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="send-logs-${stamp()}.csv"`);
    // UTF-8 BOM so Excel opens accented characters correctly.
    res.send(`﻿${csv}`);
  }),
);

/**
 * Excel export.
 *
 * This writes SpreadsheetML (Excel's XML workbook format) rather than XLSX, so
 * there is no zip/binary dependency — Excel, LibreOffice and Google Sheets all
 * open it natively, and column types survive the round trip.
 */
logsRouter.get(
  '/export.xls',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const rows = exportRows(query);

    const headerCells = EXPORT_COLUMNS.map(
      (column) => `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeHtml(column)}</Data></Cell>`,
    ).join('');

    const bodyRows = rows
      .map(
        (row) =>
          `<Row>${row
            .map((cell) => `<Cell><Data ss:Type="String">${escapeHtml(cell)}</Data></Cell>`)
            .join('')}</Row>`,
      )
      .join('');

    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Send Logs">
    <Table>
      <Row>${headerCells}</Row>
      ${bodyRows}
    </Table>
  </Worksheet>
</Workbook>`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="send-logs-${stamp()}.xls"`);
    res.send(workbook);
  }),
);

logsRouter.delete(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const result = before ? run('DELETE FROM send_logs WHERE created_at < ?', before) : run('DELETE FROM send_logs');
    res.json({ deleted: result.changes });
  }),
);

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function toPublic(row: LogRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    accountEmail: row.account_email,
    recipient: row.recipient,
    recipientName: row.recipient_name,
    subject: row.subject,
    status: row.status,
    messageId: row.message_id,
    error: row.error,
    attempts: row.attempts,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}
