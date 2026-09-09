import { PolicyDecision, type SecurityDecision } from '@knight/contracts';
import { evaluatePolicy } from '../authorization/evaluate-policy.js';
import type { GuardedActionPorts, GuardedActionRequest, RateLimitResult } from './ports.js';

function rateKey(request: GuardedActionRequest): string {
  return `guild:${request.guildId}:user:${request.actorUserId}:${request.action}`;
}

function rateDecision(base: SecurityDecision, rate: RateLimitResult): SecurityDecision {
  if (!rate.allowed) {
    return {
      ...base,
      decision: PolicyDecision.Deny,
      code: 'RATE_LIMIT_EXCEEDED',
      reason: 'The configured action rate limit has been exhausted.',
      metadata: { ...base.metadata, rate },
    };
  }
  return {
    ...base,
    decision: PolicyDecision.Allow,
    code: 'ALLOWED',
    reason: 'Base policy and action rate limits allow the action.',
    metadata: { ...base.metadata, rate },
  };
}

function dependencyUnavailable(base: SecurityDecision): SecurityDecision {
  return {
    ...base,
    decision: PolicyDecision.Deny,
    code: 'DEPENDENCY_UNAVAILABLE',
    reason: 'A security dependency is unavailable, so the action is denied safely.',
  };
}

export async function authorizeGuardedAction(
  request: GuardedActionRequest,
  ports: GuardedActionPorts,
): Promise<SecurityDecision> {
  const context = await ports.staffState.getContext(request);
  const base = evaluatePolicy(context);

  if (base.decision !== PolicyDecision.Allow) {
    await ports.decisions.record(request, base);
    return base;
  }
  let rate: RateLimitResult;
  try {
    const windows = context.actionPolicy.unlimited ? [] : context.actionPolicy.rateWindows;
    rate = await ports.rateLimits.consume(rateKey(request), windows, request.nowMs);
  } catch {
    const denied = dependencyUnavailable(base);
    await ports.decisions.record(request, denied);
    return denied;
  }

  const decision = rateDecision(base, rate);
  await ports.decisions.record(request, decision);
  return decision;
}
