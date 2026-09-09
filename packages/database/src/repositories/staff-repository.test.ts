import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../client.js';
import { GuildRepository } from './guild-repository.js';
import { StaffRepository } from './staff-repository.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';
const database = createDatabase(databaseUrl);
const guilds = new GuildRepository(database);
const staff = new StaffRepository(database);

describe('StaffRepository', () => {
  beforeAll(async () => {
    await guilds.createOrUpdateOwner('100', '1');
    await guilds.createOrUpdateOwner('200', '2');
  });

  afterAll(async () => {
    await closeDatabase(database);
  });

  it('never returns another guild\'s staff assignment', async () => {
    const profile = await staff.createProfile({ guildId: '100', name: 'Moderator', discordRoleId: '900', rank: 20 });
    await staff.createProfileVersion({ guildId: '100', profileId: profile.id, permissions: ['member.ban'], actionPolicies: {} });
    await staff.assign({ guildId: '100', userId: '42', profileId: profile.id, actorUserId: '1' });

    expect(await staff.getEffectiveProfile('200', '42')).toBeNull();
    expect((await staff.getEffectiveProfile('100', '42'))?.permissions).toContain('member.ban');
  });

  it('preserves immutable numbered profile versions', async () => {
    const profile = await staff.createProfile({ guildId: '100', name: 'Senior Moderator', discordRoleId: '901', rank: 30 });
    const v1 = await staff.createProfileVersion({ guildId: '100', profileId: profile.id, permissions: ['member.ban'], actionPolicies: {} });
    const v2 = await staff.createProfileVersion({ guildId: '100', profileId: profile.id, permissions: [], actionPolicies: {} });

    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.permissions).toEqual(['member.ban']);
    expect(v2.permissions).toEqual([]);
  });
});
