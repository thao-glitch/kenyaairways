/**
 * Backend address management.
 *
 * The app is built into an APK that runs on a phone, so `localhost` on the
 * device is the phone itself — the backend always lives on another host
 * (your laptop/server on the same Wi-Fi). The address is therefore:
 *
 *   1. `EXPO_PUBLIC_API_BASE` if baked in at build time, else
 *   2. the last address the user saved (AsyncStorage), else
 *   3. `http://localhost:4100` (works in Expo Go on the same machine).
 *
 * It is editable BEFORE sign-in (the auth screen shows it) so a fresh
 * install can reach a LAN backend on first launch, and again later from
 * Profile. `probeApi` verifies a candidate address against `GET /healthz`
 * (the API serves it at the root, outside the `/api/v1` prefix).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ka_api_base';

export const DEFAULT_API_BASE: string = process.env.EXPO_PUBLIC_API_BASE ?? 'http://localhost:4100';

let current: string = DEFAULT_API_BASE;

/** Trim, drop trailing slashes, add `http://` if the user typed a bare host. */
export function normalizeBase(raw: string): string {
  let u = raw.trim();
  if (!u) return DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

/** The base every request should use right now (sync, per-call safe). */
export function getApiBase(): string {
  return current;
}

/** Load the saved address at app boot, before any request fires. */
export async function hydrateApiBase(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) current = normalizeBase(saved);
  } catch {
    /* unreadable storage → keep the default */
  }
}

/** Persist a new address (already probed by the caller). */
export async function setApiBase(raw: string): Promise<void> {
  current = normalizeBase(raw);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, current);
  } catch {
    /* keep working in-memory even if storage fails */
  }
}

/** `GET <base>/healthz` with a hard timeout — true when the API answers. */
export async function probeApi(raw: string, timeoutMs = 5000): Promise<boolean> {
  const base = normalizeBase(raw);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/healthz`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'X-Client': 'mobile' },
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
