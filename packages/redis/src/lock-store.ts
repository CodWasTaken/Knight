import { randomUUID } from 'node:crypto';
import type { RedisClient } from './client.js';

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class LockStore {
  public constructor(private readonly redis: RedisClient) {}

  public async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(`knight:lock:${key}`, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  public async release(key: string, token: string): Promise<boolean> {
    const result = await this.redis.eval(RELEASE_SCRIPT, 1, `knight:lock:${key}`, token);
    return Number(result) === 1;
  }
}
