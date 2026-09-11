import { GuildMode } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { executeSetupCommand } from './setup.js';

function state(mode: GuildMode) {
  return {
    mode,
    step: 'OBSERVE' as const,
    completedSteps: ['WELCOME'] as const,
    profileCount: 2,
    profileReady: true,
    securityManagerCount: 1,
    securityManagerIds: ['77'],
    manageRolesReady: true,
    hierarchyHealthy: true,
    blockingRoleIds: [],
    nextAction: 'Continue setup to COMPLETE.',
  };
}

describe('executeSetupCommand', () => {
  it('shows persistent readiness and Observe to Test guidance', async () => {
    const setup = { getState: vi.fn().mockResolvedValue(state(GuildMode.Observe)) };
    const migrations = { previewBanGuard: vi.fn() };
    const result = await executeSetupCommand(
      { guildId: '100', actorUserId: '42' },
      { setup, migrations },
    );

    expect(setup.getState).toHaveBeenCalledWith('100', '42');
    expect(result.content).toContain('OBSERVE');
    expect(result.content).toContain('Hierarchy: healthy');
    expect(result.content).toContain('Staff Profiles: ready (2)');
    expect(result.content).toContain('Security Managers: 1');
    expect(result.content).toContain('Observe → Test');
    expect(migrations.previewBanGuard).not.toHaveBeenCalled();
  });

  it('includes the live MEMBER_BAN preview in Test mode', async () => {
    const setup = { getState: vi.fn().mockResolvedValue(state(GuildMode.Test)) };
    const migrations = {
      previewBanGuard: vi
        .fn()
        .mockResolvedValue({ blocked: false, staffCount: 4, roles: [{}, {}] }),
    };
    const result = await executeSetupCommand(
      { guildId: '100', actorUserId: '42' },
      { setup, migrations },
    );

    expect(migrations.previewBanGuard).toHaveBeenCalledWith('100');
    expect(result.content).toContain('MEMBER_BAN');
    expect(result.content).toContain('2 role');
    expect(result.content).toContain('4 active staff');
    expect(result.content).toContain('Owner confirmation');
  });

  it('shows the owner rollback path while Guarded is active', async () => {
    const setup = { getState: vi.fn().mockResolvedValue(state(GuildMode.Guarded)) };
    const migrations = { previewBanGuard: vi.fn() };
    const result = await executeSetupCommand(
      { guildId: '100', actorUserId: '42' },
      { setup, migrations },
    );

    expect(result.content).toContain('GUARDED');
    expect(result.content).toContain('rollback');
  });
});
