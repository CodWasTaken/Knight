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
  };
  securityLedger: {
    getLoggingSettings(guildId: string): Promise<unknown | null>;
  };
  security: {
    getFirewallSettings(guildId: string): Promise<{ configured: boolean }>;
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
export class SetupService {
  public constructor(private readonly dependencies: SetupDependencies) {}

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
    const [setup, managers, profiles, discordGuild] = await Promise.all([
      this.dependencies.guilds.getSetupState(guildId),
      this.dependencies.managers.listSecurityManagers(guildId),
      this.dependencies.staff.listProfiles(guildId),
      this.dependencies.discord.getGuildState(guildId),
    ]);
    if (setup === null) {
      throw new SetupError(
        'SETUP_STATE_MISSING',
        'Knight setup state is unavailable for this guild.',
      );
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
    const manageRolesReady = hasPermission(
      discordGuild.knightPermissions,
      PermissionFlagsBits.ManageRoles,
    );
    const profileReady = activeProfiles.length > 0 && missingRoleIds.length === 0;

    return {
      mode: guild.mode,
      step: setup.step,
      completedSteps: setup.completedSteps,
      profileCount: activeProfiles.length,
      profileReady,
      securityManagerCount: managers.length,
      securityManagerIds: managers.map((manager) => manager.userId),
      manageRolesReady,
      hierarchyHealthy: manageRolesReady && profileReady && blockingRoleIds.length === 0,
      blockingRoleIds: [...missingRoleIds, ...blockingRoleIds],
      nextAction: nextAction(setup.step),
    };
  }

  public async advanceStep(guildId: string, actorUserId: string): Promise<void> {
    await this.requireAccess(guildId, actorUserId);
    const setup = await this.dependencies.guilds.getSetupState(guildId);
    if (setup === null) {
      throw new SetupError(
        'SETUP_STATE_MISSING',
        'Knight setup state is unavailable for this guild.',
      );
    }
    const index = SETUP_STEPS.indexOf(setup.step);
    const next = SETUP_STEPS[index + 1];
    if (index < 0) {
      throw new SetupError('SETUP_STATE_INVALID', 'Knight setup state contains an unknown step.');
    }
    if (next === undefined) {
      throw new SetupError('SETUP_ALREADY_COMPLETE', 'Knight setup is already complete.');
    }
    if (
      setup.step === 'LOGGING' &&
      (await this.dependencies.securityLedger.getLoggingSettings(guildId)) === null
    ) {
      throw new SetupError(
        'LOGGING_NOT_CONFIGURED',
        'Configure logging destinations before continuing. Choosing Disabled is valid.',
      );
    }
    if (
      setup.step === 'PROTECTION' &&
      !(await this.dependencies.security.getFirewallSettings(guildId)).configured
    ) {
      throw new SetupError(
        'PROTECTION_NOT_CONFIGURED',
        'Save the bot and webhook firewall modes before continuing. Observe is valid.',
      );
    }
    const completed = [...new Set<SetupStep>([...setup.completedSteps, setup.step])];
    await this.dependencies.guilds.updateSetupState(guildId, next, completed);
  }
  public async transitionMode(input: {
    guildId: string;
    actorUserId: string;
    targetMode: GuildMode;
  }): Promise<void> {
    const guild = await this.requireAccess(input.guildId, input.actorUserId);
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
    await this.dependencies.guilds.setMode(input.guildId, input.targetMode);
  }
}
