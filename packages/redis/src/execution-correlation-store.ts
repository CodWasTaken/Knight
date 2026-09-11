import type { ActionId } from '@knight/contracts';
import type { RedisClient } from './client.js';

const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
`;

export type ExecutionCorrelation = Readonly<{
  id: string;
  guildId: string;
  requestedByUserId: string;
  action: ActionId;
  targetId: string;
  expectedAuditActorBotId: string;
  createdAtMs: number;
}>;

export class ExecutionCorrelationStore {
  public constructor(private readonly redis: RedisClient) {}

  public async create(correlation: ExecutionCorrelation, ttlMs = 60_000): Promise<void> {
    await this.redis.set(
      `knight:correlation:${correlation.id}`,
      JSON.stringify(correlation),
      'PX',
      ttlMs,
    );
  }

  public async consume(id: string): Promise<ExecutionCorrelation | null> {
    const value = await this.redis.eval(CONSUME_SCRIPT, 1, `knight:correlation:${id}`);
    if (value === null) return null;
    if (typeof value !== 'string') throw new Error('Unexpected Redis correlation response');
    return JSON.parse(value) as ExecutionCorrelation;
  }
}
