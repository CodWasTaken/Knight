import { PolicyDecision, type SecurityDecision } from '@knight/contracts';
import type { DiscordActionPort, DiscordMessageState } from '@knight/discord';
import type { GuardedActionPorts, GuardedActionRequest } from '@knight/security';
import type { ModerationExecutorDependencies } from '../../moderation/moderation-executor.js';
import {
  createModerationStaffStatePort,
  hasElevatedDiscordAuthority,
} from '../../moderation/staff-state-port.js';
import { planPurge, type PurgeAuthorState } from '../../moderation/purge-planner.js';

export type MessagePurgeCommandInput = Readonly<{
  guildId: string;
  channelId: string;
  actorUserId: string;
  knightBotUserId: string;
  count: number;
  targetUserId: string | null;
  reason?: string | null;
  nowMs: number;
}>;

export type MessagePurgeCommandDependencies = ModerationExecutorDependencies &
  Readonly<{
    discord: ModerationExecutorDependencies['discord'] &
      Pick<DiscordActionPort, 'fetchRecentMessages' | 'deleteMessages'>;
  }>;

export type MessagePurgeCommandResult = Readonly<{ executed: boolean; content: string }>;

function formatDecision(decision: SecurityDecision): string {
  if (decision.code === 'TARGET_OUTRANKS_ACTOR' || decision.code === 'OWNER_TARGET_PROTECTED') {
    return 'Purge denied: the selected target is protected by Knight hierarchy.';
  }
  if (decision.code === 'PERMISSION_MISSING') {
    return 'Purge denied: your Knight Staff Profile does not grant message.purge.';
  }
  if (decision.code === 'ACTION_DISABLED') {
    return 'Purge denied: message.purge is disabled for your Knight Staff Profile.';
  }
  if (decision.code === 'RATE_LIMIT_EXCEEDED') {
    return 'Purge denied: the configured rate limit is exhausted.';
  }
  if (decision.decision === PolicyDecision.RequireApproval) {
    return 'Purge not executed: this action requires approval.';
  }
  return `Purge denied: ${decision.reason}`;
}

function formatResult(deleted: number, protectedCount: number, ineligibleCount: number): string {
  return `Deleted ${deleted} message(s); protected ${protectedCount}; ineligible ${ineligibleCount}.`;
}

async function resolvePlannerState(
  input: MessagePurgeCommandInput,
  dependencies: MessagePurgeCommandDependencies,
  messages: readonly DiscordMessageState[],
): Promise<{
  actorRank: number | null;
  actorIsGuildOwner: boolean;
  authors: ReadonlyMap<string, PurgeAuthorState>;
}> {
  const [guild, actorProfile] = await Promise.all([
    dependencies.discord.getGuildState(input.guildId),
    dependencies.staffProfiles.getEffectiveProfile(input.guildId, input.actorUserId),
  ]);
  const actorIsGuildOwner = guild.ownerId === input.actorUserId;
  const authorIds = [...new Set(messages.map((message) => message.authorUserId))];
  const entries = await Promise.all(
    authorIds.map(async (userId): Promise<[string, PurgeAuthorState]> => {
      const [profile, member] = await Promise.all([
        dependencies.staffProfiles.getEffectiveProfile(input.guildId, userId),
        dependencies.discord.getMemberState(input.guildId, userId),
      ]);
      if (profile !== null && profile.guildId !== input.guildId) {
        throw new Error('Cross-guild Staff Profile state');
      }
      return [
        userId,
        {
          userId,
          isGuildOwner: guild.ownerId === userId,
          knightRank: profile?.rank ?? null,
          elevatedUnregistered:
            profile === null && member !== null && hasElevatedDiscordAuthority(member.permissions),
        },
      ];
    }),
  );

  return {
    actorRank: actorProfile?.rank ?? null,
    actorIsGuildOwner,
    authors: new Map(entries),
  };
}

export async function executeMessagePurge(
  input: MessagePurgeCommandInput,
  dependencies: MessagePurgeCommandDependencies,
): Promise<MessagePurgeCommandResult> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 100) {
    return { executed: false, content: 'Purge count must be an integer from 1-100.' };
  }

  const request: GuardedActionRequest = {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: 'message.purge',
    targetId: input.targetUserId,
    nowMs: input.nowMs,
  };
  const ports: GuardedActionPorts = {
    staffState: createModerationStaffStatePort(dependencies),
    rateLimits: dependencies.rateLimits,
    decisions: dependencies.decisions,
  };

  let decision: SecurityDecision;
  try {
    decision = await dependencies.authorize(request, ports);
  } catch {
    return {
      executed: false,
      content: 'Purge denied: Knight could not evaluate security policy safely.',
    };
  }
  if (decision.decision !== PolicyDecision.Allow) {
    return { executed: false, content: formatDecision(decision) };
  }

  let messages: readonly DiscordMessageState[];
  try {
    messages = await dependencies.discord.fetchRecentMessages({
      channelId: input.channelId,
      limit: input.count,
    });
  } catch {
    return { executed: false, content: 'Purge failed: Knight could not inspect recent messages safely.' };
  }

  let plannerState: Awaited<ReturnType<typeof resolvePlannerState>>;
  try {
    plannerState = await resolvePlannerState(input, dependencies, messages);
  } catch {
    return { executed: false, content: 'Purge failed: Knight could not resolve message-author security state.' };
  }
  const plan = planPurge({
    messages,
    authors: plannerState.authors,
    actorRank: plannerState.actorRank,
    actorIsGuildOwner: plannerState.actorIsGuildOwner,
    targetUserId: input.targetUserId,
  });

  if (plan.deletableIds.length === 0) {
    return {
      executed: true,
      content: formatResult(0, plan.protectedIds.length, plan.ineligibleIds.length),
    };
  }

  try {
    await dependencies.correlations.create(
      {
        id: dependencies.createCorrelationId(),
        guildId: input.guildId,
        requestedByUserId: input.actorUserId,
        action: 'message.purge',
        targetId: input.channelId,
        expectedAuditActorBotId: input.knightBotUserId,
        createdAtMs: input.nowMs,
      },
      60_000,
    );
  } catch {
    return {
      executed: false,
      content: 'Purge denied: Knight could not create the required execution correlation.',
    };
  }

  let deleted: number;
  try {
    deleted = await dependencies.discord.deleteMessages({
      channelId: input.channelId,
      messageIds: plan.deletableIds,
    });
  } catch {
    return {
      executed: false,
      content: 'Purge was authorized but Discord rejected the deletion. The attempt still counts toward security limits.',
    };
  }

  return {
    executed: true,
    content: formatResult(deleted, plan.protectedIds.length, plan.ineligibleIds.length),
  };
}
