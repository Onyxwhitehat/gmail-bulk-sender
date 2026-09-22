import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const here = dirname(fileURLToPath(import.meta.url));

mkdirSync(dirname(config.databaseFile), { recursive: true });

export const db = new DatabaseSync(config.databaseFile);

/**
 * Adds a column to a table that predates it. `CREATE TABLE IF NOT EXISTS` does
 * nothing to a table already there, so a column added later needs its own step;
 * checking first keeps this as re-runnable as the rest of the schema.
 */
function addColumn(table: string, column: string, declaration: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  logger.info(`added ${table}.${column}`);
}

/** Applies schema.sql. Every statement is idempotent, so this runs on every boot. */
export function migrate(): void {
  const schema = readFileSync(resolve(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  // An address book built before this records no outreach of its own, so the
  // columns that hold it have to be added to the table already there.
  addColumn('recipients', 'contacted_at', "TEXT NOT NULL DEFAULT ''");
  addColumn('recipients', 'contacted_via', "TEXT NOT NULL DEFAULT ''");
  logger.info(`database ready at ${config.databaseFile}`);
}

type Row = Record<string, unknown>;

/** Returns every matching row. */
export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

/** Returns the first matching row, or undefined. */
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

/** Executes a write and returns `{ changes, lastInsertRowid }`. */
export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
  const result = db.prepare(sql).run(...(params as never[]));
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function closeDatabase(): void {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
