import type { SecurityDecision } from '@knight/contracts';
import { PolicyDecision } from '@knight/contracts';
import type { WarningRepository } from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';
import {
  executeModerationAction,
  type ModerationExecutorDependencies,
} from '../../moderation/moderation-executor.js';

export type MemberWarnCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
  targetUserId: string;
  knightBotUserId: string;
  reason: string;
  nowMs: number;
}>;

export type MemberWarnCommandDependencies = ModerationExecutorDependencies & Readonly<{
  discord: ModerationExecutorDependencies['discord'] & Pick<DiscordActionPort, 'sendDirectMessage'>;
  warnings: Pick<WarningRepository, 'create' | 'setDmDeliveryStatus'>;
}>;

export type MemberWarnCommandResult = Readonly<{ executed: boolean; content: string }>;

function formatDecision(decision: SecurityDecision): string {
  if (decision.code === 'RATE_LIMIT_EXCEEDED') return 'Warning denied: the configured rate limit is exhausted.';
  if (decision.code === 'PERMISSION_MISSING') return 'Warning denied: your Knight Staff Profile does not grant member.warn.';
  if (decision.code === 'ACTION_DISABLED') return 'Warning denied: member.warn is disabled for your Knight Staff Profile.';
  if (decision.code === 'TARGET_OUTRANKS_ACTOR' || decision.code === 'OWNER_TARGET_PROTECTED') {
    return 'Warning denied: the target has protected or higher staff authority.';
  }
  if (decision.decision === PolicyDecision.RequireApproval) {
    return 'Warning not issued: this target requires approval before member.warn can proceed.';
  }
  return `Warning denied: ${decision.reason}`;
}

export async function executeMemberWarn(
  input: MemberWarnCommandInput,
  dependencies: MemberWarnCommandDependencies,
): Promise<MemberWarnCommandResult> {
  let warningId: string | null = null;
  const result = await executeModerationAction(
    {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      knightBotUserId: input.knightBotUserId,
      action: 'member.warn',
      nowMs: input.nowMs,
      correlation: 'none',
    },
    dependencies,
    async (decision) => {
      const warning = await dependencies.warnings.create({
        guildId: input.guildId,
        targetUserId: input.targetUserId,
        actorUserId: input.actorUserId,
        reason: input.reason,
        actorProfileVersionId: decision.policyVersionId,
      });
      warningId = warning.id;
    },
  );

  if (result.kind === 'DENIED') return { executed: false, content: formatDecision(result.decision) };
  if (result.kind === 'SECURITY_UNAVAILABLE') {
    return { executed: false, content: 'Warning denied: Knight could not evaluate security policy safely.' };
  }
  if (result.kind === 'CORRELATION_UNAVAILABLE') {
    return { executed: false, content: 'Warning denied: Knight could not create required execution evidence.' };
  }
  if (result.kind === 'MUTATION_FAILED' || warningId === null) {
    return {
      executed: false,
      content: 'Warning was authorized but could not be saved. The attempted action still counts toward your security limits.',
    };
  }

  try {
    await dependencies.discord.sendDirectMessage({
      userId: input.targetUserId,
      content: `You received a Knight warning. Reason: ${input.reason}`,
    });
  } catch {
    try {
      await dependencies.warnings.setDmDeliveryStatus(input.guildId, warningId, 'FAILED');
    } catch {
      return {
        executed: true,
        content: `The warning was saved for <@${input.targetUserId}>, but the DM failed and delivery status could not be updated.`,
      };
    }
    return {
      executed: true,
      content: `The warning was saved for <@${input.targetUserId}>, but the DM could not be delivered.`,
    };
  }

  try {
    await dependencies.warnings.setDmDeliveryStatus(input.guildId, warningId, 'DELIVERED');
  } catch {
    return {
      executed: true,
      content: `Warned <@${input.targetUserId}> and delivered the DM, but Knight could not record the delivery status.`,
    };
  }
  return { executed: true, content: `Warned <@${input.targetUserId}> through Knight.` };
}
