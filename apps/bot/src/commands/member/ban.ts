import type { SecurityDecision } from '@knight/contracts';
import { PolicyDecision } from '@knight/contracts';
import type { DiscordActionPort } from '@knight/discord';
import {
  executeModerationAction,
  type ModerationExecutorDependencies,
} from '../../moderation/moderation-executor.js';

export type MemberBanCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
  targetUserId: string;
  knightBotUserId: string;
  reason: string;
  nowMs: number;
}>;

export type MemberBanCommandDependencies = ModerationExecutorDependencies &
  Readonly<{
    discord: ModerationExecutorDependencies['discord'] & Pick<DiscordActionPort, 'banMember'>;
  }>;

export type MemberBanCommandResult = Readonly<{
  executed: boolean;
  content: string;
}>;

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
  const result = await executeModerationAction(
    {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      knightBotUserId: input.knightBotUserId,
      action: 'member.ban',
      nowMs: input.nowMs,
      correlation: 'required',
    },
    dependencies,
    () =>
      dependencies.discord.banMember({
        guildId: input.guildId,
        targetUserId: input.targetUserId,
        reason: input.reason,
      }),
  );

  switch (result.kind) {
    case 'DENIED':
      return { executed: false, content: formatDecision(result.decision, input.nowMs) };
    case 'SECURITY_UNAVAILABLE':
      return {
        executed: false,
        content:
          'Ban denied: Knight could not evaluate security policy safely. No Discord action was performed.',
      };
    case 'CORRELATION_UNAVAILABLE':
      return {
        executed: false,
        content:
          'Ban denied: Knight could not create the required execution correlation. No Discord action was performed.',
      };
    case 'MUTATION_FAILED':
      return {
        executed: false,
        content:
          'Ban was authorized but Discord rejected the mutation. The attempted action still counts toward your security limits.',
      };
    case 'EXECUTED':
      return {
        executed: true,
        content: `Banned <@${input.targetUserId}> through Knight.`,
      };
  }
}
