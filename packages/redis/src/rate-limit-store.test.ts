import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeRedis, createRedis } from './client.js';
import { RateLimitStore } from './rate-limit-store.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = createRedis(redisUrl);
const store = new RateLimitStore(redis);

describe('RateLimitStore', () => {
  beforeAll(async () => {
    await redis.select(1);
    await redis.ping();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await closeRedis(redis);
  });

  it('denies the third action when a two-action window is exhausted', async () => {
    const windows = [{ max: 2, windowMs: 60_000 }] as const;
    const key = 'guild:100:user:42:member.ban';

    expect((await store.consume(key, windows, 1_000)).allowed).toBe(true);
    expect((await store.consume(key, windows, 1_001)).allowed).toBe(true);
    const denied = await store.consume(key, windows, 1_002);
    expect(denied.allowed).toBe(false);
    expect(denied.windows).toEqual([
      { max: 2, windowMs: 60_000, used: 2, remaining: 0, resetAtMs: 61_000 },
    ]);
  });

  it('allows when no rate windows are configured', async () => {
    expect(await store.consume('guild:100:unlimited', [], 1_000)).toEqual({
      allowed: true,
      windows: [],
    });
  });

  it('does not partially consume other windows when one window denies', async () => {
    const windows = [
      { max: 1, windowMs: 100 },
      { max: 2, windowMs: 1_000 },
    ] as const;
    const key = 'guild:100:user:55:member.ban';

    expect((await store.consume(key, windows, 0)).allowed).toBe(true);
    expect((await store.consume(key, windows, 50)).allowed).toBe(false);

    const afterShortReset = await store.consume(key, windows, 101);
    expect(afterShortReset.allowed).toBe(true);
    expect(afterShortReset.windows[1]?.used).toBe(2);
  });

  it('allows exactly one simultaneous attempt for one remaining slot', async () => {
    const windows = [{ max: 1, windowMs: 60_000 }] as const;
    const key = 'guild:100:user:99:member.ban';

    const results = await Promise.all([
      store.consume(key, windows, 2_000),
      store.consume(key, windows, 2_000),
    ]);

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(1);
    expect(results.every((result) => result.windows[0]?.used === 1)).toBe(true);
  });
});
