import { Redis } from 'ioredis';

export type RedisClient = Redis;

export function createRedis(redisUrl: string): RedisClient {
  return new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
  });
}

export async function closeRedis(redis: RedisClient): Promise<void> {
  await redis.quit();
}
