import { PolicyDecision, type SecurityDecision } from '@knight/contracts';
import { MessageFlags, type Interaction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { MemberBanCommandDependencies } from './member/ban.js';
import { routeInteraction } from './router.js';

const denied: SecurityDecision = {
  decision: PolicyDecision.Deny,
  code: 'PERMISSION_MISSING',
  reason: 'Missing permission.',
  policyVersionId: null,
  metadata: {},
};

function makeBanDependencies(): MemberBanCommandDependencies {
  return {
    authorize: vi.fn().mockResolvedValue(denied),
    staffProfiles: { getEffectiveProfile: vi.fn().mockResolvedValue(null) },
    rateLimits: { consume: vi.fn() },
    decisions: { record: vi.fn() },
    correlations: { create: vi.fn() },
    discord: {
      getGuildState: vi.fn(),
      getMemberState: vi.fn(),
      banMember: vi.fn(),
    },
    createCorrelationId: vi.fn(() => 'corr-1'),
  };
}

function makeRouterDependencies() {
  return {
    memberBan: makeBanDependencies(),
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
    now: () => 12_345,
  };
}

type FakeOptions = Readonly<{
  users?: Readonly<Record<string, string>>;
  strings?: Readonly<Record<string, string>>;
  roles?: Readonly<Record<string, string>>;
  integers?: Readonly<Record<string, number>>;
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
    user: { id: '42' },
    client: { user: { id: '999' } },
    options: {
      getSubcommand: () => subcommand,
      getUser: (name: string) => ({ id: options.users?.[name] ?? '77' }),
      getString: (name: string) => options.strings?.[name] ?? '',
      getRole: (name: string) => ({ id: options.roles?.[name] ?? 'role-unknown' }),
      getInteger: (name: string) => options.integers?.[name] ?? 0,
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
