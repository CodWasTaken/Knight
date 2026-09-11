import type { ActionId, SecurityDecision } from '@knight/contracts';
import { PolicyDecision } from '@knight/contracts';
import type { StaffRepository } from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';
import type { ExecutionCorrelationStore } from '@knight/redis';
import type {
  authorizeGuardedAction,
  DecisionLogPort,
  GuardedActionPorts,
  GuardedActionRequest,
  RateLimitPort,
} from '@knight/security';
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
  rateLimits: RateLimitPort;
  decisions: DecisionLogPort;
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
  const ports: GuardedActionPorts = {
    staffState: createModerationStaffStatePort(dependencies),
    rateLimits: dependencies.rateLimits,
    decisions: dependencies.decisions,
  };

  let decision: SecurityDecision;
  try {
    decision = await dependencies.authorize(request, ports);
  } catch {
    return { kind: 'SECURITY_UNAVAILABLE', executed: false };
  }

  if (decision.decision !== PolicyDecision.Allow) {
    return { kind: 'DENIED', executed: false, decision };
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
    return { kind: 'MUTATION_FAILED', executed: false, decision };
  }

  return { kind: 'EXECUTED', executed: true, decision };
}
