import { ProtectionLevel } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createModerationStaffStatePort } from './staff-state-port.js';

describe('moderation staff state', () => {
  it('loads the persisted protection level for a member target', async () => {
    const getProtectionLevel = vi.fn().mockResolvedValue(ProtectionLevel.Critical);
    const getSecurityState = vi.fn().mockResolvedValue({
      guildId: '100',
      mode: 'LOCKDOWN',
      lockedScopes: ['MEMBER_MODERATION'],
      reason: 'Investigation',
      updatedBy: 'owner',
      updatedAt: new Date(),
    });
    const port = createModerationStaffStatePort({
      staffProfiles: { getEffectiveProfile: vi.fn().mockResolvedValue(null) },
      security: { getProtectionLevel, getSecurityState },
      discord: {
        getGuildState: vi.fn().mockResolvedValue({
          guildId: '100',
          ownerId: 'owner',
          knightUserId: 'knight',
          knightRolePosition: 50,
          knightPermissions: 0n,
          roles: [],
        }),
        getMemberState: vi.fn().mockResolvedValue({
          userId: 'target',
          isGuildOwner: false,
          roleIds: [],
          highestRolePosition: 1,
          permissions: 0n,
        }),
      },
    });

    const context = await port.getContext({
      guildId: '100',
      actorUserId: 'actor',
      action: 'member.ban',
      targetId: 'target',
      nowMs: 1_000,
    });

    expect(getProtectionLevel).toHaveBeenCalledWith('100', 'USER', 'target');
    expect(context.target?.protectionLevel).toBe(ProtectionLevel.Critical);
    expect(getSecurityState).toHaveBeenCalledWith('100');
    expect(context.emergency).toEqual({
      mode: 'LOCKDOWN',
      lockedScopes: ['MEMBER_MODERATION'],
    });
  });
});
