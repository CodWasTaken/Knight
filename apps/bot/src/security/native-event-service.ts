import { ProtectionLevel } from '@knight/contracts';
import type {
  SecurityLedgerSeverity,
  SecurityRepository,
  SecurityResourceType,
} from '@knight/database';
import type { ExecutionCorrelation, ExecutionCorrelationStore } from '@knight/redis';
import type { FirewallService } from './firewall-service.js';
import type { SecurityRecorder } from './security-recorder.js';

export type NativeEventTargetType = SecurityResourceType | 'BOT' | 'WEBHOOK';

export type NativeEventInput = Readonly<{
  guildId: string;
  knightBotUserId: string;
  action: string;
  targetType: NativeEventTargetType;
  targetId: string;
  actorUserId: string | null;
  auditLogId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}>;

export type NativeEventServiceDependencies = Readonly<{
  security: Pick<SecurityRepository, 'getProtectionLevel' | 'findOrCreateIncident' | 'recordEvent'>;
  correlations: Pick<ExecutionCorrelationStore, 'consumeMatch'>;
  recorder: Pick<SecurityRecorder, 'record'>;
  firewall: Pick<FirewallService, 'handleBotJoin' | 'handleWebhookUpdate'>;
}>;

function severityForProtection(level: ProtectionLevel): SecurityLedgerSeverity {
  if (level === ProtectionLevel.Immutable) return 'CRITICAL';
  if (level === ProtectionLevel.Critical) return 'HIGH';
  if (level === ProtectionLevel.Important) return 'MEDIUM';
  return 'INFO';
}

export class NativeEventService {
  public constructor(private readonly dependencies: NativeEventServiceDependencies) {}

  public async record(input: NativeEventInput): Promise<void> {
    let correlation: ExecutionCorrelation | null = null;
    if (input.actorUserId === null || input.actorUserId === input.knightBotUserId) {
      try {
        correlation = await this.dependencies.correlations.consumeMatch({
          guildId: input.guildId,
          expectedAuditActorBotId: input.knightBotUserId,
          action: input.action,
          targetId: input.targetId,
        });
      } catch {
        correlation = null;
      }
    }
    const source = correlation === null ? 'NATIVE' : 'KNIGHT';
    const actorUserId = correlation?.requestedByUserId ?? input.actorUserId;
    const executionId = correlation?.id ?? null;

    let severity: SecurityLedgerSeverity = 'INFO';
    let incidentId: string | null = null;
    if (
      correlation === null &&
      (input.targetType === 'USER' || input.targetType === 'ROLE' || input.targetType === 'CHANNEL')
    ) {
      const protectionLevel = await this.dependencies.security.getProtectionLevel(
        input.guildId,
        input.targetType,
        input.targetId,
      );
      severity = severityForProtection(protectionLevel);
      if (protectionLevel !== ProtectionLevel.Normal) {
        const incident = await this.dependencies.security.findOrCreateIncident({
          guildId: input.guildId,
          actorKey: actorUserId === null ? 'unknown' : `user:${actorUserId}`,
          severity,
          summary: `${input.action} changed a protected ${input.targetType.toLowerCase()}`,
          occurredAt: input.occurredAt,
        });
        incidentId = incident.id;
      }
    }

    await this.dependencies.security.recordEvent({
      guildId: input.guildId,
      source,
      action: input.action,
      actorUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      auditLogId: input.auditLogId,
      executionId,
      incidentId,
      metadata: input.metadata,
      occurredAt: input.occurredAt,
    });
    if (input.action === 'bot.join' && input.targetType === 'BOT') {
      await this.dependencies.firewall.handleBotJoin(input.guildId, input.targetId);
    }
    if (input.action === 'webhook.update' && input.targetType === 'WEBHOOK') {
      await this.dependencies.firewall.handleWebhookUpdate(input.guildId, input.targetId);
    }
    await this.dependencies.recorder.record(
      {
        guildId: input.guildId,
        severity,
        source,
        action: input.action,
        actorUserId,
        targetId: input.targetId,
        decisionId: null,
        incidentId,
        metadata: {
          ...input.metadata,
          targetType: input.targetType,
          auditLogId: input.auditLogId,
          executionId,
        },
      },
      input.action === 'member.ban' || input.action === 'member.unban' ? 'MODERATION' : 'SECURITY',
    );
  }
}
