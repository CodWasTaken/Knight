import {
  AuditLogEvent,
  Events,
  type Client,
  type Guild,
  type GuildAuditLogsEntry,
} from 'discord.js';
import type {
  NativeEventInput,
  NativeEventService,
  NativeEventTargetType,
} from './native-event-service.js';

const AUDIT_WINDOW_MS = 15_000;

type AuditAttribution = Readonly<{ actorUserId: string; auditLogId: string }>;

export async function findAuditAttribution(
  guild: Pick<Guild, 'fetchAuditLogs'>,
  type: AuditLogEvent,
  targetId: string,
  occurredAtMs: number,
): Promise<AuditAttribution | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(
      (candidate: GuildAuditLogsEntry) =>
        candidate.targetId === targetId &&
        Math.abs(candidate.createdTimestamp - occurredAtMs) <= AUDIT_WINDOW_MS,
    );
    const actorUserId = entry?.executorId ?? null;
    if (entry === undefined || actorUserId === null) return null;
    return { actorUserId, auditLogId: entry.id };
  } catch {
    return null;
  }
}

export function installNativeListeners(
  client: Pick<Client, 'on' | 'user'>,
  service: Pick<NativeEventService, 'record'>,
): void {
  const record = async (input: {
    guild: Guild;
    auditType: AuditLogEvent | null;
    action: string;
    targetType: NativeEventTargetType;
    targetId: string;
    metadata?: Record<string, unknown>;
  }) => {
    const knightBotUserId = client.user?.id;
    if (knightBotUserId === undefined) return;
    const occurredAt = new Date();
    const attribution =
      input.auditType === null
        ? null
        : await findAuditAttribution(
            input.guild,
            input.auditType,
            input.targetId,
            occurredAt.getTime(),
          );
    const event: NativeEventInput = {
      guildId: input.guild.id,
      knightBotUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      actorUserId: attribution?.actorUserId ?? null,
      auditLogId: attribution?.auditLogId ?? null,
      metadata: input.metadata ?? {},
      occurredAt,
    };
    await service.record(event);
  };

  const safely = (operation: Promise<void>) => {
    void operation.catch(() => console.error('Knight could not record a native security event.'));
  };

  client.on(Events.GuildRoleCreate, (role) =>
    safely(
      record({
        guild: role.guild,
        auditType: AuditLogEvent.RoleCreate,
        action: 'role.create',
        targetType: 'ROLE',
        targetId: role.id,
      }),
    ),
  );
  client.on(Events.GuildRoleUpdate, (_oldRole, role) =>
    safely(
      record({
        guild: role.guild,
        auditType: AuditLogEvent.RoleUpdate,
        action: 'role.update',
        targetType: 'ROLE',
        targetId: role.id,
      }),
    ),
  );
  client.on(Events.GuildRoleDelete, (role) =>
    safely(
      record({
        guild: role.guild,
        auditType: AuditLogEvent.RoleDelete,
        action: 'role.delete',
        targetType: 'ROLE',
        targetId: role.id,
      }),
    ),
  );
  client.on(Events.ChannelCreate, (channel) => {
    if (!channel.isDMBased())
      safely(
        record({
          guild: channel.guild,
          auditType: AuditLogEvent.ChannelCreate,
          action: 'channel.create',
          targetType: 'CHANNEL',
          targetId: channel.id,
        }),
      );
  });
  client.on(Events.ChannelUpdate, (_oldChannel, channel) => {
    if (!channel.isDMBased())
      safely(
        record({
          guild: channel.guild,
          auditType: AuditLogEvent.ChannelUpdate,
          action: 'channel.update',
          targetType: 'CHANNEL',
          targetId: channel.id,
        }),
      );
  });
  client.on(Events.ChannelDelete, (channel) => {
    if (!channel.isDMBased())
      safely(
        record({
          guild: channel.guild,
          auditType: AuditLogEvent.ChannelDelete,
          action: 'channel.delete',
          targetType: 'CHANNEL',
          targetId: channel.id,
        }),
      );
  });
  client.on(Events.GuildBanAdd, (ban) =>
    safely(
      record({
        guild: ban.guild,
        auditType: AuditLogEvent.MemberBanAdd,
        action: 'member.ban',
        targetType: 'USER',
        targetId: ban.user.id,
      }),
    ),
  );
  client.on(Events.GuildBanRemove, (ban) =>
    safely(
      record({
        guild: ban.guild,
        auditType: AuditLogEvent.MemberBanRemove,
        action: 'member.unban',
        targetType: 'USER',
        targetId: ban.user.id,
      }),
    ),
  );
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.user.bot)
      safely(
        record({
          guild: member.guild,
          auditType: AuditLogEvent.BotAdd,
          action: 'bot.join',
          targetType: 'BOT',
          targetId: member.user.id,
        }),
      );
  });
  client.on(Events.WebhooksUpdate, (channel) =>
    safely(
      record({
        guild: channel.guild,
        auditType: null,
        action: 'webhook.update',
        targetType: 'WEBHOOK',
        targetId: channel.id,
      }),
    ),
  );
}
