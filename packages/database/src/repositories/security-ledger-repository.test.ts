import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../client.js';
import { applyMigrations } from '../migrations.js';
import { GuildRepository } from './guild-repository.js';
import { SecurityLedgerRepository } from './security-ledger-repository.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';
const database = createDatabase(databaseUrl);
const guilds = new GuildRepository(database);
const ledger = new SecurityLedgerRepository(database);

describe('security ledger persistence', () => {
  beforeAll(async () => {
    await applyMigrations(database);
    await database.pool.query('TRUNCATE TABLE guilds CASCADE');
    await guilds.createOrUpdateOwner('g1', 'owner-1');
    await guilds.createOrUpdateOwner('g2', 'owner-2');
  });

  afterAll(async () => {
    await closeDatabase(database);
  });

  it('chains entries per guild and keeps guild history isolated', async () => {
    const first = await ledger.append({
      guildId: 'g1',
      severity: 'INFO',
      source: 'KNIGHT',
      action: 'member.warn',
      actorUserId: 'u1',
      targetId: 'u2',
      decisionId: null,
      incidentId: null,
      metadata: {},
    });
    const second = await ledger.append({
      guildId: 'g1',
      severity: 'LOW',
      source: 'CONFIG',
      action: 'staff.profile.update',
      actorUserId: 'u1',
      targetId: 'profile-1',
      decisionId: null,
      incidentId: null,
      metadata: { version: 2 },
    });

    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.entryHash);
    expect(second.entryHash).not.toBe(first.entryHash);
    expect(await ledger.listRecent('g2', {})).toEqual([]);
    expect((await ledger.listRecent('g1', {})).map((entry) => entry.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('distinguishes unconfigured logging from an explicit disabled choice', async () => {
    expect(await ledger.getLoggingSettings('g1')).toBeNull();

    await ledger.saveLoggingSettings({
      guildId: 'g1',
      securityChannelId: null,
      moderationChannelId: null,
      updatedBy: 'owner-1',
    });

    expect(await ledger.getLoggingSettings('g1')).toMatchObject({
      guildId: 'g1',
      securityChannelId: null,
      moderationChannelId: null,
      updatedBy: 'owner-1',
    });

    await ledger.saveLoggingSettings({
      guildId: 'g1',
      securityChannelId: 'security-channel',
      moderationChannelId: 'moderation-channel',
      updatedBy: 'owner-1',
    });

    expect(await ledger.getLoggingSettings('g1')).toMatchObject({
      securityChannelId: 'security-channel',
      moderationChannelId: 'moderation-channel',
    });
  });
});
