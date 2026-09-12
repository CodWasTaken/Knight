import { PolicyDecision, ProtectionLevel, type SecurityDecision } from '@knight/contracts';
import { MessageFlags, type Interaction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { routeInteraction } from './router.js';

const denied: SecurityDecision = {
  decision: PolicyDecision.Deny,
  code: 'PERMISSION_MISSING',
  reason: 'Missing permission.',
  policyVersionId: null,
  metadata: {},
};

const allowed: SecurityDecision = {
  decision: PolicyDecision.Allow,
  code: 'ALLOWED',
  reason: 'Allowed.',
  policyVersionId: 'version-1',
  metadata: {},
};

function makeModerationDependencies(decision: SecurityDecision = denied) {
  return {
    authorize: vi.fn().mockResolvedValue(decision),
    staffProfiles: { getEffectiveProfile: vi.fn().mockResolvedValue(null) },
    security: {
      getProtectionLevel: vi.fn().mockResolvedValue(ProtectionLevel.Normal),
      getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    },
    rateLimits: { consume: vi.fn() },
    decisions: { record: vi.fn() },
    securityRecorder: { record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }) },
    correlations: { create: vi.fn().mockResolvedValue(undefined) },
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100',
        ownerId: '42',
        knightUserId: '999',
        knightRolePosition: 100,
        knightPermissions: 0n,
        roles: [],
      }),
      getMemberState: vi.fn().mockResolvedValue(null),
      banMember: vi.fn(),
      kickMember: vi.fn(),
      timeoutMember: vi.fn(),
      unbanMember: vi.fn(),
      sendDirectMessage: vi.fn(),
      fetchRecentMessages: vi.fn().mockResolvedValue([]),
      deleteMessages: vi.fn().mockResolvedValue(0),
    },
    warnings: {
      create: vi.fn(),
      setDmDeliveryStatus: vi.fn(),
      listForUser: vi.fn().mockResolvedValue([]),
    },
    createCorrelationId: vi.fn(() => 'corr-1'),
  };
}

function makeRouterDependencies() {
  const moderation = makeModerationDependencies();
  return {
    memberBan: moderation,
    memberWarn: moderation,
    memberWarnings: moderation,
    memberTimeout: moderation,
    memberKick: moderation,
    memberUnban: moderation,
    messagePurge: moderation,
    roleSync: {
      createProfile: vi.fn().mockResolvedValue({}),
      assignByReference: vi.fn().mockResolvedValue({ syncStatus: 'SYNCED' }),
      remove: vi.fn().mockResolvedValue({ removed: true, syncStatus: 'SYNCED' }),
      inspect: vi.fn().mockResolvedValue({
        assignment: null,
        authoritative: false,
        discordRoleIds: [],
        mappedRoleIds: [],
        member: null,
      }),
    },
    securityManagers: {
      grant: vi.fn().mockResolvedValue(undefined),
      revoke: vi.fn().mockResolvedValue(undefined),
    },
    backup: {
      create: vi.fn().mockResolvedValue({ content: 'Backup queued: backup-1 (PENDING).' }),
      status: vi.fn().mockResolvedValue({ content: 'Latest backup: backup-1 — COMPLETED.' }),
    },
    emergency: {
      status: vi.fn().mockResolvedValue({
        mode: 'NORMAL',
        lockedScopes: [],
        reason: null,
        updatedBy: null,
      }),
      lockdown: vi.fn().mockResolvedValue(undefined),
      unlock: vi.fn().mockResolvedValue(undefined),
      panic: vi.fn().mockResolvedValue(undefined),
      clearPanic: vi.fn().mockResolvedValue(undefined),
    },
    setup: {
      setup: { getState: vi.fn() },
      migrations: { previewBanGuard: vi.fn() },
    },
    doctor: {
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkMigrations: vi.fn().mockResolvedValue(undefined),
      checkRedis: vi.fn().mockResolvedValue(undefined),
      guilds: { get: vi.fn().mockResolvedValue({ id: '100', ownerId: '1', mode: 'OBSERVE' }) },
      staff: { listProfiles: vi.fn().mockResolvedValue([]) },
      discord: { getGuildState: vi.fn().mockRejectedValue(new Error('offline')) },
      appUrl: 'https://knight.example.com',
    },
    now: () => 12_345,
  };
}

type FakeOptions = Readonly<{
  users?: Readonly<Record<string, string>>;
  strings?: Readonly<Record<string, string>>;
  roles?: Readonly<Record<string, string>>;
  integers?: Readonly<Record<string, number>>;
  booleans?: Readonly<Record<string, boolean>>;
}>;

function fakeCommandInteraction(
  commandName: string,
  subcommand: string,
  options: FakeOptions = {},
  guildId: string | null = '100',
) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    isChatInputCommand: () => true,
    commandName,
    guildId,
    channelId: 'channel-1',
    user: { id: '42' },
    client: { user: { id: '999' } },
    options: {
      getSubcommand: () => subcommand,
      getUser: (name: string, required = false) => {
        const id = options.users?.[name];
        if (id !== undefined) return { id };
        return required ? { id: '77' } : null;
      },
      getString: (name: string) => options.strings?.[name] ?? '',
      getRole: (name: string) => ({ id: options.roles?.[name] ?? 'role-unknown' }),
      getInteger: (name: string) => options.integers?.[name] ?? 0,
      getBoolean: (name: string) => options.booleans?.[name] ?? false,
    },
    reply,
  } as unknown as Interaction;
  return { interaction, reply };
}

describe('routeInteraction', () => {
  it('routes /member ban into the guarded command and replies ephemerally', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction, reply } = fakeCommandInteraction('member', 'ban', {
      users: { user: '77' },
      strings: { reason: 'Scam links' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.memberBan.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: '100',
        actorUserId: '42',
        targetId: '77',
        action: 'member.ban',
        nowMs: 12_345,
      }),
      expect.any(Object),
    );
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('routes /doctor into the health report and replies ephemerally', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction, reply } = fakeCommandInteraction('doctor', '');

    await routeInteraction(interaction, dependencies);

    expect(dependencies.doctor.checkDatabase).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Knight doctor'),
        flags: MessageFlags.Ephemeral,
      }),
    );
  });

  it('routes /setup into the persistent setup status command and replies ephemerally', async () => {
    const dependencies = makeRouterDependencies();
    dependencies.setup.setup.getState.mockResolvedValue({
      mode: 'OBSERVE',
      step: 'WELCOME',
      completedSteps: [],
      profileCount: 0,
      profileReady: false,
      securityManagerCount: 0,
      securityManagerIds: [],
      manageRolesReady: true,
      hierarchyHealthy: true,
      blockingRoleIds: [],
      nextAction: 'Continue setup to HEALTH.',
    });
    const { interaction, reply } = fakeCommandInteraction('setup', '');

    await routeInteraction(interaction, dependencies);

    expect(dependencies.setup.setup.getState).toHaveBeenCalledWith('100', '42');
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Knight setup status'),
        flags: MessageFlags.Ephemeral,
      }),
    );
  });

  it('routes /staff create-profile with the selected role and rank', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction, reply } = fakeCommandInteraction('staff', 'create-profile', {
      strings: { name: 'Moderator' },
      roles: { role: 'role-mod' },
      integers: { rank: 20 },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.roleSync.createProfile).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      name: 'Moderator',
      discordRoleId: 'role-mod',
      rank: 20,
    });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });
  it('routes /staff assign using the profile reference', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction } = fakeCommandInteraction('staff', 'assign', {
      users: { user: '77' },
      strings: { profile: 'Moderator' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.roleSync.assignByReference).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      userId: '77',
      profileReference: 'Moderator',
    });
  });

  it('routes /staff remove into RoleSyncService', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction } = fakeCommandInteraction('staff', 'remove', {
      users: { user: '77' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.roleSync.remove).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      userId: '77',
    });
  });

  it('routes /staff inspect into RoleSyncService', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction } = fakeCommandInteraction('staff', 'inspect', {
      users: { user: '77' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.roleSync.inspect).toHaveBeenCalledWith('100', '77');
  });

  it('routes /backup create and /backup status with guild and actor identity', async () => {
    const dependencies = makeRouterDependencies();
    const create = fakeCommandInteraction('backup', 'create');
    await routeInteraction(create.interaction, dependencies);
    expect(dependencies.backup.create).toHaveBeenCalledWith({ guildId: '100', actorUserId: '42' });
    expect(create.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Backup queued'),
      flags: MessageFlags.Ephemeral,
    }));

    const status = fakeCommandInteraction('backup', 'status');
    await routeInteraction(status.interaction, dependencies);
    expect(dependencies.backup.status).toHaveBeenCalledWith({ guildId: '100', actorUserId: '42' });
    expect(status.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('routes /security manager-add into the owner-only service', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction } = fakeCommandInteraction('security', 'manager-add', {
      users: { user: '77' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.securityManagers.grant).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      userId: '77',
    });
  });

  it('routes /security manager-remove into the owner-only service', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction } = fakeCommandInteraction('security', 'manager-remove', {
      users: { user: '77' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.securityManagers.revoke).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      userId: '77',
    });
  });

  it('routes emergency status and Lockdown commands ephemerally', async () => {
    const dependencies = makeRouterDependencies();
    const status = fakeCommandInteraction('security', 'status');
    await routeInteraction(status.interaction, dependencies);
    expect(dependencies.emergency.status).toHaveBeenCalledWith('100');
    expect(status.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('NORMAL'),
        flags: MessageFlags.Ephemeral,
      }),
    );

    const lockdown = fakeCommandInteraction('security', 'lockdown', {
      strings: { scope: 'MEMBER_MODERATION', reason: 'Investigating access' },
    });
    await routeInteraction(lockdown.interaction, dependencies);
    expect(dependencies.emergency.lockdown).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      scopes: ['MEMBER_MODERATION'],
      reason: 'Investigating access',
    });
    expect(lockdown.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it('routes Unlock, Panic, and Panic Clear with required safety inputs', async () => {
    const dependencies = makeRouterDependencies();
    await routeInteraction(
      fakeCommandInteraction('security', 'unlock', {
        strings: { reason: 'Investigation complete' },
      }).interaction,
      dependencies,
    );
    await routeInteraction(
      fakeCommandInteraction('security', 'panic', {
        strings: { reason: 'Confirmed compromise' },
        booleans: { confirm: true },
      }).interaction,
      dependencies,
    );
    await routeInteraction(
      fakeCommandInteraction('security', 'panic-clear', {
        strings: { reason: 'Access restored' },
      }).interaction,
      dependencies,
    );

    expect(dependencies.emergency.unlock).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      reason: 'Investigation complete',
    });
    expect(dependencies.emergency.panic).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      reason: 'Confirmed compromise',
      confirmed: true,
    });
    expect(dependencies.emergency.clearPanic).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '42',
      reason: 'Access restored',
    });
  });

  it('rejects staff/security management commands outside a guild', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction, reply } = fakeCommandInteraction(
      'staff',
      'remove',
      {
        users: { user: '77' },
      },
      null,
    );

    await routeInteraction(interaction, dependencies);

    expect(dependencies.roleSync.remove).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('inside a Discord server'),
        flags: MessageFlags.Ephemeral,
      }),
    );
  });

  it('ignores non-chat-input interactions', async () => {
    const dependencies = makeRouterDependencies();
    const interaction = { isChatInputCommand: () => false } as unknown as Interaction;

    await routeInteraction(interaction, dependencies);

    expect(dependencies.memberBan.authorize).not.toHaveBeenCalled();
    expect(dependencies.roleSync.createProfile).not.toHaveBeenCalled();
  });
});

describe('moderation command routing', () => {
  it('routes /member warn with member and reason', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction, reply } = fakeCommandInteraction('member', 'warn', {
      users: { user: '77' },
      strings: { reason: 'Repeated spam' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.memberWarn.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member.warn', targetId: '77', nowMs: 12_345 }),
      expect.any(Object),
    );
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('routes /member warnings into warning-history lookup', async () => {
    const dependencies = makeRouterDependencies();
    const { interaction } = fakeCommandInteraction('member', 'warnings', {
      users: { user: '77' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.memberWarnings.warnings.listForUser).toHaveBeenCalledWith('100', '77');
  });

  it('routes /member timeout and parses the duration before mutation', async () => {
    const dependencies = makeRouterDependencies();
    dependencies.memberTimeout.authorize.mockResolvedValue(allowed);
    const { interaction } = fakeCommandInteraction('member', 'timeout', {
      users: { user: '77' },
      strings: { duration: '1h', reason: 'Cooldown' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.memberTimeout.discord.timeoutMember).toHaveBeenCalledWith({
      guildId: '100',
      targetUserId: '77',
      durationMs: 60 * 60_000,
      reason: 'Cooldown',
    });
  });

  it('routes /member kick through the shared moderation dependencies', async () => {
    const dependencies = makeRouterDependencies();
    dependencies.memberKick.authorize.mockResolvedValue(allowed);
    const { interaction } = fakeCommandInteraction('member', 'kick', {
      users: { user: '77' },
      strings: { reason: 'Raid behavior' },
    });

    await routeInteraction(interaction, dependencies);
    expect(dependencies.memberKick.discord.kickMember).toHaveBeenCalledWith({
      guildId: '100',
      targetUserId: '77',
      reason: 'Raid behavior',
    });
  });

  it('routes /member unban from the explicit Discord user ID', async () => {
    const dependencies = makeRouterDependencies();
    dependencies.memberUnban.authorize.mockResolvedValue(allowed);
    const { interaction } = fakeCommandInteraction('member', 'unban', {
      strings: { user_id: '123456789', reason: 'Appeal accepted' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.memberUnban.discord.unbanMember).toHaveBeenCalledWith({
      guildId: '100',
      targetUserId: '123456789',
      reason: 'Appeal accepted',
    });
  });

  it('routes /message purge with channel, count, and optional member filter', async () => {
    const dependencies = makeRouterDependencies();
    dependencies.messagePurge.authorize.mockResolvedValue(allowed);
    const { interaction } = fakeCommandInteraction('message', 'purge', {
      users: { user: '88' },
      integers: { count: 25 },
      strings: { reason: 'Channel cleanup' },
    });

    await routeInteraction(interaction, dependencies);

    expect(dependencies.messagePurge.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'message.purge', targetId: '88' }),
      expect.any(Object),
    );
    expect(dependencies.messagePurge.discord.fetchRecentMessages).toHaveBeenCalledWith({
      channelId: 'channel-1',
      limit: 25,
    });
  });
});
