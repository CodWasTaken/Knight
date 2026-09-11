import type { WarningRepository } from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';
import { evaluateCapability } from '@knight/security';
import { PolicyDecision } from '@knight/contracts';
import type { StaffRepository } from '@knight/database';
import { createModerationStaffStatePort } from '../../moderation/staff-state-port.js';

const MAX_REPLY_LENGTH = 1900;

export type MemberWarningsCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
  targetUserId: string;
  nowMs: number;
}>;

export type MemberWarningsCommandDependencies = Readonly<{
  staffProfiles: Pick<StaffRepository, 'getEffectiveProfile'>;
  discord: Pick<DiscordActionPort, 'getGuildState' | 'getMemberState'>;
  warnings: Pick<WarningRepository, 'listForUser'>;
}>;

export type MemberWarningsCommandResult = Readonly<{ allowed: boolean; content: string }>;

function compactReason(reason: string): string {
  const singleLine = reason.replace(/\s+/g, ' ').trim();
  return singleLine.length <= 500 ? singleLine : `${singleLine.slice(0, 497)}...`;
}

function formatHistory(targetUserId: string, warnings: Awaited<ReturnType<WarningRepository['listForUser']>>): string {
  if (warnings.length === 0) return `No Knight warnings found for <@${targetUserId}>.`;
  let content = `Knight warnings for <@${targetUserId}>:`;
  let shown = 0;
  for (const warning of warnings) {
    const line = `\n• ${warning.createdAt.toISOString()} — <@${warning.actorUserId}>: ${compactReason(warning.reason)}`;
    if (content.length + line.length > MAX_REPLY_LENGTH - 40) break;
    content += line;
    shown += 1;
  }
  const remaining = warnings.length - shown;
  if (remaining > 0) {
    const footer = `\n… ${remaining} more warning${remaining === 1 ? '' : 's'} not shown.`;
    content = content.slice(0, MAX_REPLY_LENGTH - footer.length) + footer;
  }
  return content;
}

export async function executeMemberWarnings(
  input: MemberWarningsCommandInput,
  dependencies: MemberWarningsCommandDependencies,
): Promise<MemberWarningsCommandResult> {
  try {
    const staffState = createModerationStaffStatePort(dependencies);
    const context = await staffState.getContext({
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: 'member.warnings.view',
      targetId: input.targetUserId,
      nowMs: input.nowMs,
    });
    const decision = evaluateCapability(context);
    if (decision.decision !== PolicyDecision.Allow) {
      const content = decision.code === 'PERMISSION_MISSING'
        ? 'Warning history denied: your Knight Staff Profile does not grant member.warnings.view.'
        : `Warning history denied: ${decision.reason}`;
      return { allowed: false, content };
    }
    const warnings = await dependencies.warnings.listForUser(input.guildId, input.targetUserId);
    return { allowed: true, content: formatHistory(input.targetUserId, warnings) };
  } catch {
    return { allowed: false, content: 'Warning history is unavailable because Knight could not verify the request safely.' };
  }
}
