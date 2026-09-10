const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60_000;

const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
} as const;

export function parseTimeoutDuration(value: string): number {
  const match = /^(\d+)([smhd])$/i.exec(value.trim());
  if (!match) throw new Error('Invalid timeout duration.');

  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase() as keyof typeof UNIT_MS;
  const durationMs = amount * UNIT_MS[unit];
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_TIMEOUT_MS) {
    throw new Error('Invalid timeout duration.');
  }
  return durationMs;
}
