import { AuditLogEvent, Events, type Client, type Guild, type GuildAuditLogsEntry, type Message, type PartialMessage } from 'discord.js';
import type { ActivityLogService } from './activity-log-service.js';

const AUDIT_WINDOW_MS = 5_000;
type Attribution = Readonly<{ actorUserId: string; auditLogId: string }>;

export async function findMessageDeleteAttribution(
  guild: Pick<Guild, 'fetchAuditLogs'>,
  input: Readonly<{ channelId: string; authorUserId: string | null; count: number; occurredAtMs: number; bulk: boolean }>,
): Promise<Attribution | null> {
  const type = input.bulk ? AuditLogEvent.MessageBulkDelete : AuditLogEvent.MessageDelete;
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = [...logs.entries.values()].find((candidate: GuildAuditLogsEntry) => {
      const extra = candidate.extra as { channel?: { id?: string }; count?: number } | null;
      const channelMatches = extra?.channel?.id === input.channelId;
      const countMatches = extra?.count === input.count;
      const targetMatches = input.bulk || input.authorUserId === null || candidate.targetId === input.authorUserId;
      return candidate.action === type && channelMatches && countMatches && targetMatches && Math.abs(candidate.createdTimestamp - input.occurredAtMs) <= AUDIT_WINDOW_MS;
    });
    return entry?.executorId ? { actorUserId: entry.executorId, auditLogId: entry.id } : null;
  } catch {
    return null;
  }
}

function normalizedMessage(message: Message | PartialMessage, occurredAt: Date, attribution: Attribution | null) {
  return {
    guildId: message.guildId!, channelId: message.channelId, messageId: message.id,
    authorUserId: message.author?.id ?? null, content: message.content || null,
    attachments: [...message.attachments.values()].map((attachment) => ({ id: attachment.id, name: attachment.name, size: attachment.size, contentType: attachment.contentType })),
    actorUserId: attribution?.actorUserId ?? null, auditLogId: attribution?.auditLogId ?? null, occurredAt,
  };
}

export function installActivityListeners(
  client: Pick<Client, 'on' | 'user'>,
  service: Pick<ActivityLogService, 'recordMessageDelete' | 'recordBulkMessageDelete' | 'recordVoiceTransition'>,
): void {
  const safely = (promise: Promise<void>) => void promise.catch(() => console.error('Knight could not record Discord activity.'));
  client.on(Events.MessageDelete, (message) => safely((async () => {
    if (!message.guild || message.guildId === null || message.author?.id === client.user?.id) return;
    const occurredAt = new Date();
    const attribution = await findMessageDeleteAttribution(message.guild, { channelId: message.channelId, authorUserId: message.author?.id ?? null, count: 1, occurredAtMs: occurredAt.getTime(), bulk: false });
    await service.recordMessageDelete(normalizedMessage(message, occurredAt, attribution));
  })()));
  client.on(Events.MessageBulkDelete, (messages, channel) => safely((async () => {
    if (!channel.guild || messages.size === 0) return;
    const filtered = [...messages.values()].filter((message) => message.author?.id !== client.user?.id);
    if (filtered.length === 0) return;
    const occurredAt = new Date();
    const attribution = await findMessageDeleteAttribution(channel.guild, { channelId: channel.id, authorUserId: null, count: messages.size, occurredAtMs: occurredAt.getTime(), bulk: true });
    await service.recordBulkMessageDelete({ guildId: channel.guild.id, channelId: channel.id, actorUserId: attribution?.actorUserId ?? null, auditLogId: attribution?.auditLogId ?? null, occurredAt, messages: filtered.map((message) => normalizedMessage(message, occurredAt, attribution)) });
  })()));
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const memberUserId = newState.id || oldState.id;
    safely(service.recordVoiceTransition({
      guildId: newState.guild.id, memberUserId,
      oldState: { channelId: oldState.channelId, serverMute: oldState.serverMute ?? false, serverDeaf: oldState.serverDeaf ?? false },
      newState: { channelId: newState.channelId, serverMute: newState.serverMute ?? false, serverDeaf: newState.serverDeaf ?? false },
      occurredAt: new Date(),
    }));
  });
}
