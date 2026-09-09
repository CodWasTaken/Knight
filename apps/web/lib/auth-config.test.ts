import { closeDatabase, createDatabase } from '@knight/database';
import { afterAll, describe, expect, it } from 'vitest';
import { configureAuthEnvironment, createAuthConfig } from './auth-config';

const database = createDatabase(
  process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test',
);

afterAll(async () => {
  await closeDatabase(database);
});
const env = {
  DISCORD_CLIENT_ID: 'discord-client-id',
  DISCORD_CLIENT_SECRET: 'discord-client-secret',
  AUTH_SECRET: '0123456789abcdef0123456789abcdef',
} as const;

describe('createAuthConfig', () => {
  it('maps Knight APP_URL to the canonical Auth.js URL', () => {
    const target: Record<string, string | undefined> = { AUTH_URL: 'https://wrong.example.test' };

    configureAuthEnvironment({ APP_URL: 'https://knight.example.test' }, target);

    expect(target.AUTH_URL).toBe('https://knight.example.test');
  });

  it('uses the Drizzle adapter with database sessions', () => {
    const config = createAuthConfig(database, env);

    expect(config.adapter).toBeDefined();
    expect(config.session?.strategy).toBe('database');
    expect(config.secret).toBe(env.AUTH_SECRET);
  });

  it('requests only Discord identity and guild-list OAuth scopes', () => {
    const config = createAuthConfig(database, env);
    const provider = config.providers[0] as {
      id?: string;
      options?: { authorization?: { params?: { scope?: string } } };
    };

    expect(provider.id).toBe('discord');
    expect(provider.options?.authorization?.params?.scope).toBe('identify guilds');
  });

  it('copies the database user id into the server session', async () => {
    const config = createAuthConfig(database, env);
    const sessionCallback = config.callbacks?.session;
    expect(sessionCallback).toBeDefined();

    const result = await (sessionCallback as NonNullable<typeof sessionCallback>)({
      session: { user: { name: 'Owner' }, expires: new Date(Date.now() + 60_000).toISOString() },
      user: { id: 'discord-user-1', name: 'Owner', email: null, emailVerified: null, image: null },
      newSession: undefined,
      trigger: 'update',
    } as never);

    expect(result.user).toMatchObject({ id: 'discord-user-1' });
  });
});
