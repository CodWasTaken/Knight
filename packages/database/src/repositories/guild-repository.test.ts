import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GuildMode } from '@knight/contracts';
import { closeDatabase, createDatabase } from '../client.js';
import { applyMigrations } from '../migrations.js';
import { GuildRepository } from './guild-repository.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';
const database = createDatabase(databaseUrl);
const guilds = new GuildRepository(database);

describe('guild Guarded activation metadata', () => {
  beforeAll(async () => applyMigrations(database));
  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE guilds CASCADE');
    await guilds.createOrUpdateOwner('100', 'owner');
  });
  afterAll(async () => closeDatabase(database));

  it('distinguishes a real migration from an explicit no-op activation', async () => {
    await guilds.setGuardedBanState('100', true, GuildMode.Guarded, 'owner', {
      migrationId: '11111111-1111-4111-8111-111111111111', snapshotRequired: true,
    });
    expect(await guilds.getGuardedCategory('100', 'MEMBER_BAN')).toMatchObject({
      enabled: true, migrationId: '11111111-1111-4111-8111-111111111111', snapshotRequired: true,
    });

    await guilds.setGuardedBanState('100', false, GuildMode.Test, 'owner', {
      migrationId: null, snapshotRequired: false,
    });
    expect(await guilds.getGuardedCategory('100', 'MEMBER_BAN')).toMatchObject({
      enabled: false, migrationId: null, snapshotRequired: false,
    });
  });
});
