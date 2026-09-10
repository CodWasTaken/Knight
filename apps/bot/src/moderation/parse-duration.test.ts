import { describe, expect, it } from 'vitest';
import { parseTimeoutDuration } from './parse-duration.js';

describe('parseTimeoutDuration', () => {
  it.each([
    ['10m', 10 * 60_000],
    ['1h', 60 * 60_000],
    ['1d', 24 * 60 * 60_000],
    ['28d', 28 * 24 * 60 * 60_000],
  ])('parses %s', (value, expected) => {
    expect(parseTimeoutDuration(value)).toBe(expected);
  });

  it.each(['0m', '-1h', '29d', '1.5h', 'forever', ''])('rejects invalid timeout %j', (value) => {
    expect(() => parseTimeoutDuration(value)).toThrow(/timeout duration/i);
  });
});
