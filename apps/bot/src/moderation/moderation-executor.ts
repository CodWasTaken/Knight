import type { ActionId, SecurityDecision } from '@knight/contracts';
import { PolicyDecision } from '@knight/contracts';
import type { SecurityRepository, StaffRepository } from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';
import type { ExecutionCorrelationStore } from '@knight/redis';
import type {
  authorizeGuardedAction,
  DecisionLogPort,
  GuardedActionPorts,
  GuardedActionRequest,
  RateLimitPort,
} from '@knight/security';
import type { SecurityRecorder } from '../security/security-recorder.js';
import { createModerationStaffStatePort } from './staff-state-port.js';

export type ModerationExecutionInput = Readonly<{
  guildId: string;
  actorUserId: string;
  targetUserId: string | null;
  knightBotUserId: string;
  action: ActionId;
  nowMs: number;
  correlation: 'required' | 'none';
  correlationTargetId?: string;
}>;

export type ModerationExecutorDependencies = Readonly<{
  authorize: typeof authorizeGuardedAction;
  staffProfiles: Pick<StaffRepository, 'getEffectiveProfile'>;
  security: Pick<SecurityRepository, 'getProtectionLevel'>;
  rateLimits: RateLimitPort;
  decisions: DecisionLogPort;
  securityRecorder: Pick<SecurityRecorder, 'record'>;
  correlations: Pick<ExecutionCorrelationStore, 'create'>;
  discord: Pick<DiscordActionPort, 'getGuildState' | 'getMemberState'>;
  createCorrelationId: () => string;
}>;

export type ModerationExecutionResult =
  | Readonly<{ kind: 'DENIED'; executed: false; decision: SecurityDecision }>
  | Readonly<{ kind: 'SECURITY_UNAVAILABLE'; executed: false }>
  | Readonly<{ kind: 'CORRELATION_UNAVAILABLE'; executed: false }>
  | Readonly<{ kind: 'MUTATION_FAILED'; executed: false; decision: SecurityDecision }>
  | Readonly<{ kind: 'EXECUTED'; executed: true; decision: SecurityDecision }>;

export async function executeModerationAction(
  input: ModerationExecutionInput,
  dependencies: ModerationExecutorDependencies,
  mutation: (decision: SecurityDecision) => Promise<void>,
): Promise<ModerationExecutionResult> {
  const request: GuardedActionRequest = {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetId: input.targetUserId,
    nowMs: input.nowMs,
  };
  let decisionId: string | null = null;
  const decisions: DecisionLogPort = {
    async record(requestToRecord, decisionToRecord) {
      const stored = await dependencies.decisions.record(requestToRecord, decisionToRecord);
      decisionId = typeof stored === 'string' ? stored : null;
      return stored;
    },
  };
  const ports: GuardedActionPorts = {
    staffState: createModerationStaffStatePort(dependencies),
    rateLimits: dependencies.rateLimits,
    decisions,
  };

  let decision: SecurityDecision;
  try {
    decision = await dependencies.authorize(request, ports);
  } catch {
    return { kind: 'SECURITY_UNAVAILABLE', executed: false };
  }

  const ledgerInput = (outcome: string) => ({
    guildId: input.guildId,
    severity: 'INFO' as const,
    source: 'KNIGHT',
    action: input.action,
    actorUserId: input.actorUserId,
    targetId: input.targetUserId,
    decisionId,
    incidentId: null,
    metadata: { outcome, decision: decision.decision, code: decision.code },
  });

  if (decision.decision !== PolicyDecision.Allow) {
    try {
      await dependencies.securityRecorder.record(ledgerInput('DENIED'), 'MODERATION');
    } catch {
      return { kind: 'SECURITY_UNAVAILABLE', executed: false };
    }
    return { kind: 'DENIED', executed: false, decision };
  }

  try {
    await dependencies.securityRecorder.record(ledgerInput('AUTHORIZED'));
  } catch {
    return { kind: 'SECURITY_UNAVAILABLE', executed: false };
  }

  if (input.correlation === 'required') {
    const correlationTargetId = input.correlationTargetId ?? input.targetUserId;
    if (correlationTargetId === null) {
      return { kind: 'CORRELATION_UNAVAILABLE', executed: false };
    }
    try {
      await dependencies.correlations.create(
        {
          id: dependencies.createCorrelationId(),
          guildId: input.guildId,
          requestedByUserId: input.actorUserId,
          action: input.action,
          targetId: correlationTargetId,
          expectedAuditActorBotId: input.knightBotUserId,
          createdAtMs: input.nowMs,
        },
        60_000,
      );
    } catch {
      return { kind: 'CORRELATION_UNAVAILABLE', executed: false };
    }
  }

  try {
    await mutation(decision);
  } catch {
    try {
      await dependencies.securityRecorder.record(ledgerInput('MUTATION_FAILED'), 'MODERATION');
    } catch {
      // The action already failed; do not mask that outcome with a logging exception.
    }
    return { kind: 'MUTATION_FAILED', executed: false, decision };
  }

  try {
    await dependencies.securityRecorder.record(ledgerInput('EXECUTED'), 'MODERATION');
  } catch {
    // The mutation already happened; the pre-mutation AUTHORIZED entry remains durable evidence.
  }
  return { kind: 'EXECUTED', executed: true, decision };
}
