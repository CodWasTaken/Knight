import {
  ACTION_IDS,
  GuildMode,
  RATE_LIMITED_MODERATION_ACTIONS,
  type ActionId,
  type ActionPolicies,
} from '@knight/contracts';
import type {
  StaffProfileRecord,
  StaffProfileVersionRecord,
} from '@knight/database';
import type { DiscordActionPort, DiscordGuildState } from '@knight/discord/port';
import { wouldIncreaseOwnAuthority, type AuthoritySnapshot } from '@knight/security';
import { z } from 'zod';

export type StaffProfileVersion = Readonly<{
  id: string;
  guildId: string;
  profileId: string;
  version: number;
  permissions: readonly ActionId[];
  actionPolicies: ActionPolicies;
  profileName?: string;
  rank?: number;
  discordRoleId?: string;
}>;

export type ActiveStaffAssignment = Readonly<{
  profileId: string;
}>;

export interface StaffProfilePolicyDependencies {
  guilds: { get(guildId: string): Promise<{ ownerId: string } | null> };
  managers: { isSecurityManager(guildId: string, userId: string): Promise<boolean> };
  staff: {
    getCurrentProfileVersion(
      guildId: string,
      profileId: string,
    ): Promise<StaffProfileVersion | null>;
    getEffectiveProfile(guildId: string, userId: string): Promise<StaffProfileVersion | null>;
    getActiveAssignment(guildId: string, userId: string): Promise<ActiveStaffAssignment | null>;
    createProfileVersion(input: {
      guildId: string;
      profileId: string;
      permissions: readonly ActionId[];
      actionPolicies: ActionPolicies;
      createdBy: string;
    }): Promise<StaffProfileVersion>;
  };
}

export interface StaffProfileDashboardDependencies extends StaffProfilePolicyDependencies {
  guilds: {
    get(guildId: string): Promise<{ ownerId: string; mode: GuildMode } | null>;
  };
  staff: StaffProfilePolicyDependencies['staff'] & {
    createProfileWithInitialVersion(input: {
      guildId: string;
      name: string;
      discordRoleId: string;
      rank: number;
      permissions: readonly ActionId[];
      actionPolicies: ActionPolicies;
      createdBy: string;
    }): Promise<{ profile: StaffProfileRecord; version: StaffProfileVersionRecord }>;
    updateProfileWithVersion(input: {
      guildId: string;
      profileId: string;
      name: string;
      discordRoleId: string;
      rank: number;
      permissions: readonly ActionId[];
      actionPolicies: ActionPolicies;
      createdBy: string;
    }): Promise<{ profile: StaffProfileRecord; version: StaffProfileVersionRecord }>;
    listActiveAssignmentsForProfile(
      guildId: string,
      profileId: string,
    ): Promise<readonly { id: string; userId: string }[]>;
    setAssignmentSyncStatus(
      guildId: string,
      assignmentId: string,
      status: 'SYNCED' | 'NEEDS_REPAIR',
    ): Promise<void>;
  };
  discord: Pick<DiscordActionPort, 'getGuildState' | 'addRole' | 'removeRole'>;
}

export type StaffProfileDashboardUpdateResult = Readonly<{
  profile: StaffProfileRecord;
  version: StaffProfileVersionRecord;
  syncStatus: 'NOT_REQUIRED' | 'SYNCED' | 'NEEDS_REPAIR';
  repairAssignmentIds: readonly string[];
}>;

export class StaffProfilePolicyError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StaffProfilePolicyError';
  }
}

const UpdatePolicySchema = z.object({
  guildId: z.string().min(1),
  profileId: z.string().uuid(),
  permissions: z.array(z.enum(ACTION_IDS)),
  actionPolicies: z.record(z.string(), z.unknown()),
});

const RateWindowInputSchema = z.object({
  max: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unit: z.enum(['minute', 'hour', 'day']),
});

const RatePolicyInputSchema = z.object({
  unlimited: z.boolean(),
  windows: z.array(z.unknown()),
});

const RATE_WINDOW_MULTIPLIERS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

const RATE_LIMITED_ACTION_SET = new Set<ActionId>(RATE_LIMITED_MODERATION_ACTIONS);

type ParsedPolicyInput = Readonly<{
  guildId: string;
  profileId: string;
  permissions: readonly ActionId[];
  actionPolicies: ActionPolicies;
}>;

const ProfileMetadataSchema = z.object({
  guildId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  discordRoleId: z.string().min(1),
  rank: z.number().int().nonnegative(),
});

const UpdateProfileMetadataSchema = ProfileMetadataSchema.extend({
  profileId: z.string().uuid(),
});

function toAuthority(profile: StaffProfileVersion): AuthoritySnapshot {
  if (profile.rank === undefined) {
    throw new StaffProfilePolicyError(
      'PROFILE_STATE_INVALID',
      'The Staff Profile hierarchy state is incomplete.',
    );
  }

  return {
    rank: profile.rank,
    permissions: profile.permissions,
    actionPolicies: profile.actionPolicies,
    activeRestrictions: [],
  };
}

function completeProfile(
  profile: StaffProfileVersion,
): StaffProfileVersion & { rank: number; discordRoleId: string } {
  if (profile.rank === undefined || profile.discordRoleId === undefined) {
    throw new StaffProfilePolicyError(
      'PROFILE_STATE_INVALID',
      'The Staff Profile metadata state is incomplete.',
    );
  }
  return profile as StaffProfileVersion & { rank: number; discordRoleId: string };
}

function invalidPolicyInput(): never {
  throw new StaffProfilePolicyError(
    'INVALID_INPUT',
    'The Staff Profile policy input is invalid.',
  );
}

function parseRateWindow(value: unknown): { max: number; windowMs: number } {
  const parsed = RateWindowInputSchema.safeParse(value);
  if (!parsed.success) return invalidPolicyInput();
  const multiplier = RATE_WINDOW_MULTIPLIERS[parsed.data.unit];
  const windowMs = parsed.data.amount * multiplier;
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) return invalidPolicyInput();
  return { max: parsed.data.max, windowMs };
}

function parseInput(input: unknown): ParsedPolicyInput {
  const parsed = UpdatePolicySchema.safeParse(input);
  if (!parsed.success) return invalidPolicyInput();

  const enabled = new Set<ActionId>(parsed.data.permissions);
  const actionPolicies: Partial<Record<ActionId, {
    enabled: boolean;
    unlimited: boolean;
    rateWindows: readonly { max: number; windowMs: number }[];
  }>> = {};

  for (const action of RATE_LIMITED_MODERATION_ACTIONS) {
    if (!enabled.has(action)) {
      actionPolicies[action] = { enabled: false, unlimited: false, rateWindows: [] };
      continue;
    }

    const policy = RatePolicyInputSchema.safeParse(parsed.data.actionPolicies[action]);
    if (!policy.success) return invalidPolicyInput();
    if (policy.data.unlimited) {
      actionPolicies[action] = { enabled: true, unlimited: true, rateWindows: [] };
      continue;
    }
    if (policy.data.windows.length < 1 || policy.data.windows.length > 3) {
      return invalidPolicyInput();
    }
    actionPolicies[action] = {
      enabled: true,
      unlimited: false,
      rateWindows: policy.data.windows.map(parseRateWindow),
    };
  }

  return {
    guildId: parsed.data.guildId,
    profileId: parsed.data.profileId,
    permissions: parsed.data.permissions,
    actionPolicies,
  };
}

function parseMetadataInput(input: unknown): z.infer<typeof ProfileMetadataSchema> {
  const parsed = ProfileMetadataSchema.safeParse(input);
  if (!parsed.success) {
    throw new StaffProfilePolicyError('INVALID_INPUT', 'The Staff Profile metadata is invalid.');
  }
  return parsed.data;
}

function parseMetadataUpdate(input: unknown): z.infer<typeof UpdateProfileMetadataSchema> {
  const parsed = UpdateProfileMetadataSchema.safeParse(input);
  if (!parsed.success) {
    throw new StaffProfilePolicyError('INVALID_INPUT', 'The Staff Profile metadata is invalid.');
  }
  return parsed.data;
}

function nextPolicy(
  current: StaffProfileVersion,
  input: ParsedPolicyInput,
): StaffProfileVersion {
  const preservedPolicies = Object.fromEntries(
    Object.entries(current.actionPolicies).filter(
      ([action]) =>
        !RATE_LIMITED_ACTION_SET.has(action as ActionId) && action !== 'member.warnings.view',
    ),
  ) as ActionPolicies;

  return {
    ...current,
    permissions: input.permissions,
    actionPolicies: {
      ...preservedPolicies,
      ...input.actionPolicies,
    },
  };
}

type ManagerState = Readonly<{
  isOwner: boolean;
  actorProfile: StaffProfileVersion | null;
}>;

async function managerState(
  guildId: string,
  actorUserId: string,
  dependencies: StaffProfilePolicyDependencies,
  knownGuild?: Readonly<{ ownerId: string }>,
): Promise<ManagerState> {
  const guild = knownGuild ?? (await dependencies.guilds.get(guildId));
  if (guild === null) {
    throw new StaffProfilePolicyError(
      'GUILD_NOT_CONFIGURED',
      'Knight is not configured for this guild.',
    );
  }
  if (guild.ownerId === actorUserId) return { isOwner: true, actorProfile: null };

  const isManager = await dependencies.managers.isSecurityManager(guildId, actorUserId);
  if (!isManager) {
    throw new StaffProfilePolicyError(
      'STAFF_MANAGEMENT_DENIED',
      'Knight Staff Profile management access is denied.',
    );
  }

  return {
    isOwner: false,
    actorProfile: await dependencies.staff.getEffectiveProfile(guildId, actorUserId),
  };
}

function requireActorProfile(profile: StaffProfileVersion | null): StaffProfileVersion & { rank: number } {
  if (profile === null || profile.rank === undefined) {
    throw new StaffProfilePolicyError(
      'ACTOR_PROFILE_REQUIRED',
      'A Security Manager must have an active Staff Profile to manage staff authority.',
    );
  }
  return profile as StaffProfileVersion & { rank: number };
}

function exceedsGrantCeiling(
  actorUserId: string,
  actorProfile: StaffProfileVersion,
  desired: StaffProfileVersion,
): boolean {
  return wouldIncreaseOwnAuthority({
    actorUserId,
    affectedUserIds: [actorUserId],
    before: toAuthority(actorProfile),
    after: toAuthority(desired),
  });
}

async function requireDashboardGuild(
  guildId: string,
  dependencies: StaffProfileDashboardDependencies,
): Promise<{ ownerId: string; mode: GuildMode }> {
  const guild = await dependencies.guilds.get(guildId);
  if (guild === null) {
    throw new StaffProfilePolicyError(
      'GUILD_NOT_CONFIGURED',
      'Knight is not configured for this guild.',
    );
  }
  return guild;
}

function requireManageableRole(
  guildId: string,
  roleId: string,
  state: DiscordGuildState,
): void {
  if (state.guildId !== guildId) {
    throw new StaffProfilePolicyError(
      'DISCORD_GUILD_MISMATCH',
      'Discord returned role state for a different guild.',
    );
  }
  const role = state.roles.find((candidate) => candidate.roleId === roleId);
  if (role === undefined) {
    throw new StaffProfilePolicyError(
      'ROLE_NOT_FOUND',
      'The selected Discord role does not exist in this guild.',
    );
  }
  if (role.roleId === guildId || role.managed || role.position >= state.knightRolePosition) {
    throw new StaffProfilePolicyError(
      'ROLE_NOT_MANAGEABLE',
      'The selected Discord role cannot be safely managed by Knight.',
    );
  }
}

async function validateRole(
  guildId: string,
  roleId: string,
  dependencies: StaffProfileDashboardDependencies,
): Promise<void> {
  const state = await dependencies.discord.getGuildState(guildId);
  requireManageableRole(guildId, roleId, state);
}

export async function createStaffProfileFromDashboard(
  rawInput: unknown,
  actor: Readonly<{ userId: string }>,
  dependencies: StaffProfileDashboardDependencies,
): Promise<{ profile: StaffProfileRecord; version: StaffProfileVersionRecord }> {
  const input = parseMetadataInput(rawInput);
  const guild = await requireDashboardGuild(input.guildId, dependencies);
  const manager = await managerState(input.guildId, actor.userId, dependencies, guild);
  if (guild.mode === GuildMode.Guarded) {
    throw new StaffProfilePolicyError(
      'GUARDED_PROFILE_MAPPING_LOCKED',
      'Staff Profile role mappings cannot be created while the guild is Guarded.',
    );
  }

  if (!manager.isOwner) {
    const actorProfile = requireActorProfile(manager.actorProfile);
    if (input.rank >= actorProfile.rank) {
      throw new StaffProfilePolicyError(
        'GRANT_CEILING',
        'The new Staff Profile rank must remain below the manager rank.',
      );
    }
  }

  await validateRole(input.guildId, input.discordRoleId, dependencies);
  return dependencies.staff.createProfileWithInitialVersion({
    ...input,
    permissions: [],
    actionPolicies: {},
    createdBy: actor.userId,
  });
}

export async function updateStaffProfileFromDashboard(
  rawInput: unknown,
  actor: Readonly<{ userId: string }>,
  dependencies: StaffProfileDashboardDependencies,
): Promise<StaffProfileDashboardUpdateResult> {
  const input = parseMetadataUpdate(rawInput);
  const guild = await requireDashboardGuild(input.guildId, dependencies);
  const manager = await managerState(input.guildId, actor.userId, dependencies, guild);
  const currentRaw = await dependencies.staff.getCurrentProfileVersion(
    input.guildId,
    input.profileId,
  );
  if (currentRaw === null) {
    throw new StaffProfilePolicyError(
      'PROFILE_NOT_FOUND',
      'The requested Staff Profile was not found in this guild.',
    );
  }
  const current = completeProfile(currentRaw);
  const roleChanged = current.discordRoleId !== input.discordRoleId;

  if (guild.mode === GuildMode.Guarded && roleChanged) {
    throw new StaffProfilePolicyError(
      'GUARDED_PROFILE_MAPPING_LOCKED',
      'Mapped Discord roles cannot be changed while the guild is Guarded.',
    );
  }

  if (!manager.isOwner) {
    const actorProfile = requireActorProfile(manager.actorProfile);
    const assignment = await dependencies.staff.getActiveAssignment(input.guildId, actor.userId);
    const editsOwnProfile = assignment?.profileId === input.profileId;
    const desired: StaffProfileVersion = { ...current, rank: input.rank };

    if (
      editsOwnProfile &&
      wouldIncreaseOwnAuthority({
        actorUserId: actor.userId,
        affectedUserIds: [actor.userId],
        before: toAuthority(current),
        after: toAuthority(desired),
      })
    ) {
      throw new StaffProfilePolicyError(
        'SELF_ESCALATION_DENIED',
        'A Security Manager cannot increase authority through a profile that governs them.',
      );
    }

    if (
      !editsOwnProfile &&
      (current.rank >= actorProfile.rank ||
        input.rank >= actorProfile.rank ||
        exceedsGrantCeiling(actor.userId, actorProfile, desired))
    ) {
      throw new StaffProfilePolicyError(
        'GRANT_CEILING',
        'The requested Staff Profile metadata exceeds the manager grant ceiling.',
      );
    }
  }

  await validateRole(input.guildId, input.discordRoleId, dependencies);
  const assignments = roleChanged
    ? await dependencies.staff.listActiveAssignmentsForProfile(input.guildId, input.profileId)
    : [];

  const updated = await dependencies.staff.updateProfileWithVersion({
    ...input,
    permissions: current.permissions,
    actionPolicies: current.actionPolicies,
    createdBy: actor.userId,
  });

  if (!roleChanged) {
    return { ...updated, syncStatus: 'NOT_REQUIRED', repairAssignmentIds: [] };
  }

  const repairAssignmentIds: string[] = [];
  for (const assignment of assignments) {
    try {
      await dependencies.discord.addRole({
        guildId: input.guildId,
        userId: assignment.userId,
        roleId: input.discordRoleId,
        reason: `Knight Staff Profile remap by ${actor.userId}`,
      });
      await dependencies.discord.removeRole({
        guildId: input.guildId,
        userId: assignment.userId,
        roleId: current.discordRoleId,
        reason: `Knight Staff Profile remap by ${actor.userId}`,
      });
      await dependencies.staff.setAssignmentSyncStatus(input.guildId, assignment.id, 'SYNCED');
    } catch {
      repairAssignmentIds.push(assignment.id);
      await dependencies.staff.setAssignmentSyncStatus(
        input.guildId,
        assignment.id,
        'NEEDS_REPAIR',
      );
    }
  }

  return {
    ...updated,
    syncStatus: repairAssignmentIds.length === 0 ? 'SYNCED' : 'NEEDS_REPAIR',
    repairAssignmentIds,
  };
}

export async function updateStaffProfilePolicy(
  rawInput: unknown,
  actor: Readonly<{ userId: string }>,
  dependencies: StaffProfilePolicyDependencies,
): Promise<StaffProfileVersion> {
  const input = parseInput(rawInput);
  const manager = await managerState(input.guildId, actor.userId, dependencies);
  const current = await dependencies.staff.getCurrentProfileVersion(input.guildId, input.profileId);
  if (current === null) {
    throw new StaffProfilePolicyError(
      'PROFILE_NOT_FOUND',
      'The requested Staff Profile was not found in this guild.',
    );
  }

  const desired = nextPolicy(current, input);
  if (!manager.isOwner) {
    const assignment = await dependencies.staff.getActiveAssignment(input.guildId, actor.userId);
    const editsOwnProfile = assignment?.profileId === input.profileId;
    if (
      editsOwnProfile &&
      wouldIncreaseOwnAuthority({
        actorUserId: actor.userId,
        affectedUserIds: [actor.userId],
        before: toAuthority(current),
        after: toAuthority(desired),
      })
    ) {
      throw new StaffProfilePolicyError(
        'SELF_ESCALATION_DENIED',
        'A Security Manager cannot increase authority through a profile that governs them.',
      );
    }

    if (!editsOwnProfile) {
      const actorProfile = manager.actorProfile;
      if (actorProfile === null) {
        throw new StaffProfilePolicyError(
          'ACTOR_PROFILE_REQUIRED',
          'A Security Manager must have an active Staff Profile to edit staff authority.',
        );
      }
      const actorAuthority = toAuthority(actorProfile);
      const desiredAuthority = toAuthority(desired);
      if (
        desiredAuthority.rank >= actorAuthority.rank ||
        exceedsGrantCeiling(actor.userId, actorProfile, desired)
      ) {
        throw new StaffProfilePolicyError(
          'GRANT_CEILING',
          'The requested Staff Profile policy exceeds the manager grant ceiling.',
        );
      }
    }
  }

  return dependencies.staff.createProfileVersion({
    guildId: input.guildId,
    profileId: input.profileId,
    permissions: input.permissions,
    actionPolicies: desired.actionPolicies,
    createdBy: actor.userId,
  });
}
