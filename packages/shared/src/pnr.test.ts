import { describe, expect, it } from 'vitest';
import { PNR_ALPHABET, PNR_LENGTH } from '../src/constants';
import { generateUniquePnr, isValidPnr, randomPnr } from '../src/pnr';

describe('randomPnr', () => {
  it('returns a valid 6-char PNR from the unambiguous alphabet', () => {
    for (let i = 0; i < 500; i += 1) {
      const pnr = randomPnr();
      expect(pnr).toHaveLength(PNR_LENGTH);
      expect(isValidPnr(pnr)).toBe(true);
      for (const ch of pnr) expect(PNR_ALPHABET).toContain(ch);
    }
  });

  it('never emits ambiguous glyphs', () => {
    expect(PNR_ALPHABET).not.toMatch(/[0O1I]/);
  });
});

describe('generateUniquePnr', () => {
  it('retries until the existence check passes', async () => {
    let calls = 0;
    const exists = async () => {
      calls += 1;
      return calls < 3; // first two candidates collide
    };
    const pnr = await generateUniquePnr(exists);
    expect(calls).toBe(3);
    expect(isValidPnr(pnr)).toBe(true);
  });

  it('gives up after max attempts', async () => {
    await expect(generateUniquePnr(async () => true, Math.random, 5)).rejects.toThrow(
      /unique PNR after 5 attempts/,
    );
  });
});
