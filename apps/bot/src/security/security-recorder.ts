import type {
  AppendSecurityLedgerInput,
  SecurityLedgerRecord,
  SecurityLedgerRepository,
} from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';

export type SecurityNotificationKind = 'SECURITY' | 'MODERATION';

export type SecurityRecorderDependencies = Readonly<{
  ledger: Pick<SecurityLedgerRepository, 'append' | 'getLoggingSettings'>;
  discord: Pick<DiscordActionPort, 'sendChannelMessage'>;
}>;

function formatNotification(input: AppendSecurityLedgerInput): string {
  const actor = input.actorUserId ?? 'unknown';
  const target = input.targetId ?? 'none';
  return `[Knight ${input.severity}] ${input.action} · actor ${actor} · target ${target}`;
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
      const channelId =
        notificationKind === 'SECURITY'
          ? (settings?.securityChannelId ?? null)
          : (settings?.moderationChannelId ?? null);
      if (channelId === null) return record;
      await this.dependencies.discord.sendChannelMessage(channelId, formatNotification(input));
    } catch {
      // Discord notifications are best-effort; the PostgreSQL ledger is authoritative.
    }

    return record;
  }
}
