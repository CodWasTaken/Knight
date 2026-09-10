import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWebRuntime: vi.fn(),
  requireGuildAccess: vi.fn(),
  updatePolicy: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  getDiscordAdapter: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../../../../auth', () => ({ auth: mocks.auth }));
vi.mock('../../../../lib/authorization', () => ({
  requireGuildAccess: mocks.requireGuildAccess,
}));
vi.mock('../../../../lib/server-runtime', () => ({
  getWebRuntime: mocks.getWebRuntime,
}));
vi.mock('../../../../lib/discord-runtime', () => ({
  getWebDiscordAdapter: mocks.getDiscordAdapter,
}));
vi.mock('../../../../lib/staff-profile-service', () => ({
  updateStaffProfilePolicy: mocks.updatePolicy,
  createStaffProfileFromDashboard: mocks.createProfile,
  updateStaffProfileFromDashboard: mocks.updateProfile,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import {
  createStaffProfileAction,
  updateStaffProfileMetadataAction,
  updateStaffProfilePolicyAction,
} from './actions';
describe('updateStaffProfilePolicyAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops before profile lookup when live guild authorization denies access', async () => {
    const getCurrentProfileVersion = vi.fn();
    const repositories = { staff: { getCurrentProfileVersion }, guilds: {}, managers: {} };
    mocks.auth.mockResolvedValue({ user: { id: 'unauthorized-user' } });
    mocks.getWebRuntime.mockReturnValue({ repositories });
    mocks.requireGuildAccess.mockRejectedValue(new Error('denied'));

    const formData = new FormData();
    formData.set('guildId', '100');
    formData.set('profileId', '11111111-1111-4111-8111-111111111111');

    await expect(updateStaffProfilePolicyAction(formData)).rejects.toThrow('denied');
    expect(getCurrentProfileVersion).not.toHaveBeenCalled();
    expect(mocks.updatePolicy).not.toHaveBeenCalled();
  });

  it('uses the Auth.js actor and ignores a forged actor form field', async () => {
    const repositories = {
      staff: {
        getCurrentProfileVersion: vi.fn().mockResolvedValue({
          permissions: ['member.kick'],
        }),
      },
      guilds: {},
      managers: {},
    };
    mocks.auth.mockResolvedValue({ user: { id: 'session-manager' } });
    mocks.getWebRuntime.mockReturnValue({ repositories });
    mocks.requireGuildAccess.mockResolvedValue('SECURITY_MANAGER');
    mocks.updatePolicy.mockResolvedValue({ version: 2 });

    const formData = new FormData();
    formData.set('guildId', '100');
    formData.set('profileId', '11111111-1111-4111-8111-111111111111');
    formData.set('actorUserId', 'forged-owner');
    formData.set('memberBan', 'on');
    formData.set('banMax0', '5');
    formData.set('banWindowMs0', String(30 * 60_000));
    formData.set('banMax1', '');
    formData.set('banWindowMs1', '');
    formData.set('banMax2', '');
    formData.set('banWindowMs2', '');

    await updateStaffProfilePolicyAction(formData);

    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(
      '100',
      { user: { id: 'session-manager' } },
      repositories,
    );
    expect(repositories.staff.getCurrentProfileVersion).toHaveBeenCalledWith(
      '100',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(mocks.updatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: '100',
        profileId: '11111111-1111-4111-8111-111111111111',
        permissions: ['member.kick', 'member.ban'],
        banWindows: [{ max: 5, windowMs: 30 * 60_000 }],
      }),
      { userId: 'session-manager' },
      repositories,
    );
  });
});

describe('dashboard Staff Profile metadata actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates from Auth.js identity and server-side Discord state, ignoring forged actor input', async () => {
    const repositories = { staff: {}, guilds: {}, managers: {} };
    const discord = { getGuildState: vi.fn(), addRole: vi.fn(), removeRole: vi.fn() };
    mocks.auth.mockResolvedValue({ user: { id: 'session-manager' } });
    mocks.getWebRuntime.mockReturnValue({ repositories, env: { DISCORD_TOKEN: 'token' } });
    mocks.requireGuildAccess.mockResolvedValue('SECURITY_MANAGER');
    mocks.getDiscordAdapter.mockReturnValue(discord);
    mocks.createProfile.mockResolvedValue({ version: { version: 1 } });

    const formData = new FormData();
    formData.set('guildId', '100');
    formData.set('name', 'Moderator');
    formData.set('discordRoleId', 'role-mod');
    formData.set('rank', '20');
    formData.set('actorUserId', 'forged-owner');

    await createStaffProfileAction(formData);

    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(
      '100',
      { user: { id: 'session-manager' } },
      repositories,
    );
    expect(mocks.createProfile).toHaveBeenCalledWith(
      { guildId: '100', name: 'Moderator', discordRoleId: 'role-mod', rank: 20 },
      { userId: 'session-manager' },
      { ...repositories, discord },
    );
  });

  it('updates metadata through the same server-side Discord adapter', async () => {
    const repositories = { staff: {}, guilds: {}, managers: {} };
    const discord = { getGuildState: vi.fn(), addRole: vi.fn(), removeRole: vi.fn() };
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } });
    mocks.getWebRuntime.mockReturnValue({ repositories, env: { DISCORD_TOKEN: 'token' } });
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getDiscordAdapter.mockReturnValue(discord);
    mocks.updateProfile.mockResolvedValue({ syncStatus: 'SYNCED', repairAssignmentIds: [] });

    const formData = new FormData();
    formData.set('guildId', '100');
    formData.set('profileId', '11111111-1111-4111-8111-111111111111');
    formData.set('name', 'Senior Moderator');
    formData.set('discordRoleId', 'role-new');
    formData.set('rank', '25');

    await updateStaffProfileMetadataAction(formData);

    expect(mocks.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: '100',
        profileId: '11111111-1111-4111-8111-111111111111',
        name: 'Senior Moderator',
        discordRoleId: 'role-new',
        rank: 25,
      }),
      { userId: 'owner' },
      { ...repositories, discord },
    );
  });

  it('fails closed when the web service has no Discord bot adapter', async () => {
    const repositories = { staff: {}, guilds: {}, managers: {} };
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } });
    mocks.getWebRuntime.mockReturnValue({ repositories, env: {} });
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getDiscordAdapter.mockReturnValue(null);

    const formData = new FormData();
    formData.set('guildId', '100');
    formData.set('name', 'Moderator');
    formData.set('discordRoleId', 'role-mod');
    formData.set('rank', '20');

    await expect(createStaffProfileAction(formData)).rejects.toThrow('DISCORD_TOKEN');
    expect(mocks.createProfile).not.toHaveBeenCalled();
  });
});
