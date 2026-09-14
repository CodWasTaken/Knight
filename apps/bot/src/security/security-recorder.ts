import type {
  AppendSecurityLedgerInput,
  SecurityLedgerRecord,
  SecurityLedgerRepository,
} from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';

export type SecurityNotificationKind = 'SECURITY' | 'MODERATION' | 'MESSAGES' | 'VOICE';

export type SecurityRecorderDependencies = Readonly<{
  ledger: Pick<SecurityLedgerRepository, 'append' | 'getLoggingSettings'>;
  discord: Pick<DiscordActionPort, 'sendChannelMessage'>;
}>;

export function neutralizeDiscordMentions(value: string): string {
  return value.replaceAll('@', '@\u200b');
}

function formatNotification(input: AppendSecurityLedgerInput): string {
  const actor = input.actorUserId ?? 'unknown';
  const target = input.targetId ?? 'none';
  const metadata = input.metadata;
  const context = input.action === 'message.bulk_delete'
    ? ` · channel ${String(metadata.channelId ?? 'unknown')} · count ${String(metadata.count ?? 'unknown')} · snippets ${Array.isArray(metadata.snippets) ? metadata.snippets.join(' | ') : 'unavailable'} · ${String(metadata.note ?? 'Details are in dashboard Logs.')}`
    : input.action.startsWith('message.')
    ? ` · channel ${String(metadata.channelId ?? 'unknown')} · author ${String(metadata.authorUserId ?? 'unknown')} · content ${String(metadata.content ?? 'unavailable')}`
    : input.action.startsWith('voice.')
      ? ` · member ${target} · ${String(metadata.oldChannelId ?? 'none')} → ${String(metadata.newChannelId ?? 'none')}`
      : '';
  return neutralizeDiscordMentions(
    `[Knight ${input.severity}] ${input.action} · actor ${actor} · target ${target}${context}`,
  ).slice(0, 1900);
}

export class SecurityRecorder {
  public constructor(private readonly dependencies: SecurityRecorderDependencies) {}

  public async record(
    input: AppendSecurityLedgerInput,
    notificationKind?: SecurityNotificationKind,
  ): Promise<SecurityLedgerRecord> {
    const record = await this.dependencies.ledger.append(input);
    if (notificationKind === undefined) return record;

    try {
      const settings = await this.dependencies.ledger.getLoggingSettings(input.guildId);
      const channelId = notificationKind === 'SECURITY'
        ? (settings?.securityChannelId ?? null)
        : notificationKind === 'MODERATION'
          ? (settings?.moderationChannelId ?? null)
          : notificationKind === 'MESSAGES'
            ? (settings?.messageChannelId ?? null)
            : (settings?.voiceChannelId ?? null);
      if (channelId === null) return record;
      await this.dependencies.discord.sendChannelMessage(channelId, formatNotification(input));
    } catch {
      // Discord notifications are best-effort; the PostgreSQL ledger is authoritative.
    }

    return record;
  }
}
