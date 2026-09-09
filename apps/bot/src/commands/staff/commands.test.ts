import { describe, expect, it, vi } from 'vitest';
import { executeStaffCreateProfile } from './create-profile.js';
import { executeStaffAssign } from './assign.js';
import { executeStaffRemove } from './remove.js';
import { executeStaffInspect } from './inspect.js';

const baseInput = {
  guildId: '100',
  actorUserId: '1',
} as const;

describe('staff command handlers', () => {
  it('creates a zero-permission Staff Profile through RoleSyncService', async () => {
    const service = { createProfile: vi.fn().mockResolvedValue({}) };

    const result = await executeStaffCreateProfile(
      { ...baseInput, name: 'Moderator', discordRoleId: 'role-mod', rank: 20 },
      service,
    );

    expect(service.createProfile).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '1',
      name: 'Moderator',
      discordRoleId: 'role-mod',
      rank: 20,
    });
    expect(result.content).toContain('Moderator');
    expect(result.content).toContain('zero permissions');
  });

  it('assigns a profile by name or ID and surfaces repair state', async () => {
    const service = {
      assignByReference: vi.fn().mockResolvedValue({ syncStatus: 'NEEDS_REPAIR' }),
    };

    const result = await executeStaffAssign(
      { ...baseInput, userId: '42', profileReference: 'Moderator' },
      service,
    );

    expect(service.assignByReference).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '1',
      userId: '42',
      profileReference: 'Moderator',
    });
    expect(result.content).toContain('assignment is active');
    expect(result.content).toContain('NEEDS_REPAIR');
  });

  it('removes Knight authority even when Discord role cleanup needs repair', async () => {
    const service = {
      remove: vi.fn().mockResolvedValue({ removed: true, syncStatus: 'NEEDS_REPAIR' }),
    };

    const result = await executeStaffRemove({ ...baseInput, userId: '42' }, service);

    expect(service.remove).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: '1',
      userId: '42',
    });
    expect(result.content).toContain('Knight authority removed');
    expect(result.content).toContain('NEEDS_REPAIR');
  });

  it('shows authoritative assignment state and explicit repair status', async () => {
    const service = {
      inspect: vi.fn().mockResolvedValue({
        assignment: {
          id: 'assignment-1',
          guildId: '100',
          userId: '42',
          profileId: 'profile-mod',
          profileName: 'Moderator',
          discordRoleId: 'role-mod',
          profileRank: 20,
          syncStatus: 'NEEDS_REPAIR',
        },
        authoritative: true,
        discordRoleIds: ['role-mod'],
        mappedRoleIds: ['role-mod'],
        member: null,
      }),
    };

    const result = await executeStaffInspect({ guildId: '100', userId: '42' }, service);

    expect(result.content).toContain('Moderator');
    expect(result.content).toContain('profile-mod');
    expect(result.content).toContain('Rank: 20');
    expect(result.content).toContain('<@&role-mod>');
    expect(result.content).toContain('Active Knight assignment: yes');
    expect(result.content).toContain('NEEDS_REPAIR');
  });

  it('does not present a manual mapped Discord role as Knight staff authority', async () => {
    const service = {
      inspect: vi.fn().mockResolvedValue({
        assignment: null,
        authoritative: false,
        discordRoleIds: ['role-mod'],
        mappedRoleIds: ['role-mod'],
        member: null,
      }),
    };

    const result = await executeStaffInspect({ guildId: '100', userId: '42' }, service);

    expect(result.content).toContain('Active Knight assignment: no');
    expect(result.content).toContain('does not grant Knight authority');
    expect(result.content).toContain('<@&role-mod>');
  });

  it('explains ambiguous Staff Profile names without choosing one', async () => {
    const service = {
      assignByReference: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('ambiguous'), { code: 'PROFILE_REFERENCE_AMBIGUOUS' }),
        ),
    };

    const result = await executeStaffAssign(
      { ...baseInput, userId: '42', profileReference: 'MODERATOR' },
      service,
    );

    expect(result.content).toMatch(/multiple Staff Profiles/i);
    expect(result.content).toContain('exact profile name or profile ID');
  });

  it('sanitizes unexpected staff-management failures', async () => {
    const service = {
      assignByReference: vi.fn().mockRejectedValue(new Error('postgres://secret@db token=private')),
    };

    const result = await executeStaffAssign(
      { ...baseInput, userId: '42', profileReference: 'Moderator' },
      service,
    );

    expect(result.content).toContain('could not complete');
    expect(result.content).toContain('/staff inspect');
    expect(result.content).not.toContain('No authority was granted');
    expect(result.content).not.toContain('postgres://');
    expect(result.content).not.toContain('token=private');
  });
});
