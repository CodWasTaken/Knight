import { GuildMode } from '@knight/contracts';
import type { SecurityRecorder } from '../security/security-recorder.js';
import { PermissionFlagsBits } from 'discord-api-types/v10';

const GUARDED_NATIVE_PERMISSION_MASK =
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageMessages;
const MANAGE_ROLES = PermissionFlagsBits.ManageRoles;

export type GuardedRolePreview = Readonly<{
  profileIds: readonly string[];
  roleId: string;
  manageable: boolean;
  blockReason: string | null;
  beforePermissions: bigint;
  afterPermissions: bigint;
}>;

export type BanGuardPreview = Readonly<{
  blocked: boolean;
  staffCount: number;
  roles: readonly GuardedRolePreview[];
}>;

export type RolePermissionSnapshot = Readonly<{
  migrationId: string;
  roleId: string;
  permissions: string;
}>;
export interface GuardedMigrationDependencies {
  guilds: {
    get(guildId: string): Promise<{ id: string; ownerId: string; mode: GuildMode } | null>;
    saveRolePermissionSnapshot(input: {
      guildId: string;
      migrationId: string;
      roleId: string;
      permissions: string;
    }): Promise<void>;
    getLatestRolePermissionSnapshots(guildId: string): Promise<readonly RolePermissionSnapshot[]>;
    setGuardedBanState(
      guildId: string,
      enabled: boolean,
      mode: GuildMode,
      updatedBy: string,
    ): Promise<void>;
  };
  staff: {
    listProfiles(guildId: string): Promise<
      readonly {
        id: string;
        guildId: string;
        discordRoleId: string;
        rank: number;
        enabled: boolean;
      }[]
    >;
    getCurrentProfileVersion(
      guildId: string,
      profileId: string,
    ): Promise<{
      id: string;
      guildId: string;
      profileId: string;
      version: number;
      permissions: readonly string[];
      actionPolicies: object;
    } | null>;
    listActiveAssignmentsForProfile(
      guildId: string,
      profileId: string,
    ): Promise<readonly { userId: string }[]>;
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
    setRolePermissions(input: {
      guildId: string;
      roleId: string;
      permissions: bigint;
      reason: string;
    }): Promise<void>;
  };
  securityRecorder: Pick<SecurityRecorder, 'record'>;
  createMigrationId(): string;
}
export class GuardedMigrationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GuardedMigrationError';
  }
}

function hasPermission(value: bigint, permission: bigint): boolean {
  return (value & permission) === permission;
}

export class GuardedMigrationService {
  public constructor(private readonly dependencies: GuardedMigrationDependencies) {}

  private async requireGuild(guildId: string) {
    const guild = await this.dependencies.guilds.get(guildId);
    if (guild === null) {
      throw new GuardedMigrationError(
        'GUILD_NOT_CONFIGURED',
        'Knight is not configured for this guild.',
      );
    }
    return guild;
  }
  private requireOwner(guild: { ownerId: string }, actorUserId: string): void {
    if (guild.ownerId !== actorUserId) {
      throw new GuardedMigrationError(
        'OWNER_REQUIRED',
        'Only the Discord guild owner may change Guarded permissions.',
      );
    }
  }

  public async previewBanGuard(guildId: string): Promise<BanGuardPreview> {
    const guild = await this.requireGuild(guildId);
    if (guild.mode !== GuildMode.Test) {
      throw new GuardedMigrationError(
        'TEST_MODE_REQUIRED',
        'Knight must be in Test mode before Guarded permissions can be previewed.',
      );
    }

    const [profiles, discordGuild] = await Promise.all([
      this.dependencies.staff.listProfiles(guildId),
      this.dependencies.discord.getGuildState(guildId),
    ]);
    const affectedProfiles = [] as Array<{ id: string; roleId: string; staffCount: number }>;
    for (const profile of profiles) {
      if (!profile.enabled) continue;
      const role = discordGuild.roles.find((candidate) => candidate.roleId === profile.discordRoleId);
      if (role === undefined || (role.permissions & GUARDED_NATIVE_PERMISSION_MASK) === 0n) continue;
      const assignments = await this.dependencies.staff.listActiveAssignmentsForProfile(
        guildId,
        profile.id,
      );
      affectedProfiles.push({
        id: profile.id,
        roleId: profile.discordRoleId,
        staffCount: assignments.length,
      });
    }

    const byRole = new Map<string, { profileIds: string[]; staffCount: number }>();
    for (const profile of affectedProfiles) {
      const grouped = byRole.get(profile.roleId) ?? { profileIds: [], staffCount: 0 };
      grouped.profileIds.push(profile.id);
      grouped.staffCount += profile.staffCount;
      byRole.set(profile.roleId, grouped);
    }

    const canManageRoles = hasPermission(discordGuild.knightPermissions, MANAGE_ROLES);
    const roles: GuardedRolePreview[] = [];
    for (const [roleId, grouped] of byRole) {
      const role = discordGuild.roles.find((candidate) => candidate.roleId === roleId);
      const beforePermissions = role?.permissions ?? 0n;
      let blockReason: string | null = null;
      if (!canManageRoles) blockReason = 'KNIGHT_MANAGE_ROLES_REQUIRED';
      else if (role === undefined) blockReason = 'ROLE_NOT_FOUND';
      else if (role.position >= discordGuild.knightRolePosition)
        blockReason = 'ROLE_HIERARCHY_BLOCKED';

      roles.push({
        profileIds: grouped.profileIds,
        roleId,
        manageable: blockReason === null,
        blockReason,
        beforePermissions,
        afterPermissions: beforePermissions & ~GUARDED_NATIVE_PERMISSION_MASK,
      });
    }

    return {
      blocked: roles.some((role) => !role.manageable),
      staffCount: affectedProfiles.reduce((total, profile) => total + profile.staffCount, 0),
      roles,
    };
  }
  public async enableBanGuard(input: { guildId: string; actorUserId: string }): Promise<void> {
    const guild = await this.requireGuild(input.guildId);
    this.requireOwner(guild, input.actorUserId);
    if (guild.mode !== GuildMode.Test) {
      throw new GuardedMigrationError(
        'TEST_MODE_REQUIRED',
        'Knight must be in Test mode before Guarded permissions can be enabled.',
      );
    }

    const preview = await this.previewBanGuard(input.guildId);
    if (preview.roles.length === 0) {
      throw new GuardedMigrationError(
        'NO_AFFECTED_ROLES',
        'No enabled Staff Profile currently has guarded native moderation permissions to replace.',
      );
    }
    if (preview.blocked) {
      throw new GuardedMigrationError(
        'MIGRATION_BLOCKED',
        'Guarded permissions cannot be enabled until every affected role is manageable by Knight.',
      );
    }

    const migrationId = this.dependencies.createMigrationId();
    for (const role of preview.roles) {
      await this.dependencies.guilds.saveRolePermissionSnapshot({
        guildId: input.guildId,
        migrationId,
        roleId: role.roleId,
        permissions: role.beforePermissions.toString(),
      });
    }
    try {
      for (const role of preview.roles) {
        if (role.afterPermissions === role.beforePermissions) continue;
        await this.dependencies.discord.setRolePermissions({
          guildId: input.guildId,
          roleId: role.roleId,
          permissions: role.afterPermissions,
          reason: `Knight MODERATION Guarded migration ${migrationId}`,
        });
      }
    } catch {
      let compensationFailed = false;
      for (const role of preview.roles) {
        try {
          await this.dependencies.discord.setRolePermissions({
            guildId: input.guildId,
            roleId: role.roleId,
            permissions: role.beforePermissions,
            reason: `Knight MODERATION Guarded migration compensation ${migrationId}`,
          });
        } catch {
          compensationFailed = true;
        }
      }
      throw new GuardedMigrationError(
        compensationFailed ? 'MIGRATION_REPAIR_REQUIRED' : 'DISCORD_MIGRATION_FAILED',
        compensationFailed
          ? 'Guarded migration failed and Knight could not fully restore every snapshotted role.'
          : 'Guarded migration failed; Knight restored the snapshotted role permissions.',
      );
    }

    await this.dependencies.guilds.setGuardedBanState(
      input.guildId,
      true,
      GuildMode.Guarded,
      input.actorUserId,
    );
    try {
      await this.dependencies.securityRecorder.record(
        {
          guildId: input.guildId,
          severity: 'HIGH',
          source: 'SECURITY',
          action: 'guarded.enable',
          actorUserId: input.actorUserId,
          targetId: migrationId,
          decisionId: null,
          incidentId: null,
          metadata: { migrationId, roleCount: preview.roles.length, staffCount: preview.staffCount },
        },
        'SECURITY',
      );
    } catch {
      // Guarded state is already durable; do not pretend activation rolled back.
    }
  }

  public async rollbackBanGuard(input: { guildId: string; actorUserId: string }): Promise<void> {
    const guild = await this.requireGuild(input.guildId);
    this.requireOwner(guild, input.actorUserId);
    if (guild.mode !== GuildMode.Guarded) {
      throw new GuardedMigrationError(
        'GUARDED_MODE_REQUIRED',
        'Knight must be in Guarded mode to roll back Guarded permissions.',
      );
    }
    const snapshots = await this.dependencies.guilds.getLatestRolePermissionSnapshots(
      input.guildId,
    );
    if (snapshots.length === 0) {
      throw new GuardedMigrationError(
        'ROLLBACK_SNAPSHOT_MISSING',
        'Knight has no saved role-permission snapshot for the active Guarded migration.',
      );
    }

    for (const snapshot of snapshots) {
      await this.dependencies.discord.setRolePermissions({
        guildId: input.guildId,
        roleId: snapshot.roleId,
        permissions: BigInt(snapshot.permissions),
        reason: `Knight MODERATION Guarded rollback ${snapshot.migrationId}`,
      });
    }

    await this.dependencies.guilds.setGuardedBanState(
      input.guildId,
      false,
      GuildMode.Test,
      input.actorUserId,
    );
    try {
      await this.dependencies.securityRecorder.record(
        {
          guildId: input.guildId,
          severity: 'HIGH',
          source: 'SECURITY',
          action: 'guarded.rollback',
          actorUserId: input.actorUserId,
          targetId: snapshots[0]?.migrationId ?? null,
          decisionId: null,
          incidentId: null,
          metadata: { roleCount: snapshots.length },
        },
        'SECURITY',
      );
    } catch {
      // Rollback state is already durable; do not pretend it failed.
    }
  }
}
