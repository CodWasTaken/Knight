import { ACTION_IDS, type ActionId, type ActionPolicies } from '@knight/contracts';
import { wouldIncreaseOwnAuthority, type AuthoritySnapshot } from '@knight/security';
import { z } from 'zod';

export type StaffProfileVersion = Readonly<{
  id: string;
  guildId: string;
  profileId: string;
  version: number;
  permissions: readonly ActionId[];
  actionPolicies: ActionPolicies;
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
  banWindows: z
    .array(z.object({ max: z.number().int().positive(), windowMs: z.number().int().positive() }))
    .max(3),
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

function parseInput(input: unknown): z.infer<typeof UpdatePolicySchema> {
  const parsed = UpdatePolicySchema.safeParse(input);
  if (!parsed.success) {
    throw new StaffProfilePolicyError(
      'INVALID_INPUT',
      'The Staff Profile policy input is invalid.',
    );
  }
  return parsed.data;
}

function nextPolicy(
  current: StaffProfileVersion,
  input: z.infer<typeof UpdatePolicySchema>,
): StaffProfileVersion {
  const banEnabled = input.permissions.includes('member.ban');
  return {
    ...current,
    permissions: input.permissions,
    actionPolicies: {
      ...current.actionPolicies,
      'member.ban': {
        enabled: banEnabled,
        unlimited: banEnabled && input.banWindows.length === 0,
        rateWindows: input.banWindows,
      },
    },
  };
}

async function managerState(
  guildId: string,
  actorUserId: string,
  dependencies: StaffProfilePolicyDependencies,
): Promise<{ isOwner: boolean; actorProfile: StaffProfileVersion | null }> {
  const guild = await dependencies.guilds.get(guildId);
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
