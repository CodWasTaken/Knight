import { DrizzleAdapter } from '@auth/drizzle-adapter';
import {
  accounts,
  applyMigrations,
  closeDatabase,
  createDatabase,
  sessions,
  users,
  verificationTokens,
} from '@knight/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const database = createDatabase(
  process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test',
);

const adapter = DrizzleAdapter(database.db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
} as never);

describe('Knight Auth.js Drizzle tables', () => {
  beforeAll(async () => {
    await applyMigrations(database);
    await database.pool.query(
      'TRUNCATE TABLE accounts, sessions, users, verification_tokens CASCADE',
    );
  });

  afterAll(async () => {
    await closeDatabase(database);
  });

  it('persists Discord OAuth tokens in the server-side accounts table', async () => {
    await database.pool.query('INSERT INTO users (id, name) VALUES ($1, $2)', [
      'auth-user-1',
      'Auth User',
    ]);

    await adapter.linkAccount?.({
      userId: 'auth-user-1',
      type: 'oauth',
      provider: 'discord',
      providerAccountId: 'discord-user-1',
      access_token: 'server-access-token',
      refresh_token: 'server-refresh-token',
    });

    const result = await database.pool.query<{
      access_token: string | null;
      refresh_token: string | null;
    }>(
      'SELECT access_token, refresh_token FROM accounts WHERE provider = $1 AND provider_account_id = $2',
      ['discord', 'discord-user-1'],
    );

    expect(result.rows[0]).toEqual({
      access_token: 'server-access-token',
      refresh_token: 'server-refresh-token',
    });
  });
});
