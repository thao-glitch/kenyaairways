/**
 * Backend address management.
 *
 * The app is built into an APK that runs on a phone, so `localhost` on the
 * device is the phone itself — the backend always lives on another host
 * (your laptop/server on the same Wi-Fi). Two slots exist:
 *
 *   api    — the NestJS API base (port 4100) used by the traveller app
 *   admin  — the staff console URL (port 3001) used by the admin APK
 *
 * Each address is:
 *   1. `EXPO_PUBLIC_API_BASE` / `EXPO_PUBLIC_ADMIN_BASE` if baked in at
 *      build time, else
 *   2. the last address the user saved (AsyncStorage), else
 *   3. the localhost default (works in Expo Go on the same machine).
 *
 * Both are editable BEFORE sign-in (the auth screen shows the api slot) so
 * a fresh install can reach a LAN backend on first launch, and again later
 * from Profile. `probeApi` verifies the API against `GET /healthz` (served
 * at the root, outside the `/api/v1` prefix); `probeWeb` verifies a plain
 * web app (the admin console) with `GET /`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ServerSlot = 'api' | 'admin';

export const DEFAULT_API_BASE: string = process.env.EXPO_PUBLIC_API_BASE ?? 'http://localhost:4100';
export const DEFAULT_ADMIN_BASE: string =
  process.env.EXPO_PUBLIC_ADMIN_BASE ?? 'http://localhost:3001';

const STORAGE: Record<ServerSlot, string> = {
  api: 'ka_api_base',
  admin: 'ka_admin_base',
};

const DEFAULTS: Record<ServerSlot, string> = {
  api: DEFAULT_API_BASE,
  admin: DEFAULT_ADMIN_BASE,
};

const LABELS: Record<ServerSlot, string> = {
  api: 'the API (port 4100)',
  admin: 'the admin console (port 3001)',
};

const current: Record<ServerSlot, string> = { ...DEFAULTS };

/** Trim, drop trailing slashes, add `http://` if the user typed a bare host. */
export function normalizeBase(raw: string, slot: ServerSlot = 'api'): string {
  let u = raw.trim();
  if (!u) return DEFAULTS[slot];
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

/** The API base every request should use right now (sync, per-call safe). */
export function getApiBase(): string {
  return current.api;
}

/** The admin console URL the WebView should load right now. */
export function getAdminBase(): string {
  return current.admin;
}

export function defaultBase(slot: ServerSlot): string {
  return DEFAULTS[slot];
}

export function slotLabel(slot: ServerSlot): string {
  return LABELS[slot];
}

/** Load both saved addresses at app boot, before any request fires. */
export async function hydrateApiBase(): Promise<void> {
  for (const slot of ['api', 'admin'] as const) {
    try {
      const saved = await AsyncStorage.getItem(STORAGE[slot]);
      if (saved) current[slot] = normalizeBase(saved, slot);
    } catch {
      /* unreadable storage → keep the default */
    }
  }
}

/** Persist a new address (already probed by the caller). */
export async function setServerBase(raw: string, slot: ServerSlot = 'api'): Promise<void> {
  current[slot] = normalizeBase(raw, slot);
  try {
    await AsyncStorage.setItem(STORAGE[slot], current[slot]);
  } catch {
    /* keep working in-memory even if storage fails */
  }
}

/** `GET <base>/healthz` with a hard timeout — true when the API answers. */
export async function probeApi(raw: string, timeoutMs = 5000): Promise<boolean> {
  return probe(`${normalizeBase(raw)}/healthz`, timeoutMs);
}

/** `GET <base>/` with a hard timeout — true when a web app answers 2xx/3xx. */
export async function probeWeb(raw: string, timeoutMs = 5000): Promise<boolean> {
  const res = await probeStatus(`${normalizeBase(raw, 'admin')}/`, timeoutMs);
  return res !== null && res < 400;
}

async function probe(url: string, timeoutMs: number): Promise<boolean> {
  const status = await probeStatus(url, timeoutMs, 'GET');
  return status !== null && status >= 200 && status < 300;
}

async function probeStatus(url: string, timeoutMs: number, method = 'GET'): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { 'X-Client': 'mobile' },
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
