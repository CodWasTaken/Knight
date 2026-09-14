import type { SecurityLedgerRepository } from '@knight/database';
import type { SecurityRecorder } from '../security/security-recorder.js';

type AttachmentMetadata = Readonly<{ id: string; name: string | null; size: number; contentType: string | null }>;
type DeletedMessageInput = Readonly<{
  guildId: string;
  channelId: string;
  messageId: string;
  authorUserId: string | null;
  content: string | null;
  attachments: readonly AttachmentMetadata[];
  actorUserId: string | null;
  auditLogId: string | null;
  occurredAt: Date;
}>;
type VoiceState = Readonly<{ channelId: string | null; serverMute: boolean; serverDeaf: boolean }>;

type ActivityDependencies = Readonly<{
  ledger: Pick<SecurityLedgerRepository, 'getLoggingSettings'>;
  recorder: Pick<SecurityRecorder, 'record'>;
  messageContentAvailable: boolean;
}>;

export class ActivityLogService {
  public constructor(private readonly dependencies: ActivityDependencies) {}

  private async messageInput(input: DeletedMessageInput, bulkOperationId?: string) {
    const settings = await this.dependencies.ledger.getLoggingSettings(input.guildId);
    const retentionEnabled = settings?.storeDeletedMessageContent ?? false;
    const contentStatus = !retentionEnabled
      ? 'DISABLED'
      : !this.dependencies.messageContentAvailable
        ? 'CAPABILITY_UNAVAILABLE'
        : input.content === null
          ? 'UNAVAILABLE'
          : 'AVAILABLE';
    return {
      guildId: input.guildId,
      severity: 'INFO' as const,
      source: 'DISCORD',
      action: 'message.delete',
      actorUserId: input.actorUserId,
      targetId: input.messageId,
      decisionId: null,
      incidentId: null,
      metadata: {
        channelId: input.channelId,
        messageId: input.messageId,
        authorUserId: input.authorUserId,
        attachmentCount: input.attachments.length,
        attachments: input.attachments,
        content: contentStatus === 'AVAILABLE' ? input.content!.slice(0, 4000) : null,
        contentStatus,
        auditLogId: input.auditLogId,
        ...(bulkOperationId === undefined ? {} : { bulkOperationId }),
        occurredAt: input.occurredAt.toISOString(),
      },
    };
  }

  public async recordMessageDelete(input: DeletedMessageInput): Promise<void> {
    await this.dependencies.recorder.record(await this.messageInput(input), 'MESSAGES');
  }

  public async recordBulkMessageDelete(input: Readonly<{
    guildId: string;
    channelId: string;
    actorUserId: string | null;
    auditLogId: string | null;
    occurredAt: Date;
    messages: readonly DeletedMessageInput[];
  }>): Promise<void> {
    const bulkOperationId = `${input.channelId}:${input.occurredAt.getTime()}`;
    const details = [] as Awaited<ReturnType<ActivityLogService['messageInput']>>[];
    for (const message of input.messages) details.push(await this.messageInput({ ...message, actorUserId: input.actorUserId, auditLogId: input.auditLogId }, bulkOperationId));
    for (const detail of details) await this.dependencies.recorder.record(detail);
    const snippets = details.map((detail) => detail.metadata.content).filter((value): value is string => typeof value === 'string').map((value) => value.slice(0, 160));
    await this.dependencies.recorder.record({
      guildId: input.guildId, severity: 'INFO', source: 'DISCORD', action: 'message.bulk_delete',
      actorUserId: input.actorUserId, targetId: input.channelId, decisionId: null, incidentId: null,
      metadata: { channelId: input.channelId, count: input.messages.length, auditLogId: input.auditLogId, bulkOperationId, snippets, note: 'Remaining details are in dashboard Logs.' },
    }, 'MESSAGES');
  }

  public async recordVoiceTransition(input: Readonly<{
    guildId: string; memberUserId: string; oldState: VoiceState; newState: VoiceState; occurredAt: Date;
  }>): Promise<void> {
    const actions: string[] = [];
    if (input.oldState.channelId !== input.newState.channelId) {
      actions.push(input.oldState.channelId === null ? 'voice.join' : input.newState.channelId === null ? 'voice.leave' : 'voice.move');
    }
    if (input.oldState.serverMute !== input.newState.serverMute) actions.push(input.newState.serverMute ? 'voice.server_mute' : 'voice.server_unmute');
    if (input.oldState.serverDeaf !== input.newState.serverDeaf) actions.push(input.newState.serverDeaf ? 'voice.server_deafen' : 'voice.server_undeafen');
    for (const action of actions) {
      await this.dependencies.recorder.record({
        guildId: input.guildId, severity: 'INFO', source: 'DISCORD', action,
        actorUserId: null, targetId: input.memberUserId, decisionId: null, incidentId: null,
        metadata: { memberUserId: input.memberUserId, oldChannelId: input.oldState.channelId, newChannelId: input.newState.channelId, occurredAt: input.occurredAt.toISOString() },
      }, 'VOICE');
    }
  }
}
