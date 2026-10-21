/**
 * node:sqlite driver — TEST ONLY.
 *
 * Never import this from runtime code: Metro would try to resolve
 * `node:sqlite` inside the APK. The vitest engine suite imports it directly.
 */
import type { SqlDb, SqlParam } from './db';
import { sqlParams } from './db';

export function openNodeDb(file = ':memory:'): SqlDb & { close(): void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const handle = new DatabaseSync(file);
  let depth = 0; // nested transaction() calls join the outer one
  return {
    exec(sql: string) {
      handle.exec(sql);
    },
    all<T>(sql: string, params: SqlParam[] = []): T[] {
      return handle.prepare(sql).all(...params) as T[];
    },
    get<T>(sql: string, params: SqlParam[] = []): T | undefined {
      return handle.prepare(sql).get(...params) as T | undefined;
    },
    run(sql: string, params: SqlParam[] = []) {
      const info = handle.prepare(sql).run(...params);
      return { changes: Number(info.changes) };
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn(); // already inside a transaction
      handle.exec('BEGIN');
      depth += 1;
      try {
        const out = fn();
        handle.exec('COMMIT');
        return out;
      } catch (err) {
        handle.exec('ROLLBACK');
        throw err;
      } finally {
        depth -= 1;
      }
    },
    close() {
      handle.close();
    },
  };
}

// Re-exported so specs can build params without importing two modules.
export { sqlParams };
