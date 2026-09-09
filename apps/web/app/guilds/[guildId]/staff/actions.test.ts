import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWebRuntime: vi.fn(),
  requireGuildAccess: vi.fn(),
  updatePolicy: vi.fn(),
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
vi.mock('../../../../lib/staff-profile-service', () => ({
  updateStaffProfilePolicy: mocks.updatePolicy,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { updateStaffProfilePolicyAction } from './actions';
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
