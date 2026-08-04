import { all, get, run, transaction } from '../db/index.js';
import { isValidEmail, normalizeEmail } from '../lib/emails.js';

export interface RecipientRow {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  source: string;
  source_ref: string | null;
  group_id: number | null;
  is_valid: number;
  unsubscribed: number;
  bounced: number;
  created_at: string;
}

export interface RecipientInput {
  email: string;
  name?: string;
  company?: string;
}

export interface SaveOptions {
  source: 'manual' | 'sheets' | 'csv';
  sourceRef?: string | null;
  groupId?: number | null;
  /** When true, a name/company from the new import overwrites an existing blank one. */
  enrich?: boolean;
}

export interface SaveResult {
  inserted: number;
  updated: number;
  skipped: number;
  invalid: number;
  total: number;
}

/**
 * Upserts recipients. The unique index on `email` does the de-duplication, so
 * importing the same sheet twice is a no-op rather than a source of duplicates.
 */
export function saveRecipients(list: RecipientInput[], options: SaveOptions): SaveResult {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  transaction(() => {
    for (const item of list) {
      const email = normalizeEmail(item.email);
      if (!isValidEmail(email)) {
        invalid += 1;
        continue;
      }

      const existing = get<RecipientRow>('SELECT * FROM recipients WHERE email = ?', email);

      if (!existing) {
        run(
          'INSERT INTO recipients (email, name, company, source, source_ref, group_id) VALUES (?, ?, ?, ?, ?, ?)',
          email,
          item.name?.trim() || null,
          item.company?.trim() || null,
          options.source,
          options.sourceRef ?? null,
          options.groupId ?? null,
        );
        inserted += 1;
        continue;
      }

      // Fill in details we did not have before; never blank out existing data.
      const nextName = existing.name || item.name?.trim() || null;
      const nextCompany = existing.company || item.company?.trim() || null;
      const nextGroup = existing.group_id ?? options.groupId ?? null;

      if (nextName !== existing.name || nextCompany !== existing.company || nextGroup !== existing.group_id) {
        run(
          'UPDATE recipients SET name = ?, company = ?, group_id = ? WHERE id = ?',
          nextName,
          nextCompany,
          nextGroup,
          existing.id,
        );
        updated += 1;
      } else {
        skipped += 1;
      }
    }
  });

  return { inserted, updated, skipped, invalid, total: countRecipients() };
}

export function countRecipients(): number {
  return get<{ count: number }>('SELECT COUNT(*) AS count FROM recipients')?.count ?? 0;
}

export interface ListQuery {
  search?: string;
  groupId?: number | null;
  source?: string;
  limit?: number;
  offset?: number;
  includeUnsubscribed?: boolean;
}

export function listRecipients(query: ListQuery): { rows: RecipientRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.search) {
    where.push('(email LIKE ? OR IFNULL(name, "") LIKE ? OR IFNULL(company, "") LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  if (query.groupId !== undefined && query.groupId !== null) {
    where.push('group_id = ?');
    params.push(query.groupId);
  }
  if (query.source) {
    where.push('source = ?');
    params.push(query.source);
  }
  if (!query.includeUnsubscribed) {
    where.push('unsubscribed = 0');
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM recipients ${clause}`, ...params)?.count ?? 0;

  const rows = all<RecipientRow>(
    `SELECT * FROM recipients ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params,
    Math.min(query.limit ?? 100, 1000),
    query.offset ?? 0,
  );

  return { rows, total };
}

export function deleteRecipients(ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return run(`DELETE FROM recipients WHERE id IN (${placeholders})`, ...ids).changes;
}

export function deleteAllRecipients(groupId?: number | null): number {
  if (groupId === undefined || groupId === null) {
    return run('DELETE FROM recipients').changes;
  }
  return run('DELETE FROM recipients WHERE group_id = ?', groupId).changes;
}

/** Removes rows whose address is duplicated ignoring case, keeping the oldest. */
export function removeDuplicates(): number {
  return run(
    `DELETE FROM recipients
      WHERE id NOT IN (SELECT MIN(id) FROM recipients GROUP BY LOWER(email))`,
  ).changes;
}

export function markUnsubscribed(email: string, value = true): void {
  run('UPDATE recipients SET unsubscribed = ? WHERE email = ?', value ? 1 : 0, normalizeEmail(email));
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface GroupRow {
  id: number;
  name: string;
  created_at: string;
  member_count?: number;
}

export function listGroups(): GroupRow[] {
  return all<GroupRow>(
    `SELECT g.*, (SELECT COUNT(*) FROM recipients r WHERE r.group_id = g.id) AS member_count
       FROM recipient_groups g ORDER BY g.name`,
  );
}

export function createGroup(name: string): GroupRow {
  const existing = get<GroupRow>('SELECT * FROM recipient_groups WHERE name = ?', name);
  if (existing) return existing;
  const result = run('INSERT INTO recipient_groups (name) VALUES (?)', name);
  return get<GroupRow>('SELECT * FROM recipient_groups WHERE id = ?', result.lastInsertRowid)!;
}

export function deleteGroup(id: number): void {
  run('DELETE FROM recipient_groups WHERE id = ?', id);
}
