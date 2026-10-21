/**
 * expo-sqlite driver — the runtime (device) implementation of SqlDb.
 *
 * Isolated in its own module so tests never import expo-sqlite.
 */
import * as SQLite from 'expo-sqlite';
import type { SqlDb, SqlParam } from './db';
import { sqlParams } from './db';

export function openExpoDb(name = 'ka_offline.db'): SqlDb {
  const handle = SQLite.openDatabaseSync(name);
  let depth = 0; // nested transaction() calls join the outer one
  return {
    exec(sql: string) {
      handle.execSync(sql);
    },
    all<T>(sql: string, params: SqlParam[] = []): T[] {
      return handle.getAllSync<T>(sql, ...sqlParams(params));
    },
    get<T>(sql: string, params: SqlParam[] = []): T | undefined {
      return handle.getFirstSync<T>(sql, ...sqlParams(params)) ?? undefined;
    },
    run(sql: string, params: SqlParam[] = []) {
      const info = handle.runSync(sql, ...sqlParams(params));
      return { changes: info.changes };
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn(); // already inside a transaction
      handle.execSync('BEGIN IMMEDIATE');
      depth += 1;
      try {
        const out = fn();
        handle.execSync('COMMIT');
        return out;
      } catch (err) {
        handle.execSync('ROLLBACK');
        throw err;
      } finally {
        depth -= 1;
      }
    },
  };
}
