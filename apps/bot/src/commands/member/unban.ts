import type { SecurityDecision } from '@knight/contracts';
import type { DiscordActionPort } from '@knight/discord';
import {
  executeModerationAction,
  type ModerationExecutorDependencies,
} from '../../moderation/moderation-executor.js';

export type MemberUnbanCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
  targetUserId: string;
  knightBotUserId: string;
  reason: string;
  nowMs: number;
}>;

export type MemberUnbanCommandDependencies = ModerationExecutorDependencies &
  Readonly<{
    discord: ModerationExecutorDependencies['discord'] & Pick<DiscordActionPort, 'unbanMember'>;
  }>;

export type MemberUnbanCommandResult = Readonly<{ executed: boolean; content: string }>;

function formatDecision(decision: SecurityDecision): string {
  if (decision.code === 'RATE_LIMIT_EXCEEDED') {
    return 'Unban denied: the configured rate limit is exhausted.';
  }  if (decision.code === 'TARGET_OUTRANKS_ACTOR' || decision.code === 'OWNER_TARGET_PROTECTED') {
    return 'Unban denied: the target has protected or higher staff authority.';
  }
  if (decision.code === 'PERMISSION_MISSING') {
    return 'Unban denied: your Knight Staff Profile does not grant member.unban.';
  }
  return `Unban denied: ${decision.reason}`;
}

export async function executeMemberUnban(
  input: MemberUnbanCommandInput,
  dependencies: MemberUnbanCommandDependencies,
): Promise<MemberUnbanCommandResult> {
  const result = await executeModerationAction(
    {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      knightBotUserId: input.knightBotUserId,
      action: 'member.unban',
      nowMs: input.nowMs,
      correlation: 'required',
    },
    dependencies,
    () =>
      dependencies.discord.unbanMember({
        guildId: input.guildId,
        targetUserId: input.targetUserId,        reason: input.reason,
      }),
  );

  if (result.kind === 'DENIED') return { executed: false, content: formatDecision(result.decision) };
  if (result.kind === 'EXECUTED') {
    return { executed: true, content: `Unbanned <@${input.targetUserId}> through Knight.` };
  }
  if (result.kind === 'MUTATION_FAILED') {
    return {
      executed: false,
      content:
        'Unban was authorized but Discord rejected the mutation. The attempted action still counts toward your security limits.',
    };
  }
  if (result.kind === 'CORRELATION_UNAVAILABLE') {
    return {
      executed: false,
      content: 'Unban denied: Knight could not create the required execution correlation.',
    };
  }
  return {
    executed: false,
    content: 'Unban denied: Knight could not evaluate security policy safely.',
  };
}
