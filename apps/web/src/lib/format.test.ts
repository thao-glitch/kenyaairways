import { describe, expect, it } from 'vitest';
import { formatDurationShort, formatRemaining } from './format';

describe('formatRemaining', () => {
  it('formats under a minute with padded seconds', () => {
    expect(formatRemaining(5_000)).toBe('0m 05s');
    expect(formatRemaining(0)).toBe('0m 00s');
    expect(formatRemaining(-1)).toBe('0m 00s');
  });

  it('formats minutes and hours', () => {
    expect(formatRemaining(845_000)).toBe('14m 05s');
    expect(formatRemaining(8_040_000)).toBe('2h 14m');
  });

  it('formats days', () => {
    expect(formatRemaining(97_200_000)).toBe('1d 3h 00m');
  });

  it('degrades on garbage input', () => {
    expect(formatRemaining(Number.NaN)).toBe('0m 00s');
  });
});

describe('formatDurationShort', () => {
  it('formats minutes-only and hour durations', () => {
    expect(formatDurationShort(55)).toBe('55m');
    expect(formatDurationShort(65)).toBe('1h 05m');
    expect(formatDurationShort(-1)).toBe('—');
  });
});
