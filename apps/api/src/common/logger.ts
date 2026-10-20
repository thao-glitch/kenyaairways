import { maskPhone } from '@kenyaairways/shared';
import { getEnv } from '../config/env';

/**
 * Structured JSON logging with PII/credential masking.
 * Every line: {"ts":"…","level":"info","component":"payments","msg":"…", …ctx}
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /(password|secret|token|authorization|cookie|pin|passkey|credential|api[-_]?key|msisdn|phone|mobile|email|docnumber|idnumber|msisdn|otp|code$)/i;

const PHONE_KEY = /(phone|msisdn|mobile)/i;

function maskString(key: string, value: string): string {
  if (PHONE_KEY.test(key)) {
    const masked = maskPhone(value);
    return masked || '***';
  }
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-1)}`;
}

/** Recursively masks sensitive fields before they reach stdout/log shipper. */
export function maskDeep(value: unknown, keyHint = '', depth = 0): unknown {
  if (depth > 8) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return SENSITIVE_KEY.test(keyHint) ? maskString(keyHint, value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, keyHint, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskDeep(v, k, depth + 1);
    }
    return out;
  }
  return String(value);
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(component: string): Logger;
}

let levelCache: LogLevel | null = null;

function currentLevel(): LogLevel {
  if (levelCache) return levelCache;
  try {
    levelCache = getEnv().LOG_LEVEL;
  } catch {
    levelCache = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }
  return levelCache;
}

function write(
  level: LogLevel,
  component: string,
  msg: string,
  ctx?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...(ctx ? (maskDeep(ctx) as Record<string, unknown>) : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error' || level === 'warn') process.stderr.write(`${serialized}\n`);
  else process.stdout.write(`${serialized}\n`);
}

export function createLogger(component: string): Logger {
  return {
    debug: (msg, ctx) => write('debug', component, msg, ctx),
    info: (msg, ctx) => write('info', component, msg, ctx),
    warn: (msg, ctx) => write('warn', component, msg, ctx),
    error: (msg, ctx) => write('error', component, msg, ctx),
    child: (sub) => createLogger(`${component}:${sub}`),
  };
}
