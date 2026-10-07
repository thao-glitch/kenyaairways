import { PNR_ALPHABET, PNR_LENGTH } from './constants';

export type RandomFn = () => number;

/** Uniform random 6-char PNR from the unambiguous alphabet (CSPRNG-free: not a secret). */
export function randomPnr(rng: RandomFn = Math.random): string {
  let out = '';
  for (let i = 0; i < PNR_LENGTH; i += 1) {
    out += PNR_ALPHABET[Math.floor(rng() * PNR_ALPHABET.length)];
  }
  return out;
}

const PNR_RE = new RegExp(`^[${PNR_ALPHABET}]{${PNR_LENGTH}}$`);

export function isValidPnr(pnr: string): boolean {
  return PNR_RE.test(pnr);
}

/**
 * Collision-safe PNR generation: retries with a caller-supplied existence check
 * backed by the DB unique index. Throws after `maxAttempts` collisions —
 * with 32^6 space this is practically unreachable below 1e7 attempts.
 */
export async function generateUniquePnr(
  exists: (pnr: string) => Promise<boolean>,
  rng: RandomFn = Math.random,
  maxAttempts = 50,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = randomPnr(rng);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Could not generate a unique PNR after ${maxAttempts} attempts`);
}
