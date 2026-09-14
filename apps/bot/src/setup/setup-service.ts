import { GuildMode, SETUP_STEPS, type SetupStep } from '@knight/contracts';
import { PermissionFlagsBits } from 'discord-api-types/v10';

export interface SetupDependencies {
  guilds: {
    get(guildId: string): Promise<{ id: string; ownerId: string; mode: GuildMode } | null>;
    getSetupState(guildId: string): Promise<{
      guildId: string;
      step: SetupStep;
      completedSteps: readonly SetupStep[];
      updatedAt: Date;
    } | null>;
    updateSetupState(
      guildId: string,
      step: SetupStep,
      completedSteps: readonly SetupStep[],
    ): Promise<void>;
    setMode(guildId: string, mode: GuildMode): Promise<void>;
  };
  managers: {
    isSecurityManager(guildId: string, userId: string): Promise<boolean>;
    listSecurityManagers(guildId: string): Promise<readonly { userId: string }[]>;
  };
  staff: {
    listProfiles(guildId: string): Promise<
      readonly {
        id: string;
        discordRoleId: string;
        enabled: boolean;
      }[]
    >;
    getCurrentProfileVersion(
      guildId: string,
      profileId: string,
    ): Promise<{ actionPolicies: object } | null>;
  };
  securityLedger: {
    getLoggingSettings(guildId: string): Promise<unknown | null>;
  };
  security: {
    getFirewallSettings(guildId: string): Promise<{ configured: boolean }>;
    listProtectedResources(guildId: string): Promise<readonly unknown[]>;
    getSecurityState(guildId: string): Promise<{
      mode: 'NORMAL' | 'LOCKDOWN' | 'PANIC';
      lockedScopes: readonly string[];
    }>;
  };
  backups: {
    getPolicy(guildId: string): Promise<unknown | null>;
  };
  discord: {
    getGuildState(guildId: string): Promise<{
      guildId: string;
      ownerId: string;
      knightUserId: string;
      knightRolePosition: number;
      knightPermissions: bigint;
      roles: readonly { roleId: string; position: number; permissions: bigint }[];
    }>;
  };
}

export class SetupError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SetupError';
  }
}
export type SetupStateView = Readonly<{
  mode: GuildMode;
  step: SetupStep;
  completedSteps: readonly SetupStep[];
  profileCount: number;
  profileReady: boolean;
  securityManagerCount: number;
  securityManagerIds: readonly string[];
  manageRolesReady: boolean;
  hierarchyHealthy: boolean;
  blockingRoleIds: readonly string[];
  currentStepReady: boolean;
  currentStepBlockers: readonly string[];
  protectedResourceCount: number;
  nextAction: string;
}>;

function hasPermission(value: bigint, permission: bigint): boolean {
  return (value & permission) === permission;
}

function nextAction(step: SetupStep): string {
  const index = SETUP_STEPS.indexOf(step);
  const next = SETUP_STEPS[index + 1];
  return next === undefined ? 'Review Knight protection status.' : `Continue setup to ${next}.`;
}

type ReadinessSnapshot = Readonly<{
  manageRolesReady: boolean;
  profileReady: boolean;
  policiesReady: boolean;
  hierarchyHealthy: boolean;
  blockingRoleIds: readonly string[];
  loggingReady: boolean;
  protectionReady: boolean;
  backupsReady: boolean;
  protectedResourceCount: number;
}>;

function stepBlockers(step: SetupStep, readiness: ReadinessSnapshot): string[] {
  const blockers: string[] = [];
  const addHealth = (): void => {
    if (!readiness.manageRolesReady) blockers.push('Knight requires the Discord Manage Roles permission.');
    if (!readiness.profileReady) blockers.push('At least one enabled Staff Profile must map to a live Discord role.');
    if (readiness.blockingRoleIds.length > 0) blockers.push('Knight must be above every enabled Staff Profile role in the Discord hierarchy.');
  };
  const addStaff = (): void => {
    if (!readiness.profileReady) blockers.push('At least one enabled Staff Profile must map to a live Discord role.');
  };
  const addPolicies = (): void => {
    if (!readiness.policiesReady) blockers.push('Every enabled Staff Profile must have current saved action policies.');
  };
  const addLogging = (): void => {
    if (!readiness.loggingReady) blockers.push('Save logging settings before continuing; Disabled is a valid explicit choice.');
  };
  const addProtection = (): void => {
    if (!readiness.protectionReady) blockers.push('Save firewall protection settings before continuing; Observe is a valid explicit choice.');
  };
  const addBackups = (): void => {
    if (!readiness.backupsReady) blockers.push('Save an explicit backup policy before continuing; Disabled is valid.');
  };

  if (step === 'HEALTH') addHealth();
  else if (step === 'STAFF') addStaff();
  else if (step === 'POLICIES') addPolicies();
  else if (step === 'LOGGING') addLogging();
  else if (step === 'PROTECTION') addProtection();
  else if (step === 'BACKUPS') addBackups();
  else if (step === 'OBSERVE') {
    addHealth(); addStaff(); addPolicies(); addLogging(); addProtection(); addBackups();
  }
  return [...new Set(blockers)];
}
export class SetupService {
  public constructor(private readonly dependencies: SetupDependencies) {}

  private async requireConfigurationAvailable(guildId: string): Promise<void> {
    const state = await this.dependencies.security.getSecurityState(guildId);
    const scopedLock = state.lockedScopes.some((scope) =>
      ['SECURITY_CONFIG', 'FULL'].includes(scope),
    );
    if (state.mode === 'PANIC' || (state.mode === 'LOCKDOWN' && scopedLock)) {
      throw new SetupError(
        'EMERGENCY_STATE_BLOCKED',
        'The current emergency state blocks setup configuration changes.',
      );
    }
  }

  private async requireAccess(guildId: string, actorUserId: string) {
    const guild = await this.dependencies.guilds.get(guildId);
    if (guild === null) {
      throw new SetupError('GUILD_NOT_CONFIGURED', 'Knight is not configured for this guild.');
    }
    if (guild.ownerId === actorUserId) return guild;
    if (await this.dependencies.managers.isSecurityManager(guildId, actorUserId)) return guild;
    throw new SetupError(
      'SETUP_ACCESS_DENIED',
      'Only the guild owner or a Knight Security Manager may continue setup.',
    );
  }

  public async getState(guildId: string, actorUserId: string): Promise<SetupStateView> {
    const guild = await this.requireAccess(guildId, actorUserId);
    const [setup, managers, profiles, discordGuild, logging, firewall, protectedResources, backupPolicy] =
      await Promise.all([
        this.dependencies.guilds.getSetupState(guildId),
        this.dependencies.managers.listSecurityManagers(guildId),
        this.dependencies.staff.listProfiles(guildId),
        this.dependencies.discord.getGuildState(guildId),
        this.dependencies.securityLedger.getLoggingSettings(guildId),
        this.dependencies.security.getFirewallSettings(guildId),
        this.dependencies.security.listProtectedResources(guildId),
        this.dependencies.backups.getPolicy(guildId),
      ]);
    if (setup === null) {
      throw new SetupError('SETUP_STATE_MISSING', 'Knight setup state is unavailable for this guild.');
    }

    const roleById = new Map(discordGuild.roles.map((role) => [role.roleId, role]));
    const activeProfiles = profiles.filter((profile) => profile.enabled);
    const missingRoleIds = activeProfiles
      .filter((profile) => !roleById.has(profile.discordRoleId))
      .map((profile) => profile.discordRoleId);
    const blockingRoleIds = activeProfiles
      .filter((profile) => {
        const role = roleById.get(profile.discordRoleId);
        return role !== undefined && role.position >= discordGuild.knightRolePosition;
      })
      .map((profile) => profile.discordRoleId);
    const manageRolesReady = hasPermission(discordGuild.knightPermissions, PermissionFlagsBits.ManageRoles);
    const profileReady = activeProfiles.length > 0 && missingRoleIds.length === 0;
    const currentVersions = await Promise.all(
      activeProfiles.map((profile) => this.dependencies.staff.getCurrentProfileVersion(guildId, profile.id)),
    );
    const policiesReady = activeProfiles.length > 0 && currentVersions.every((version) => version !== null);
    const readiness: ReadinessSnapshot = {
      manageRolesReady,
      profileReady,
      policiesReady,
      hierarchyHealthy: manageRolesReady && profileReady && blockingRoleIds.length === 0,
      blockingRoleIds: [...missingRoleIds, ...blockingRoleIds],
      loggingReady: logging !== null,
      protectionReady: firewall.configured,
      backupsReady: backupPolicy !== null,
      protectedResourceCount: protectedResources.length,
    };
    const currentStepBlockers = stepBlockers(setup.step, readiness);

    return {
      mode: guild.mode,
      step: setup.step,
      completedSteps: setup.completedSteps,
      profileCount: activeProfiles.length,
      profileReady,
      securityManagerCount: managers.length,
      securityManagerIds: managers.map((manager) => manager.userId),
      manageRolesReady,
      hierarchyHealthy: readiness.hierarchyHealthy,
      blockingRoleIds: readiness.blockingRoleIds,
      currentStepReady: currentStepBlockers.length === 0,
      currentStepBlockers,
      protectedResourceCount: readiness.protectedResourceCount,
      nextAction: nextAction(setup.step),
    };
  }

  public async advanceStep(guildId: string, actorUserId: string): Promise<void> {
    await this.requireAccess(guildId, actorUserId);
    await this.requireConfigurationAvailable(guildId);
    const state = await this.getState(guildId, actorUserId);
    const index = SETUP_STEPS.indexOf(state.step);
    const next = SETUP_STEPS[index + 1];
    if (index < 0) {
      throw new SetupError('SETUP_STATE_INVALID', 'Knight setup state contains an unknown step.');
    }
    if (next === undefined) {
      throw new SetupError('SETUP_ALREADY_COMPLETE', 'Knight setup is already complete.');
    }
    if (!state.currentStepReady) {
      throw new SetupError('SETUP_STEP_BLOCKED', state.currentStepBlockers.join(' '));
    }
    const completed = [...new Set<SetupStep>([...state.completedSteps, state.step])];
    await this.dependencies.guilds.updateSetupState(guildId, next, completed);
  }

  public async transitionMode(input: {
    guildId: string;
    actorUserId: string;
    targetMode: GuildMode;
  }): Promise<void> {
    const guild = await this.requireAccess(input.guildId, input.actorUserId);
    await this.requireConfigurationAvailable(input.guildId);
    if (input.targetMode === GuildMode.Guarded) {
      throw new SetupError(
        'GUARDED_MIGRATION_REQUIRED',
        'Guarded mode must be enabled through the Guarded migration workflow.',
      );
    }
    if (guild.mode === GuildMode.Guarded && input.targetMode === GuildMode.Test) {
      throw new SetupError(
        'GUARDED_ROLLBACK_REQUIRED',
        'Guarded mode must return to Test through the rollback workflow.',
      );
    }

    const legal =
      (guild.mode === GuildMode.Observe && input.targetMode === GuildMode.Test) ||
      (guild.mode === GuildMode.Test && input.targetMode === GuildMode.Observe);
    if (!legal) {
      throw new SetupError(
        'INVALID_MODE_TRANSITION',
        'That Knight mode transition is not allowed.',
      );
    }
    if (guild.mode === GuildMode.Observe && input.targetMode === GuildMode.Test) {
      const setup = await this.dependencies.guilds.getSetupState(input.guildId);
      if (setup?.step !== 'COMPLETE') {
        throw new SetupError(
          'SETUP_COMPLETE_REQUIRED',
          'Complete every setup step before entering Test mode.',
        );
      }
    }
    await this.dependencies.guilds.setMode(input.guildId, input.targetMode);
  }
}
