import type { ActionPolicy, SecurityDecision, StaffProfileSnapshot } from '@knight/contracts';
import { PolicyDecision, ProtectionLevel } from '@knight/contracts';
import type { StaffProfileVersionRecord, StaffRepository } from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';
import type { ExecutionCorrelationStore } from '@knight/redis';
import type {
  authorizeGuardedAction,
  DecisionLogPort,
  GuardedActionPorts,
  GuardedActionRequest,
  RateLimitPort,
  StaffStatePort,
} from '@knight/security';
import { PermissionsBitField } from 'discord.js';

const DISABLED_POLICY: ActionPolicy = {
  enabled: false,
  unlimited: false,
  rateWindows: [],
};

const OWNER_POLICY: ActionPolicy = {
  enabled: true,
  unlimited: true,
  rateWindows: [],
};

const ELEVATED_DISCORD_PERMISSION_MASK = [
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ModerateMembers,
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.ViewAuditLog,
].reduce((mask, permission) => mask | permission, 0n);

export type MemberBanCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
  targetUserId: string;
  knightBotUserId: string;
  reason: string;
  nowMs: number;
}>;

export type MemberBanCommandDependencies = Readonly<{
  authorize: typeof authorizeGuardedAction;
  staffProfiles: Pick<StaffRepository, 'getEffectiveProfile'>;
  rateLimits: RateLimitPort;
  decisions: DecisionLogPort;
  correlations: Pick<ExecutionCorrelationStore, 'create'>;
  discord: Pick<DiscordActionPort, 'getGuildState' | 'getMemberState' | 'banMember'>;
  createCorrelationId: () => string;
}>;

export type MemberBanCommandResult = Readonly<{
  executed: boolean;
  content: string;
}>;

function toProfileSnapshot(
  guildId: string,
  profile: StaffProfileVersionRecord | null,
): StaffProfileSnapshot | null {
  if (profile === null) return null;
  if (
    profile.guildId !== guildId ||
    profile.discordRoleId === undefined ||
    profile.rank === undefined
  ) {
    throw new Error('Incomplete or cross-guild Staff Profile state');
  }

  return {
    guildId,
    profileId: profile.profileId,
    profileVersionId: profile.id,
    discordRoleId: profile.discordRoleId,
    rank: profile.rank,
    permissions: profile.permissions,
    actionPolicies: profile.actionPolicies,
  };
}

function hasElevatedDiscordAuthority(permissions: bigint): boolean {
  return (permissions & ELEVATED_DISCORD_PERMISSION_MASK) !== 0n;
}

function createStaffStatePort(dependencies: MemberBanCommandDependencies): StaffStatePort {
  return {
    async getContext(request) {
      const guild = await dependencies.discord.getGuildState(request.guildId);
      const [actorProfileRecord, targetProfileRecord, targetDiscord] = await Promise.all([
        dependencies.staffProfiles.getEffectiveProfile(request.guildId, request.actorUserId),
        dependencies.staffProfiles.getEffectiveProfile(request.guildId, request.targetId),
        dependencies.discord.getMemberState(request.guildId, request.targetId),
      ]);

      const actorProfile = toProfileSnapshot(request.guildId, actorProfileRecord);
      const targetProfile = toProfileSnapshot(request.guildId, targetProfileRecord);
      const actorIsOwner = guild.ownerId === request.actorUserId;
      const targetIsOwner = guild.ownerId === request.targetId;
      const elevatedUnregistered =
        targetProfile === null &&
        targetDiscord !== null &&
        hasElevatedDiscordAuthority(targetDiscord.permissions);
      const actionPolicy = actorIsOwner
        ? OWNER_POLICY
        : (actorProfile?.actionPolicies[request.action] ?? DISABLED_POLICY);

      return {
        action: request.action,
        actor: {
          userId: request.actorUserId,
          isGuildOwner: actorIsOwner,
          profile: actorProfile,
          temporaryGrants: [],
          temporaryRestrictions: [],
        },
        target: {
          userId: request.targetId,
          isGuildOwner: targetIsOwner,
          knightRank: targetProfile?.rank ?? null,
          elevatedUnregistered,
          protectionLevel: ProtectionLevel.Normal,
        },
        emergency: { memberModerationLocked: false },
        actionPolicy,
      };
    },
  };
}

function formatRateLimitDecision(decision: SecurityDecision, nowMs: number): string | null {
  const rate = decision.metadata.rate;
  if (typeof rate !== 'object' || rate === null || !('windows' in rate)) return null;
  const windows = (rate as { windows?: unknown }).windows;
  if (!Array.isArray(windows) || windows.length === 0) return null;

  const window =
    windows.find((candidate) => {
      if (typeof candidate !== 'object' || candidate === null) return false;
      const value = candidate as { used?: unknown; max?: unknown };
      return (
        typeof value.used === 'number' && typeof value.max === 'number' && value.used >= value.max
      );
    }) ?? windows[0];
  if (typeof window !== 'object' || window === null) return null;

  const value = window as { used?: unknown; max?: unknown; resetAtMs?: unknown };
  if (typeof value.used !== 'number' || typeof value.max !== 'number') return null;
  const resetSeconds =
    typeof value.resetAtMs === 'number'
      ? Math.max(0, Math.ceil((value.resetAtMs - nowMs) / 1_000))
      : null;
  return resetSeconds === null
    ? `Ban denied: rate limit reached (${value.used}/${value.max}).`
    : `Ban denied: rate limit reached (${value.used}/${value.max}); resets in about ${resetSeconds}s.`;
}

function formatDecision(decision: SecurityDecision, nowMs: number): string {
  if (decision.code === 'RATE_LIMIT_EXCEEDED') {
    return (
      formatRateLimitDecision(decision, nowMs) ??
      'Ban denied: the configured rate limit is exhausted.'
    );
  }
  if (decision.code === 'PERMISSION_MISSING') {
    return 'Ban denied: your Knight Staff Profile does not grant member.ban.';
  }
  if (decision.code === 'ACTION_DISABLED') {
    return 'Ban denied: member.ban is disabled for your Knight Staff Profile.';
  }
  if (decision.code === 'TARGET_OUTRANKS_ACTOR' || decision.code === 'OWNER_TARGET_PROTECTED') {
    return 'Ban denied: the target has protected or higher staff authority.';
  }
  if (decision.code === 'DEPENDENCY_UNAVAILABLE') {
    return 'Ban denied: a Knight security dependency is unavailable. No Discord action was performed.';
  }
  if (decision.decision === PolicyDecision.RequireApproval) {
    return 'Ban not executed: this target requires approval before member.ban can proceed.';
  }
  return `Ban denied: ${decision.reason}`;
}
export async function executeMemberBan(
  input: MemberBanCommandInput,
  dependencies: MemberBanCommandDependencies,
): Promise<MemberBanCommandResult> {
  const request: GuardedActionRequest = {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: 'member.ban',
    targetId: input.targetUserId,
    nowMs: input.nowMs,
  };
  const ports: GuardedActionPorts = {
    staffState: createStaffStatePort(dependencies),
    rateLimits: dependencies.rateLimits,
    decisions: dependencies.decisions,
  };

  let decision: SecurityDecision;
  try {
    decision = await dependencies.authorize(request, ports);
  } catch {
    return {
      executed: false,
      content:
        'Ban denied: Knight could not evaluate security policy safely. No Discord action was performed.',
    };
  }

  if (decision.decision !== PolicyDecision.Allow) {
    return { executed: false, content: formatDecision(decision, input.nowMs) };
  }
  const correlationId = dependencies.createCorrelationId();
  try {
    await dependencies.correlations.create(
      {
        id: correlationId,
        guildId: input.guildId,
        requestedByUserId: input.actorUserId,
        action: 'member.ban',
        targetId: input.targetUserId,
        expectedAuditActorBotId: input.knightBotUserId,
        createdAtMs: input.nowMs,
      },
      60_000,
    );
  } catch {
    return {
      executed: false,
      content:
        'Ban denied: Knight could not create the required execution correlation. No Discord action was performed.',
    };
  }

  try {
    await dependencies.discord.banMember({
      guildId: input.guildId,
      targetUserId: input.targetUserId,
      reason: input.reason,
    });
  } catch {
    return {
      executed: false,
      content:
        'Ban was authorized but Discord rejected the mutation. The attempted action still counts toward your security limits.',
    };
  }

  return {
    executed: true,
    content: `Banned <@${input.targetUserId}> through Knight.`,
  };
}
