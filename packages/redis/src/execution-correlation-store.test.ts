import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeRedis, createRedis } from './client.js';
import {
  ExecutionCorrelationStore,
  type ExecutionCorrelation,
} from './execution-correlation-store.js';
import { LockStore } from './lock-store.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = createRedis(redisUrl);
const correlations = new ExecutionCorrelationStore(redis);
const locks = new LockStore(redis);

beforeAll(async () => {
  await redis.select(2);
  await redis.ping();
});

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await closeRedis(redis);
});

const correlation: ExecutionCorrelation = {
  id: 'corr-1',
  guildId: '100',
  requestedByUserId: '42',
  action: 'member.ban',
  targetId: '77',
  expectedAuditActorBotId: '999',
  createdAtMs: 1_000,
};

describe('ExecutionCorrelationStore', () => {
  it('returns a correlation only once', async () => {
    await correlations.create(correlation);

    expect(await correlations.consume(correlation.id)).toEqual(correlation);
    expect(await correlations.consume(correlation.id)).toBeNull();
  });

  it('expires short-lived correlations', async () => {
    await correlations.create({ ...correlation, id: 'corr-expiring' }, 40);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(await correlations.consume('corr-expiring')).toBeNull();
  });
});

describe('LockStore', () => {
  it('releases a lock only for its matching token', async () => {
    const token = await locks.acquire('guild:100:setup', 1_000);
    expect(token).toEqual(expect.any(String));
    expect(await locks.acquire('guild:100:setup', 1_000)).toBeNull();
    expect(await locks.release('guild:100:setup', 'wrong-token')).toBe(false);
    expect(await locks.acquire('guild:100:setup', 1_000)).toBeNull();

    expect(await locks.release('guild:100:setup', token!)).toBe(true);
    expect(await locks.acquire('guild:100:setup', 1_000)).toEqual(expect.any(String));
  });
});
