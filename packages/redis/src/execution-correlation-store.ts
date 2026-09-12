import type { ActionId } from '@knight/contracts';
import type { RedisClient } from './client.js';

const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
`;

const CONSUME_MATCH_SCRIPT = `
local correlationId = redis.call('GET', KEYS[1])
if not correlationId then
  return nil
end
redis.call('DEL', KEYS[1])
local primaryKey = ARGV[1] .. correlationId
local value = redis.call('GET', primaryKey)
if value then
  redis.call('DEL', primaryKey)
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

export type ExecutionCorrelationMatch = Pick<
  ExecutionCorrelation,
  'guildId' | 'expectedAuditActorBotId' | 'targetId'
> &
  Readonly<{ action: string }>;

const PRIMARY_KEY_PREFIX = 'knight:correlation:';

function matchKey(input: ExecutionCorrelationMatch): string {
  return [
    'knight:correlation-match',
    input.guildId,
    input.expectedAuditActorBotId,
    input.action,
    input.targetId,
  ]
    .map(encodeURIComponent)
    .join(':');
}

export class ExecutionCorrelationStore {
  public constructor(private readonly redis: RedisClient) {}

  public async create(correlation: ExecutionCorrelation, ttlMs = 60_000): Promise<void> {
    await this.redis
      .multi()
      .set(`${PRIMARY_KEY_PREFIX}${correlation.id}`, JSON.stringify(correlation), 'PX', ttlMs)
      .set(matchKey(correlation), correlation.id, 'PX', ttlMs)
      .exec();
  }

  public async consume(id: string): Promise<ExecutionCorrelation | null> {
    const value = await this.redis.eval(CONSUME_SCRIPT, 1, `${PRIMARY_KEY_PREFIX}${id}`);
    if (value === null) return null;
    if (typeof value !== 'string') throw new Error('Unexpected Redis correlation response');
    return JSON.parse(value) as ExecutionCorrelation;
  }

  public async consumeMatch(
    input: ExecutionCorrelationMatch,
  ): Promise<ExecutionCorrelation | null> {
    const value = await this.redis.eval(
      CONSUME_MATCH_SCRIPT,
      1,
      matchKey(input),
      PRIMARY_KEY_PREFIX,
    );
    if (value === null) return null;
    if (typeof value !== 'string') throw new Error('Unexpected Redis correlation response');
    return JSON.parse(value) as ExecutionCorrelation;
  }
}
