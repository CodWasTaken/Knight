import { PolicyDecision, type SecurityDecision } from '@knight/contracts';
import { getEffectiveAccess } from './effective-access.js';
import type { AuthorizationContext } from './types.js';

function makeDecision(
  context: AuthorizationContext,
  decision: PolicyDecision,
  code: string,
  reason: string,
): SecurityDecision {
  return {
    decision,
    code,
    reason,
    policyVersionId: context.actor.profile?.profileVersionId ?? null,
    metadata: {},
  };
}

export function evaluateCapability(context: AuthorizationContext): SecurityDecision {
  if (!context.actor.isGuildOwner && context.actor.profile === null) {
    return makeDecision(
      context,
      PolicyDecision.Deny,
      'NO_ACTIVE_STAFF_ASSIGNMENT',
      'No active Knight Staff Profile is assigned to this actor.',
    );
  }
  const access = getEffectiveAccess(context.actor, context.action);
  if (access.restricted) {
    return makeDecision(
      context,
      PolicyDecision.Deny,
      'TEMPORARILY_RESTRICTED',
      'A temporary restriction blocks this capability.',
    );
  }
  if (!access.hasPermission) {
    return makeDecision(
      context,
      PolicyDecision.Deny,
      'PERMISSION_MISSING',
      `The actor does not have the ${context.action} permission.`,
    );
  }
  return makeDecision(
    context,
    PolicyDecision.Allow,
    'ALLOWED',
    'Capability evaluation allowed the action.',
  );
}
