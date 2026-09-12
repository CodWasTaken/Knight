import type { ActionId, ActionPolicies } from '@knight/contracts';
import type { StaffProfileRecord, StaffProfileVersionRecord } from '@knight/database';
import type { DiscordActionPort, DiscordMemberState } from '@knight/discord';
import { wouldIncreaseOwnAuthority, type AuthoritySnapshot } from '@knight/security';
import type { SecurityRecorder } from '../security/security-recorder.js';

export type AssignmentSyncStatus = 'PENDING' | 'SYNCED' | 'NEEDS_REPAIR';

export type ActiveStaffAssignment = Readonly<{
  id: string;
  guildId: string;
  userId: string;
  profileId: string;
  profileName: string;
  discordRoleId: string;
  profileRank: number;
  syncStatus: string;
}>;

export interface RoleSyncStaffPort {
  createProfileWithInitialVersion(input: {
    guildId: string;
    name: string;
    discordRoleId: string;
    rank: number;
    permissions: readonly ActionId[];
    actionPolicies: ActionPolicies;
    createdBy: string;
  }): Promise<{ profile: { id: string }; version: { id: string } }>;
  getCurrentProfileVersion(
    guildId: string,
    profileId: string,
  ): Promise<StaffProfileVersionRecord | null>;
  getEffectiveProfile(guildId: string, userId: string): Promise<StaffProfileVersionRecord | null>;
  getActiveAssignment(guildId: string, userId: string): Promise<ActiveStaffAssignment | null>;
  assign(input: {
    guildId: string;
    userId: string;
    profileId: string;
    actorUserId: string;
  }): Promise<{ id: string }>;
  deactivateAssignment(input: { guildId: string; userId: string }): Promise<{ id: string } | null>;
  setAssignmentSyncStatus(
    guildId: string,
    assignmentId: string,
    status: AssignmentSyncStatus,
  ): Promise<void>;
  listProfiles(guildId: string): Promise<StaffProfileRecord[]>;
}

export type RoleSyncDependencies = Readonly<{
  guilds: { get(guildId: string): Promise<{ ownerId: string } | null> };
  managers: { isSecurityManager(guildId: string, userId: string): Promise<boolean> };
  security: {
    getSecurityState(guildId: string): Promise<{
      mode: 'NORMAL' | 'LOCKDOWN' | 'PANIC';
      lockedScopes: readonly string[];
    }>;
  };
  staff: RoleSyncStaffPort;
  securityRecorder: Pick<SecurityRecorder, 'record'>;
  discord: Pick<DiscordActionPort, 'addRole' | 'removeRole' | 'getMemberState'>;
}>;
export class StaffManagementError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StaffManagementError';
  }
}

export type StaffInspection = Readonly<{
  assignment: ActiveStaffAssignment | null;
  authoritative: boolean;
  discordRoleIds: readonly string[];
  mappedRoleIds: readonly string[];
  member: DiscordMemberState | null;
}>;

function requireProfileState(
  profile: StaffProfileVersionRecord | null,
  code = 'PROFILE_NOT_FOUND',
): StaffProfileVersionRecord & { rank: number; discordRoleId: string } {
  if (profile === null || profile.rank === undefined || profile.discordRoleId === undefined) {
    throw new StaffManagementError(
      code,
      'The requested Staff Profile is unavailable or incomplete.',
    );
  }
  return profile as StaffProfileVersionRecord & { rank: number; discordRoleId: string };
}
function toAuthority(profile: StaffProfileVersionRecord | null): AuthoritySnapshot {
  const complete = profile === null ? null : requireProfileState(profile, 'PROFILE_STATE_INVALID');
  return {
    rank: complete?.rank ?? 0,
    permissions: complete?.permissions ?? [],
    actionPolicies: complete?.actionPolicies ?? {},
    activeRestrictions: [],
  };
}

export class RoleSyncService {
  public constructor(private readonly dependencies: RoleSyncDependencies) {}

  private async requireConfigurationAvailable(guildId: string): Promise<void> {
    const state = await this.dependencies.security.getSecurityState(guildId);
    const scopedLock = state.lockedScopes.some((scope) =>
      ['ROLES', 'SECURITY_CONFIG', 'FULL'].includes(scope),
    );
    if (state.mode === 'PANIC' || (state.mode === 'LOCKDOWN' && scopedLock)) {
      throw new StaffManagementError(
        'EMERGENCY_STATE_BLOCKED',
        'The current emergency state blocks Staff Profile changes.',
      );
    }
  }

  private async recordConfig(
    action: string,
    guildId: string,
    actorUserId: string,
    targetId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.dependencies.securityRecorder.record(
        {
          guildId, severity: 'INFO', source: 'CONFIG', action, actorUserId, targetId,
          decisionId: null, incidentId: null, metadata,
        },
        'SECURITY',
      );
    } catch {
      // The staff change is already durable; logging failure must not fake a rollback.
    }
  }

  private async staffManagerState(
    guildId: string,
    actorUserId: string,
  ): Promise<{ isOwner: boolean; actorProfile: StaffProfileVersionRecord | null }> {
    const guild = await this.dependencies.guilds.get(guildId);
    if (guild === null) {
      throw new StaffManagementError(
        'GUILD_NOT_CONFIGURED',
        'Knight is not configured for this guild.',
      );
    }
    if (guild.ownerId === actorUserId) {
      return { isOwner: true, actorProfile: null };
    }
    const isManager = await this.dependencies.managers.isSecurityManager(guildId, actorUserId);
    if (!isManager) {
      throw new StaffManagementError(
        'STAFF_MANAGEMENT_DENIED',
        'Knight staff management access is denied.',
      );
    }
    const actorProfile = await this.dependencies.staff.getEffectiveProfile(guildId, actorUserId);
    return { isOwner: false, actorProfile };
  }

  private enforceGrantCeiling(
    actorUserId: string,
    actorProfile: StaffProfileVersionRecord | null,
    desiredProfile: StaffProfileVersionRecord,
  ): void {
    const desired = requireProfileState(desiredProfile);
    const actor =
      actorProfile === null ? null : requireProfileState(actorProfile, 'ACTOR_PROFILE_REQUIRED');
    if (actor === null || desired.rank >= actor.rank) {
      throw new StaffManagementError(
        'GRANT_CEILING',
        'The requested profile is at or above the actor grant ceiling.',
      );
    }

    if (
      wouldIncreaseOwnAuthority({
        actorUserId,
        affectedUserIds: [actorUserId],
        before: toAuthority(actor),
        after: toAuthority(desired),
      })
    ) {
      throw new StaffManagementError(
        'GRANT_CEILING',
        'The requested profile exceeds the actor effective authority.',
      );
    }
  }

  public async createProfile(input: {
    guildId: string;
    actorUserId: string;
    name: string;
    discordRoleId: string;
    rank: number;
  }): Promise<unknown> {
    await this.requireConfigurationAvailable(input.guildId);
    if (!Number.isInteger(input.rank) || input.rank < 0) {
      throw new StaffManagementError(
        'INVALID_RANK',
        'Staff Profile rank must be a non-negative integer.',
      );
    }
    const manager = await this.staffManagerState(input.guildId, input.actorUserId);
    if (!manager.isOwner) {
      const actor = requireProfileState(manager.actorProfile, 'ACTOR_PROFILE_REQUIRED');
      if (input.rank >= actor.rank) {
        throw new StaffManagementError(
          'GRANT_CEILING',
          'The new profile rank must be below the manager rank.',
        );
      }
    }

    const created = await this.dependencies.staff.createProfileWithInitialVersion({
      guildId: input.guildId,
      name: input.name,
      discordRoleId: input.discordRoleId,
      rank: input.rank,
      permissions: [],
      actionPolicies: {},
      createdBy: input.actorUserId,
    });
    await this.recordConfig('staff.profile.create', input.guildId, input.actorUserId, created.profile.id, {
      discordRoleId: input.discordRoleId,
      rank: input.rank,
    });
    return created;
  }

  public async assignByReference(input: {
    guildId: string;
    actorUserId: string;
    userId: string;
    profileReference: string;
  }): Promise<{ syncStatus: AssignmentSyncStatus }> {
    await this.requireConfigurationAvailable(input.guildId);
    await this.staffManagerState(input.guildId, input.actorUserId);
    const reference = input.profileReference.trim();
    const profiles = await this.dependencies.staff.listProfiles(input.guildId);
    let profile =
      profiles.find((candidate) => candidate.id === reference) ??
      profiles.find((candidate) => candidate.name === reference);
    if (profile === undefined) {
      const caseInsensitiveMatches = profiles.filter(
        (candidate) => candidate.name.toLowerCase() === reference.toLowerCase(),
      );
      if (caseInsensitiveMatches.length > 1) {
        throw new StaffManagementError(
          'PROFILE_REFERENCE_AMBIGUOUS',
          'Multiple Staff Profiles match that case-insensitive name.',
        );
      }
      profile = caseInsensitiveMatches[0];
    }
    if (profile === undefined) {
      throw new StaffManagementError(
        'PROFILE_NOT_FOUND',
        'The requested Staff Profile was not found.',
      );
    }

    return this.assign({
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      userId: input.userId,
      profileId: profile.id,
    });
  }

  public async assign(input: {
    guildId: string;
    actorUserId: string;
    userId: string;
    profileId: string;
  }): Promise<{ syncStatus: AssignmentSyncStatus }> {
    await this.requireConfigurationAvailable(input.guildId);
    const manager = await this.staffManagerState(input.guildId, input.actorUserId);
    const desired = requireProfileState(
      await this.dependencies.staff.getCurrentProfileVersion(input.guildId, input.profileId),
    );
    if (!manager.isOwner) {
      this.enforceGrantCeiling(input.actorUserId, manager.actorProfile, desired);
    }

    const previous = await this.dependencies.staff.getActiveAssignment(input.guildId, input.userId);
    const assignment = await this.dependencies.staff.assign({
      guildId: input.guildId,
      userId: input.userId,
      profileId: input.profileId,
      actorUserId: input.actorUserId,
    });

    try {
      await this.dependencies.discord.addRole({
        guildId: input.guildId,
        userId: input.userId,
        roleId: desired.discordRoleId,
        reason: `Knight Staff Profile assignment by ${input.actorUserId}`,
      });
      if (previous !== null && previous.discordRoleId !== desired.discordRoleId) {
        await this.dependencies.discord.removeRole({
          guildId: input.guildId,
          userId: input.userId,
          roleId: previous.discordRoleId,
          reason: `Knight Staff Profile replacement by ${input.actorUserId}`,
        });
      }
      await this.dependencies.staff.setAssignmentSyncStatus(input.guildId, assignment.id, 'SYNCED');
      await this.recordConfig('staff.assignment.assign', input.guildId, input.actorUserId, input.userId, {
        profileId: input.profileId, syncStatus: 'SYNCED',
      });
      return { syncStatus: 'SYNCED' };
    } catch {
      await this.dependencies.staff.setAssignmentSyncStatus(
        input.guildId,
        assignment.id,
        'NEEDS_REPAIR',
      );
      await this.recordConfig('staff.assignment.assign', input.guildId, input.actorUserId, input.userId, {
        profileId: input.profileId, syncStatus: 'NEEDS_REPAIR',
      });
      return { syncStatus: 'NEEDS_REPAIR' };
    }
  }
  public async remove(input: {
    guildId: string;
    actorUserId: string;
    userId: string;
  }): Promise<{ removed: boolean; syncStatus: AssignmentSyncStatus | null }> {
    await this.requireConfigurationAvailable(input.guildId);
    const manager = await this.staffManagerState(input.guildId, input.actorUserId);
    const assignment = await this.dependencies.staff.getActiveAssignment(
      input.guildId,
      input.userId,
    );
    if (assignment === null) return { removed: false, syncStatus: null };

    if (!manager.isOwner) {
      const actor = requireProfileState(manager.actorProfile, 'ACTOR_PROFILE_REQUIRED');
      if (assignment.profileRank >= actor.rank) {
        throw new StaffManagementError(
          'GRANT_CEILING',
          'You cannot remove staff at or above your Knight rank.',
        );
      }
    }

    const deactivated = await this.dependencies.staff.deactivateAssignment({
      guildId: input.guildId,
      userId: input.userId,
    });
    if (deactivated === null) return { removed: false, syncStatus: null };

    try {
      await this.dependencies.discord.removeRole({
        guildId: input.guildId,
        userId: input.userId,
        roleId: assignment.discordRoleId,
        reason: `Knight staff removal by ${input.actorUserId}`,
      });
      await this.dependencies.staff.setAssignmentSyncStatus(
        input.guildId,
        deactivated.id,
        'SYNCED',
      );
      await this.recordConfig('staff.assignment.remove', input.guildId, input.actorUserId, input.userId, {
        profileId: assignment.profileId, syncStatus: 'SYNCED',
      });
      return { removed: true, syncStatus: 'SYNCED' };
    } catch {
      await this.dependencies.staff.setAssignmentSyncStatus(
        input.guildId,
        deactivated.id,
        'NEEDS_REPAIR',
      );
      await this.recordConfig('staff.assignment.remove', input.guildId, input.actorUserId, input.userId, {
        profileId: assignment.profileId, syncStatus: 'NEEDS_REPAIR',
      });
      return { removed: true, syncStatus: 'NEEDS_REPAIR' };
    }
  }

  public async inspect(guildId: string, userId: string): Promise<StaffInspection> {
    const [assignment, profiles, member] = await Promise.all([
      this.dependencies.staff.getActiveAssignment(guildId, userId),
      this.dependencies.staff.listProfiles(guildId),
      this.dependencies.discord.getMemberState(guildId, userId),
    ]);
    const discordRoleIds = member?.roleIds ?? [];
    const mappedRoleIds = profiles
      .map((profile) => profile.discordRoleId)
      .filter((roleId) => discordRoleIds.includes(roleId));

    return {
      assignment,
      authoritative: assignment !== null,
      discordRoleIds,
      mappedRoleIds,
      member,
    };
  }
}
