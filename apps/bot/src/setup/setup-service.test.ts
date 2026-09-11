import { GuildMode } from '@knight/contracts';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { SetupService, type SetupDependencies } from './setup-service.js';

function makeDependencies(): SetupDependencies {
  return {
    guilds: {
      get: vi.fn().mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Observe }),
      getSetupState: vi.fn().mockResolvedValue({
        guildId: '100',
        step: 'WELCOME',
        completedSteps: [],
        updatedAt: new Date(),
      }),
      updateSetupState: vi.fn().mockResolvedValue(undefined),
      setMode: vi.fn().mockResolvedValue(undefined),
    },
    managers: {
      isSecurityManager: vi.fn().mockResolvedValue(false),
      listSecurityManagers: vi.fn().mockResolvedValue([{ userId: 'manager' }]),
    },
    staff: {
      listProfiles: vi
        .fn()
        .mockResolvedValue([{ id: 'profile-1', discordRoleId: 'role-1', enabled: true }]),
    },
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100',
        ownerId: 'owner',
        knightUserId: 'knight',
        knightRolePosition: 50,
        knightPermissions: PermissionFlagsBits.ManageRoles,
        roles: [{ roleId: 'role-1', position: 20, permissions: 0n }],
      }),
    },
  };
}

describe('SetupService', () => {
  it('returns persistent readiness state for the guild owner', async () => {
    const service = new SetupService(makeDependencies());
    const state = await service.getState('100', 'owner');

    expect(state).toMatchObject({
      mode: GuildMode.Observe,
      step: 'WELCOME',
      profileCount: 1,
      securityManagerCount: 1,
      hierarchyHealthy: true,
    });
  });
  it('denies an arbitrary Discord user before reading setup state', async () => {
    const deps = makeDependencies();
    await expect(new SetupService(deps).getState('100', 'stranger')).rejects.toMatchObject({
      code: 'SETUP_ACCESS_DENIED',
    });
    expect(deps.guilds.getSetupState).not.toHaveBeenCalled();
  });

  it('advances one persistent setup step and records the completed step', async () => {
    const deps = makeDependencies();
    const service = new SetupService(deps);

    await service.advanceStep('100', 'owner');

    expect(deps.guilds.updateSetupState).toHaveBeenCalledWith('100', 'HEALTH', ['WELCOME']);
  });

  it('allows a Security Manager to move Observe to Test and Test back to Observe', async () => {
    const deps = makeDependencies();
    deps.managers.isSecurityManager = vi.fn().mockResolvedValue(true);
    const service = new SetupService(deps);

    await service.transitionMode({
      guildId: '100',
      actorUserId: 'manager',
      targetMode: GuildMode.Test,
    });
    expect(deps.guilds.setMode).toHaveBeenCalledWith('100', GuildMode.Test);

    deps.guilds.get = vi
      .fn()
      .mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Test });
    await service.transitionMode({
      guildId: '100',
      actorUserId: 'manager',
      targetMode: GuildMode.Observe,
    });
    expect(deps.guilds.setMode).toHaveBeenCalledWith('100', GuildMode.Observe);
  });
  it('rejects direct Guarded transitions because migration evidence is required', async () => {
    const deps = makeDependencies();
    deps.guilds.get = vi
      .fn()
      .mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Test });

    await expect(
      new SetupService(deps).transitionMode({
        guildId: '100',
        actorUserId: 'owner',
        targetMode: GuildMode.Guarded,
      }),
    ).rejects.toMatchObject({ code: 'GUARDED_MIGRATION_REQUIRED' });
    expect(deps.guilds.setMode).not.toHaveBeenCalled();
  });

  it('rejects illegal mode transitions without persistence', async () => {
    const deps = makeDependencies();
    deps.guilds.get = vi
      .fn()
      .mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Observe });
    await expect(
      new SetupService(deps).transitionMode({
        guildId: '100',
        actorUserId: 'owner',
        targetMode: GuildMode.Observe,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MODE_TRANSITION' });
    expect(deps.guilds.setMode).not.toHaveBeenCalled();
  });
});
