import { describe, expect, it } from 'vitest';
import { parseEnv, parseWebEnv } from './env.js';

describe('parseEnv', () => {
  it('rejects missing security-critical variables', () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
  });

  it('accepts a complete development configuration', () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123',
      DISCORD_CLIENT_SECRET: 'secret',
      AUTH_SECRET: 'x'.repeat(32),
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgres://knight:knight@localhost:5432/knight',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(env.NODE_ENV).toBe('test');
  });

  it('accepts a web configuration without bot-only credentials', () => {
    const env = parseWebEnv({
      NODE_ENV: 'test',
      DISCORD_CLIENT_ID: '123',
      DISCORD_CLIENT_SECRET: 'secret',
      AUTH_SECRET: 'x'.repeat(32),
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgres://knight:knight@localhost:5432/knight',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.DISCORD_TOKEN).toBeUndefined();
  });

  it('preserves an optional bot token for live setup operations when configured', () => {
    const env = parseWebEnv({
      DISCORD_CLIENT_ID: '123',
      DISCORD_CLIENT_SECRET: 'secret',
      AUTH_SECRET: 'x'.repeat(32),
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgres://knight:knight@localhost:5432/knight',
      DISCORD_TOKEN: 'setup-token',
    });
    expect(env.DISCORD_TOKEN).toBe('setup-token');
  });
});
