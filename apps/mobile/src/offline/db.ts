/**
 * Minimal synchronous SQL abstraction.
 *
 * Two drivers implement it:
 *   - `expo-db.ts`   — expo-sqlite on the device (the runtime driver)
 *   - `node-db.ts`   — node:sqlite, used by the vitest engine suite so the
 *                      whole offline engine is integration-tested against a
 *                      real SQLite database in CI (no device needed).
 *
 * Keep this file free of any React Native / node:sqlite import so it is safe
 * for both bundlers.
 */
export type SqlParam = string | number | null | Uint8Array;

export interface SqlDb {
  exec(sql: string): void;
  all<T>(sql: string, params?: SqlParam[]): T[];
  get<T>(sql: string, params?: SqlParam[]): T | undefined;
  run(sql: string, params?: SqlParam[]): { changes: number };
  /** Runs `fn` inside BEGIN/COMMIT, rolling back when it throws. */
  transaction<T>(fn: () => T): T;
}

/** SQLite accepts null/number/string/bytes only — coerce booleans & friends. */
export function sqlParams(values: Array<SqlParam | boolean | undefined>): SqlParam[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v as SqlParam;
  });
}

/** Multi-row `INSERT OR IGNORE INTO t (a,b) VALUES (...),(...)` builder. */
export function multiInsert(
  table: string,
  columns: string[],
  rows: Array<Array<SqlParam | boolean | undefined>>,
): { sql: string; params: SqlParam[] } | null {
  if (rows.length === 0) return null;
  const placeholders = rows.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
  return {
    sql: `INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`,
    params: sqlParams(rows.flat()),
  };
}

export function execMulti(db: SqlDb, statement: { sql: string; params: SqlParam[] } | null): void {
  if (statement) db.run(statement.sql, statement.params);
}
