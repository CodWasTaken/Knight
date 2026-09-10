import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../client.js';
import { applyMigrations } from '../migrations.js';
import { GuildRepository } from './guild-repository.js';
import { WarningRepository } from './warning-repository.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';
const database = createDatabase(databaseUrl);
const guilds = new GuildRepository(database);
const warnings = new WarningRepository(database);

describe('warning persistence', () => {
  beforeAll(async () => {
    await applyMigrations(database);
    await database.pool.query('TRUNCATE TABLE guilds CASCADE');
    await guilds.createOrUpdateOwner('100', '1');
    await guilds.createOrUpdateOwner('200', '2');
  });

  afterAll(async () => {
    await closeDatabase(database);
  });
  it('keeps warning history guild-scoped, newest-first, and updates DM status', async () => {
    const older = await warnings.create({
      guildId: '100',
      targetUserId: '42',
      actorUserId: '1',
      reason: 'Older warning',
      actorProfileVersionId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await warnings.create({
      guildId: '100',
      targetUserId: '42',
      actorUserId: '1',
      reason: 'Newer warning',
      actorProfileVersionId: null,
    });
    await warnings.create({
      guildId: '200',
      targetUserId: '42',
      actorUserId: '2',
      reason: 'Other guild',
      actorProfileVersionId: null,
    });

    await warnings.setDmDeliveryStatus('100', newer.id, 'FAILED');

    const history = await warnings.listForUser('100', '42');
    expect(history.map((warning) => warning.id)).toEqual([newer.id, older.id]);
    expect(history[0]).toMatchObject({ reason: 'Newer warning', dmDeliveryStatus: 'FAILED' });
    expect(await warnings.listForUser('200', '42')).toEqual([
      expect.objectContaining({ reason: 'Other guild' }),
    ]);
  });
});
