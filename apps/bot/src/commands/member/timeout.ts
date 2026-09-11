import type { SecurityDecision } from '@knight/contracts';
import type { DiscordActionPort } from '@knight/discord';
import {
  executeModerationAction,
  type ModerationExecutorDependencies,
} from '../../moderation/moderation-executor.js';
import { parseTimeoutDuration } from '../../moderation/parse-duration.js';

export type MemberTimeoutCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
  targetUserId: string;
  knightBotUserId: string;
  duration: string;
  reason: string;
  nowMs: number;
}>;

export type MemberTimeoutCommandDependencies = ModerationExecutorDependencies &
  Readonly<{
    discord: ModerationExecutorDependencies['discord'] & Pick<DiscordActionPort, 'timeoutMember'>;
  }>;

export type MemberTimeoutCommandResult = Readonly<{ executed: boolean; content: string }>;

function formatDecision(decision: SecurityDecision): string {
  if (decision.code === 'RATE_LIMIT_EXCEEDED') {    return 'Timeout denied: the configured rate limit is exhausted.';
  }
  if (decision.code === 'TARGET_OUTRANKS_ACTOR' || decision.code === 'OWNER_TARGET_PROTECTED') {
    return 'Timeout denied: the target has protected or higher staff authority.';
  }
  if (decision.code === 'PERMISSION_MISSING') {
    return 'Timeout denied: your Knight Staff Profile does not grant member.timeout.';
  }
  return `Timeout denied: ${decision.reason}`;
}

export async function executeMemberTimeout(
  input: MemberTimeoutCommandInput,
  dependencies: MemberTimeoutCommandDependencies,
): Promise<MemberTimeoutCommandResult> {
  let durationMs: number;
  try {
    durationMs = parseTimeoutDuration(input.duration);
  } catch {
    return {
      executed: false,
      content: 'Invalid timeout duration. Use a value like 10m, 1h, or 1d, up to 28d.',
    };
  }

  const result = await executeModerationAction(
    {
      guildId: input.guildId,      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      knightBotUserId: input.knightBotUserId,
      action: 'member.timeout',
      nowMs: input.nowMs,
      correlation: 'required',
    },
    dependencies,
    () =>
      dependencies.discord.timeoutMember({
        guildId: input.guildId,
        targetUserId: input.targetUserId,
        durationMs,
        reason: input.reason,
      }),
  );

  if (result.kind === 'DENIED') return { executed: false, content: formatDecision(result.decision) };
  if (result.kind === 'EXECUTED') {
    return { executed: true, content: `Timed out <@${input.targetUserId}> through Knight.` };
  }
  if (result.kind === 'MUTATION_FAILED') {
    return {
      executed: false,
      content:
        'Timeout was authorized but Discord rejected the mutation. The attempted action still counts toward your security limits.',
    };
  }
  if (result.kind === 'CORRELATION_UNAVAILABLE') {
    return {
      executed: false,
      content: 'Timeout denied: Knight could not create the required execution correlation.',
    };
  }
  return {
    executed: false,
    content: 'Timeout denied: Knight could not evaluate security policy safely.',
  };
}
