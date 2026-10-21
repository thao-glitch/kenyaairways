/** Tiny key/value helpers over the offline DB's `kv` table. */
import type { SqlDb } from './db';

export function kvGet(db: SqlDb, key: string): string | null {
  return db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])?.value ?? null;
}

export function kvSet(db: SqlDb, key: string, value: string): void {
  db.run(
    `INSERT INTO kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
