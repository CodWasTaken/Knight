import { describe, expect, it, vi } from 'vitest';
import { startWorker } from './index.js';

const validEnv = {
  DISCORD_TOKEN: 'token',
  DISCORD_CLIENT_ID: 'client',
  DISCORD_CLIENT_SECRET: 'secret',
  AUTH_SECRET: 'x'.repeat(32),
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://knight:knight@localhost:55432/knight_test',
  REDIS_URL: 'redis://localhost:56379',
};

describe('startWorker', () => {
  it('checks PostgreSQL and Redis before registering graceful SIGTERM shutdown', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const end = vi.fn().mockResolvedValue(undefined);
    const ping = vi.fn().mockResolvedValue('PONG');
    const quit = vi.fn().mockResolvedValue('OK');
    let sigterm: (() => void) | undefined;

    await startWorker(validEnv, {
      createDatabase: vi.fn(() => ({ pool: { query, end } })),
      createRedis: vi.fn(() => ({ ping, quit })),
      onSigterm: vi.fn((handler) => {
        sigterm = handler;
      }),
    });

    expect(query).toHaveBeenCalledWith('select 1');
    expect(ping).toHaveBeenCalledTimes(1);
    expect(sigterm).toBeTypeOf('function');

    sigterm?.();
    await vi.waitFor(() => {
      expect(end).toHaveBeenCalledTimes(1);
      expect(quit).toHaveBeenCalledTimes(1);
    });
  });
});
