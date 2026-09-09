import { randomUUID } from 'node:crypto';
import type { RateWindow } from '@knight/contracts';
import type { RedisClient } from './client.js';

const CONSUME_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local allowed = 1
local used = {}

for i = 1, #KEYS do
  local offset = 2 + ((i - 1) * 2)
  local max = tonumber(ARGV[offset + 1])
  local window_ms = tonumber(ARGV[offset + 2])
  local cutoff = now - window_ms

  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', cutoff)
  used[i] = redis.call('ZCARD', KEYS[i])
  if used[i] >= max then
    allowed = 0
  end
end

if allowed == 1 then
  for i = 1, #KEYS do
    local offset = 2 + ((i - 1) * 2)
    local window_ms = tonumber(ARGV[offset + 2])
    redis.call('ZADD', KEYS[i], now, member)
    redis.call('PEXPIRE', KEYS[i], window_ms)
    used[i] = used[i] + 1
  end
end

local result = { allowed }
for i = 1, #KEYS do
  local offset = 2 + ((i - 1) * 2)
  local window_ms = tonumber(ARGV[offset + 2])
  local reset_at = now

  if used[i] > 0 then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    if #oldest >= 2 then
      reset_at = math.floor(tonumber(oldest[2])) + window_ms
    end
  end

  table.insert(result, used[i])
  table.insert(result, reset_at)
end

return result
`;

export type RateLimitResult = Readonly<{
  allowed: boolean;
  windows: readonly Readonly<{
    max: number;
    windowMs: number;
    used: number;
    remaining: number;
    resetAtMs: number;
  }>[];
}>;

export class RateLimitStore {
  public constructor(private readonly redis: RedisClient) {}

  public async consume(
    key: string,
    windows: readonly RateWindow[],
    nowMs: number,
  ): Promise<RateLimitResult> {
    if (windows.length === 0) return { allowed: true, windows: [] };

    const keys = windows.map(
      (window, index) => `knight:rate:{${key}}:${index}:${window.max}:${window.windowMs}`,
    );
    const member = `${nowMs}:${randomUUID()}`;
    const windowArgs = windows.flatMap((window) => [String(window.max), String(window.windowMs)]);

    const raw = await this.redis.eval(
      CONSUME_SCRIPT,
      keys.length,
      ...keys,
      String(nowMs),
      member,
      ...windowArgs,
    );

    if (!Array.isArray(raw)) throw new Error('Unexpected Redis rate-limit response');

    const allowed = Number(raw[0]) === 1;
    const resultWindows = windows.map((window, index) => {
      const used = Number(raw[1 + index * 2]);
      const resetAtMs = Number(raw[2 + index * 2]);
      return {
        max: window.max,
        windowMs: window.windowMs,
        used,
        remaining: Math.max(0, window.max - used),
        resetAtMs,
      };
    });

    return { allowed, windows: resultWindows };
  }
}
