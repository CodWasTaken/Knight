import { GuildMode, PolicyDecision, type SecurityDecision } from '@knight/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../client.js';
import { applyMigrations } from '../migrations.js';
import { GuildRepository } from './guild-repository.js';
import { PolicyDecisionRepository } from './policy-decision-repository.js';
import { SecurityManagerRepository } from './security-manager-repository.js';
import { StaffRepository } from './staff-repository.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';
const database = createDatabase(databaseUrl);
const guilds = new GuildRepository(database);
const decisions = new PolicyDecisionRepository(database);
const managers = new SecurityManagerRepository(database);
const staff = new StaffRepository(database);

describe('security persistence', () => {
  beforeAll(async () => {
    await applyMigrations(database);
    await database.pool.query('TRUNCATE TABLE guilds CASCADE');
    await guilds.createOrUpdateOwner('100', '1');
    await guilds.createOrUpdateOwner('200', '2');
  });

  afterAll(async () => {
    await closeDatabase(database);
  });

  it("never returns another guild's staff assignment", async () => {
    const profile = await staff.createProfile({
      guildId: '100',
      name: 'Moderator',
      discordRoleId: '900',
      rank: 20,
    });
    await staff.createProfileVersion({
      guildId: '100',
      profileId: profile.id,
      permissions: ['member.ban'],
      actionPolicies: {},
    });
    await staff.assign({ guildId: '100', userId: '42', profileId: profile.id, actorUserId: '1' });

    expect(await staff.getEffectiveProfile('200', '42')).toBeNull();
    expect((await staff.getEffectiveProfile('100', '42'))?.permissions).toContain('member.ban');
    expect((await staff.listProfiles('100')).map((item) => item.name)).toContain('Moderator');

    await staff.deactivateAssignment({ guildId: '100', userId: '42' });
    expect(await staff.getEffectiveProfile('100', '42')).toBeNull();
  });

  it("rejects assigning another guild's profile", async () => {
    const profile = await staff.createProfile({
      guildId: '200',
      name: 'Guild 200 Staff',
      discordRoleId: '990',
      rank: 10,
    });
    await expect(
      staff.assign({ guildId: '100', userId: '98', profileId: profile.id, actorUserId: '1' }),
    ).rejects.toThrow(/not found in guild/);
  });

  it('preserves immutable numbered profile versions', async () => {
    const profile = await staff.createProfile({
      guildId: '100',
      name: 'Senior Moderator',
      discordRoleId: '901',
      rank: 30,
    });
    const v1 = await staff.createProfileVersion({
      guildId: '100',
      profileId: profile.id,
      permissions: ['member.ban'],
      actionPolicies: {},
    });
    const v2 = await staff.createProfileVersion({
      guildId: '100',
      profileId: profile.id,
      permissions: [],
      actionPolicies: {},
    });

    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.permissions).toEqual(['member.ban']);
    expect(v2.permissions).toEqual([]);
  });

  it('stores setup state and guild mode per guild', async () => {
    expect((await guilds.getSetupState('100'))?.step).toBe('WELCOME');
    await guilds.setMode('100', GuildMode.Test);
    expect((await guilds.get('100'))?.mode).toBe(GuildMode.Test);
    expect((await guilds.get('200'))?.mode).toBe(GuildMode.Observe);
  });

  it('scopes Security Managers to a guild', async () => {
    await managers.grant({ guildId: '100', userId: '77', grantedBy: '1' });
    expect(await managers.isSecurityManager('100', '77')).toBe(true);
    expect(await managers.isSecurityManager('200', '77')).toBe(false);
    await managers.revoke('100', '77');
    expect(await managers.isSecurityManager('100', '77')).toBe(false);
  });

  it('records guarded decisions from the shared request and decision shape', async () => {
    const request = {
      guildId: '100',
      actorUserId: '42',
      action: 'member.ban' as const,
      targetId: '77',
      nowMs: 1_000,
    };
    const decision: SecurityDecision = {
      decision: PolicyDecision.Deny,
      code: 'RATE_LIMIT_EXCEEDED',
      reason: 'test',
      policyVersionId: null,
      metadata: { rate: { allowed: false } },
    };

    const id = await decisions.record(request, decision);
    const result = await database.pool.query<{ code: string; target_id: string }>(
      'SELECT code, target_id FROM policy_decisions WHERE id = $1',
      [id],
    );
    expect(result.rows[0]).toEqual({ code: 'RATE_LIMIT_EXCEEDED', target_id: '77' });
  });

  it('records policy decisions with guild attribution', async () => {
    const id = await decisions.record({
      guildId: '100',
      actorUserId: '42',
      action: 'member.ban',
      decision: PolicyDecision.Deny,
      code: 'TEST_DENY',
      metadata: { source: 'integration' },
    });
    const result = await database.pool.query<{ guild_id: string; code: string }>(
      'SELECT guild_id, code FROM policy_decisions WHERE id = $1',
      [id],
    );
    expect(result.rows[0]).toEqual({ guild_id: '100', code: 'TEST_DENY' });
  });
});
