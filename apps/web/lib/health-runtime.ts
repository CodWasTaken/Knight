import 'server-only';

import { createRedis, type RedisClient } from '@knight/redis';
import { getWebRuntime } from './server-runtime';

let redis: RedisClient | undefined;

export function getHealthProbes() {
  const runtime = getWebRuntime();
  const redisUrl = process.env.REDIS_URL;

  return {
    postgres: async (): Promise<void> => {
      await runtime.database.pool.query('select 1');
    },
    redis: async (): Promise<void> => {
      if (!redisUrl) throw new Error('Redis health configuration unavailable.');
      redis ??= createRedis(redisUrl);
      await redis.ping();
    },
  } as const;
}
