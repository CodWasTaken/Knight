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
      getCurrentProfileVersion: vi.fn().mockResolvedValue({
        id: 'version-1', actionPolicies: {}, permissions: [],
      }),
    },
    securityLedger: {
      getLoggingSettings: vi.fn().mockResolvedValue({
        guildId: '100', securityChannelId: null, moderationChannelId: null,
      }),
    },
    security: {
      getFirewallSettings: vi.fn().mockResolvedValue({ configured: true }),
      listProtectedResources: vi.fn().mockResolvedValue([]),
      getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    },
    backups: {
      getPolicy: vi.fn().mockResolvedValue({ mode: 'DISABLED' }),
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

function setStep(deps: SetupDependencies, step: string): void {
  deps.guilds.getSetupState = vi.fn().mockResolvedValue({
    guildId: '100', step, completedSteps: [], updatedAt: new Date(),
  }) as never;
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

  it('blocks setup progression and mode changes during Panic', async () => {
    const deps = makeDependencies();
    deps.security.getSecurityState = vi.fn().mockResolvedValue({
      mode: 'PANIC',
      lockedScopes: [],
    });
    const service = new SetupService(deps);

    await expect(service.advanceStep('100', 'owner')).rejects.toMatchObject({
      code: 'EMERGENCY_STATE_BLOCKED',
    });
    await expect(
      service.transitionMode({
        guildId: '100',
        actorUserId: 'owner',
        targetMode: GuildMode.Test,
      }),
    ).rejects.toMatchObject({ code: 'EMERGENCY_STATE_BLOCKED' });
    expect(deps.guilds.updateSetupState).not.toHaveBeenCalled();
    expect(deps.guilds.setMode).not.toHaveBeenCalled();
  });

  it('requires an explicit logging choice before advancing to protection', async () => {
    const deps = makeDependencies();
    deps.guilds.getSetupState = vi.fn().mockResolvedValue({
      guildId: '100',
      step: 'LOGGING',
      completedSteps: ['WELCOME', 'HEALTH', 'STAFF', 'POLICIES'],
      updatedAt: new Date(),
    });
    deps.securityLedger.getLoggingSettings = vi.fn().mockResolvedValue(null);
    const service = new SetupService(deps);

    await expect(service.advanceStep('100', 'owner')).rejects.toMatchObject({
      code: 'SETUP_STEP_BLOCKED',
    });
    expect(deps.guilds.updateSetupState).not.toHaveBeenCalled();

    deps.securityLedger.getLoggingSettings = vi.fn().mockResolvedValue({
      guildId: '100',
      securityChannelId: null,
      moderationChannelId: null,
      updatedBy: 'owner',
      updatedAt: new Date(),
    });

    await service.advanceStep('100', 'owner');

    expect(deps.guilds.updateSetupState).toHaveBeenCalledWith('100', 'PROTECTION', [
      'WELCOME',
      'HEALTH',
      'STAFF',
      'POLICIES',
      'LOGGING',
    ]);
  });

  it('requires an explicit firewall choice before advancing to backups', async () => {
    const deps = makeDependencies();
    deps.guilds.getSetupState = vi.fn().mockResolvedValue({
      guildId: '100',
      step: 'PROTECTION',
      completedSteps: ['WELCOME', 'HEALTH', 'STAFF', 'POLICIES', 'LOGGING'],
      updatedAt: new Date(),
    });
    deps.security.getFirewallSettings = vi.fn().mockResolvedValue({ configured: false });
    const service = new SetupService(deps);

    await expect(service.advanceStep('100', 'owner')).rejects.toMatchObject({
      code: 'SETUP_STEP_BLOCKED',
    });
    expect(deps.guilds.updateSetupState).not.toHaveBeenCalled();

    deps.security.getFirewallSettings = vi.fn().mockResolvedValue({ configured: true });
    await service.advanceStep('100', 'owner');

    expect(deps.guilds.updateSetupState).toHaveBeenCalledWith('100', 'BACKUPS', [
      'WELCOME',
      'HEALTH',
      'STAFF',
      'POLICIES',
      'LOGGING',
      'PROTECTION',
    ]);
  });

  it('allows a Security Manager to move Observe to Test and Test back to Observe', async () => {
    const deps = makeDependencies();
    setStep(deps, 'COMPLETE');
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
  it('refuses Observe to Test until setup is complete', async () => {
    const deps = makeDependencies();
    await expect(new SetupService(deps).transitionMode({
      guildId: '100', actorUserId: 'owner', targetMode: GuildMode.Test,
    })).rejects.toMatchObject({ code: 'SETUP_COMPLETE_REQUIRED' });
    expect(deps.guilds.setMode).not.toHaveBeenCalled();
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
  it('blocks HEALTH until Manage Roles, mapped profiles, and hierarchy are healthy', async () => {
    const deps = makeDependencies();
    setStep(deps, 'HEALTH');
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100', ownerId: 'owner', knightUserId: 'knight', knightRolePosition: 50,
      knightPermissions: 0n, roles: [{ roleId: 'role-1', position: 20, permissions: 0n }],
    });
    const service = new SetupService(deps);

    const state = await service.getState('100', 'owner');
    expect(state.currentStepReady).toBe(false);
    expect(state.currentStepBlockers.join(' ')).toContain('Manage Roles');
    await expect(service.advanceStep('100', 'owner')).rejects.toMatchObject({ code: 'SETUP_STEP_BLOCKED' });
    expect(deps.guilds.updateSetupState).not.toHaveBeenCalled();
  });

  it('blocks STAFF until at least one enabled profile maps to a live Discord role', async () => {
    const deps = makeDependencies();
    setStep(deps, 'STAFF');
    deps.staff.listProfiles = vi.fn().mockResolvedValue([]);
    const service = new SetupService(deps);

    expect(await service.getState('100', 'owner')).toMatchObject({ currentStepReady: false });
    await expect(service.advanceStep('100', 'owner')).rejects.toMatchObject({ code: 'SETUP_STEP_BLOCKED' });
  });

  it('blocks POLICIES when an enabled profile has no current saved policy version', async () => {
    const deps = makeDependencies();
    setStep(deps, 'POLICIES');
    deps.staff.getCurrentProfileVersion = vi.fn().mockResolvedValue(null);
    const service = new SetupService(deps);

    const state = await service.getState('100', 'owner');
    expect(state.currentStepReady).toBe(false);
    expect(state.currentStepBlockers.join(' ')).toContain('action policies');
    await expect(service.advanceStep('100', 'owner')).rejects.toMatchObject({ code: 'SETUP_STEP_BLOCKED' });
  });

  it('treats an explicit Disabled logging choice as ready', async () => {
    const deps = makeDependencies();
    setStep(deps, 'LOGGING');
    const service = new SetupService(deps);
    expect(await service.getState('100', 'owner')).toMatchObject({ currentStepReady: true });
  });

  it('blocks PROTECTION until firewall settings are explicitly saved', async () => {
    const deps = makeDependencies();
    setStep(deps, 'PROTECTION');
    deps.security.getFirewallSettings = vi.fn().mockResolvedValue({ configured: false });
    const service = new SetupService(deps);

    expect(await service.getState('100', 'owner')).toMatchObject({ currentStepReady: false });
    await expect(service.advanceStep('100', 'owner')).rejects.toMatchObject({ code: 'SETUP_STEP_BLOCKED' });
  });

  it('treats an explicit Disabled backup policy as configured and ready', async () => {
    const deps = makeDependencies();
    setStep(deps, 'BACKUPS');
    const service = new SetupService(deps);
    expect(await service.getState('100', 'owner')).toMatchObject({ currentStepReady: true });
  });

  it('blocks BACKUPS when no explicit backup policy exists', async () => {
    const deps = makeDependencies();
    setStep(deps, 'BACKUPS');
    deps.backups.getPolicy = vi.fn().mockResolvedValue(null);
    const service = new SetupService(deps);

    const state = await service.getState('100', 'owner');
    expect(state.currentStepReady).toBe(false);
    expect(state.currentStepBlockers.join(' ')).toContain('backup policy');
  });

  it('blocks OBSERVE when any prior configuration readiness check is failing', async () => {
    const deps = makeDependencies();
    setStep(deps, 'OBSERVE');
    deps.backups.getPolicy = vi.fn().mockResolvedValue(null);
    const service = new SetupService(deps);

    const state = await service.getState('100', 'owner');
    expect(state.currentStepReady).toBe(false);
    expect(state.currentStepBlockers.join(' ')).toContain('backup policy');
    await expect(service.advanceStep('100', 'owner')).rejects.toMatchObject({ code: 'SETUP_STEP_BLOCKED' });
  });

  it('advances OBSERVE to COMPLETE without changing the guild operating mode', async () => {
    const deps = makeDependencies();
    setStep(deps, 'OBSERVE');
    const service = new SetupService(deps);

    await service.advanceStep('100', 'owner');

    expect(deps.guilds.updateSetupState).toHaveBeenCalledWith('100', 'COMPLETE', ['OBSERVE']);
    expect(deps.guilds.setMode).not.toHaveBeenCalled();
  });

});
