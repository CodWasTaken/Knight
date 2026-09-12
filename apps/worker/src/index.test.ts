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
  it('checks dependencies, polls backups sequentially every minute, and stops cleanly', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const end = vi.fn().mockResolvedValue(undefined);
    const ping = vi.fn().mockResolvedValue('PONG');
    const quit = vi.fn().mockResolvedValue('OK');
    const runTick = vi.fn().mockResolvedValue(undefined);
    const clearInterval = vi.fn();
    let intervalHandler: (() => void) | undefined;
    let sigterm: (() => void) | undefined;

    await startWorker(validEnv, {
      createDatabase: vi.fn(() => ({ pool: { query, end } })),
      createRedis: vi.fn(() => ({ ping, quit })),
      createBackupService: vi.fn(() => ({ runTick })),
      setInterval: vi.fn((handler, milliseconds) => {
        expect(milliseconds).toBe(60_000);
        intervalHandler = handler;
        return 'timer';
      }),
      clearInterval,
      onSigterm: vi.fn((handler) => {
        sigterm = handler;
      }),
    });

    expect(query).toHaveBeenCalledWith('select 1');
    expect(ping).toHaveBeenCalledTimes(1);
    expect(intervalHandler).toBeTypeOf('function');
    intervalHandler?.();
    await vi.waitFor(() => expect(runTick).toHaveBeenCalledTimes(1));

    sigterm?.();
    await vi.waitFor(() => {
      expect(clearInterval).toHaveBeenCalledWith('timer');
      expect(end).toHaveBeenCalledTimes(1);
      expect(quit).toHaveBeenCalledTimes(1);
    });
  });
});
