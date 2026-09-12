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
    await guilds.updateSetupState('100', 'HEALTH', ['WELCOME']);
    expect(await guilds.getSetupState('100')).toMatchObject({
      step: 'HEALTH',
      completedSteps: ['WELCOME'],
    });
    await guilds.setMode('100', GuildMode.Test);
    expect((await guilds.get('100'))?.mode).toBe(GuildMode.Test);
    expect((await guilds.get('200'))?.mode).toBe(GuildMode.Observe);
    await guilds.updateSetupState('100', 'WELCOME', []);
  });

  it('stores Guarded category state and returns only the latest permission snapshot migration', async () => {
    const firstMigration = '11111111-1111-4111-8111-111111111111';
    const latestMigration = '22222222-2222-4222-8222-222222222222';
    await guilds.setGuardedBanState('100', true, GuildMode.Guarded, '1');
    expect(await guilds.getGuardedCategory('100', 'MEMBER_BAN')).toMatchObject({
      enabled: true,
      updatedBy: '1',
    });
    expect((await guilds.get('100'))?.mode).toBe(GuildMode.Guarded);
    await guilds.setGuardedBanState('100', false, GuildMode.Test, '1');
    expect((await guilds.get('100'))?.mode).toBe(GuildMode.Test);

    await guilds.saveRolePermissionSnapshot({
      guildId: '100',
      migrationId: firstMigration,
      roleId: 'old-role',
      permissions: '8',
    });
    await guilds.saveRolePermissionSnapshot({
      guildId: '100',
      migrationId: latestMigration,
      roleId: 'role-a',
      permissions: '12',
    });
    await guilds.saveRolePermissionSnapshot({
      guildId: '100',
      migrationId: latestMigration,
      roleId: 'role-b',
      permissions: '16',
    });

    expect(await guilds.getLatestRolePermissionSnapshots('100')).toEqual([
      expect.objectContaining({
        migrationId: latestMigration,
        roleId: 'role-a',
        permissions: '12',
      }),
      expect.objectContaining({
        migrationId: latestMigration,
        roleId: 'role-b',
        permissions: '16',
      }),
    ]);
    expect(await guilds.getLatestRolePermissionSnapshots('200')).toEqual([]);
  });

  it('scopes Security Managers to a guild', async () => {
    await managers.grant({ guildId: '100', userId: '77', grantedBy: '1' });
    expect(await managers.isSecurityManager('100', '77')).toBe(true);
    expect(await managers.isSecurityManager('200', '77')).toBe(false);
    expect(await managers.listSecurityManagers('100')).toEqual([
      expect.objectContaining({ userId: '77', grantedBy: '1' }),
    ]);
    expect(await managers.listSecurityManagers('200')).toEqual([]);
    await managers.revoke('100', '77');
    expect(await managers.isSecurityManager('100', '77')).toBe(false);
  });

  it('lists only guilds where the user has explicit Knight dashboard authority', async () => {
    await guilds.setMode('100', GuildMode.Test);
    await managers.grant({ guildId: '200', userId: '77', grantedBy: '2' });

    expect(await guilds.listAccessibleToUser('1')).toEqual([
      expect.objectContaining({ id: '100', mode: GuildMode.Test, setupStep: 'WELCOME' }),
    ]);
    expect(await guilds.listAccessibleToUser('77')).toEqual([
      expect.objectContaining({ id: '200', mode: GuildMode.Observe, setupStep: 'WELCOME' }),
    ]);
    expect(await guilds.listAccessibleToUser('999')).toEqual([]);

    await managers.revoke('200', '77');
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
  it('creates an initial Staff Profile version atomically and reads it guild-scoped', async () => {
    const created = await staff.createProfileWithInitialVersion({
      guildId: '100',
      name: 'Atomic Helper',
      discordRoleId: 'role-atomic-helper',
      rank: 12,
      permissions: [],
      actionPolicies: {},
      createdBy: '1',
    });

    expect(created.profile.currentVersionId).toBe(created.version.id);
    expect(created.version.version).toBe(1);
    expect((await staff.getCurrentProfileVersion('100', created.profile.id))?.id).toBe(
      created.version.id,
    );
    expect(await staff.getCurrentProfileVersion('200', created.profile.id)).toBeNull();
  });

  it('lists active members for only the requested guild Staff Profile', async () => {
    const created = await staff.createProfileWithInitialVersion({
      guildId: '100',
      name: 'Dashboard Moderator',
      discordRoleId: 'role-dashboard-mod',
      rank: 18,
      permissions: ['member.ban'],
      actionPolicies: {},
      createdBy: '1',
    });
    await staff.assign({
      guildId: '100',
      userId: 'dashboard-user',
      profileId: created.profile.id,
      actorUserId: '1',
    });

    expect(await staff.listActiveAssignmentsForProfile('100', created.profile.id)).toEqual([
      expect.objectContaining({ userId: 'dashboard-user', profileId: created.profile.id }),
    ]);
    expect(await staff.listActiveAssignmentsForProfile('200', created.profile.id)).toEqual([]);
  });

  it('tracks active assignment sync status and deactivation by assignment id', async () => {
    const created = await staff.createProfileWithInitialVersion({
      guildId: '100',
      name: 'Sync Moderator',
      discordRoleId: 'role-sync-mod',
      rank: 25,
      permissions: [],
      actionPolicies: {},
      createdBy: '1',
    });
    const assignment = await staff.assign({
      guildId: '100',
      userId: 'sync-user',
      profileId: created.profile.id,
      actorUserId: '1',
    });

    expect(assignment.id).toBeTruthy();
    expect(await staff.getActiveAssignment('100', 'sync-user')).toMatchObject({
      id: assignment.id,
      profileName: 'Sync Moderator',
      discordRoleId: 'role-sync-mod',
      profileRank: 25,
      syncStatus: 'PENDING',
    });
    await staff.setAssignmentSyncStatus('100', assignment.id, 'NEEDS_REPAIR');
    expect((await staff.getActiveAssignment('100', 'sync-user'))?.syncStatus).toBe('NEEDS_REPAIR');
    expect((await staff.deactivateAssignment({ guildId: '100', userId: 'sync-user' }))?.id).toBe(
      assignment.id,
    );
    expect(await staff.getActiveAssignment('100', 'sync-user')).toBeNull();
  });

  it('preserves immutable profile name, role, and rank across metadata edits', async () => {
    const created = await staff.createProfileWithInitialVersion({
      guildId: '100',
      name: 'Metadata v1',
      discordRoleId: 'role-metadata-v1',
      rank: 10,
      permissions: ['member.ban'],
      actionPolicies: {},
      createdBy: '1',
    });
    const updated = await staff.updateProfileWithVersion({
      guildId: '100',
      profileId: created.profile.id,
      name: 'Metadata v2',
      discordRoleId: 'role-metadata-v2',
      rank: 20,
      permissions: ['member.kick'],
      actionPolicies: {},
      createdBy: '1',
    });

    expect(created.version).toMatchObject({
      version: 1,
      profileName: 'Metadata v1',
      discordRoleId: 'role-metadata-v1',
      rank: 10,
    });
    expect(updated.version).toMatchObject({
      version: 2,
      profileName: 'Metadata v2',
      discordRoleId: 'role-metadata-v2',
      rank: 20,
    });
    expect(await staff.getCurrentProfileVersion('100', created.profile.id)).toMatchObject({
      profileName: 'Metadata v2',
      discordRoleId: 'role-metadata-v2',
      rank: 20,
      permissions: ['member.kick'],
    });
    expect(created.version.permissions).toEqual(['member.ban']);
  });
  it('remaps a recovered Discord role by creating a new immutable Staff Profile version', async () => {
    const created = await staff.createProfileWithInitialVersion({
      guildId: '100', name: 'Recovery Staff', discordRoleId: 'old-role', rank: 15,
      permissions: ['member.ban'], actionPolicies: {}, createdBy: '1',
    });

    const recovered = await staff.remapDiscordRoleForRecovery({
      guildId: '100', profileId: created.profile.id, oldDiscordRoleId: 'old-role',
      newDiscordRoleId: 'new-role', recoveryJobId: 'job-1',
    });

    expect(recovered.version).toMatchObject({
      version: 2, discordRoleId: 'new-role', permissions: ['member.ban'],
    });
    expect(recovered.profile).toMatchObject({ discordRoleId: 'new-role', currentVersionId: recovered.version.id });
    expect(created.version).toMatchObject({ version: 1, discordRoleId: 'old-role' });
  });

});
