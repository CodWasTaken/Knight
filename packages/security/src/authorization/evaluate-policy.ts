import {
  PolicyDecision,
  ProtectionLevel,
  type ActionId,
  type SecurityDecision,
  type SecurityLockdownScope,
} from '@knight/contracts';
import { getEffectiveAccess } from './effective-access.js';
import type { AuthorizationContext } from './types.js';

const MEMBER_MODERATION_ACTIONS = new Set<ActionId>([
  'member.warn',
  'member.timeout',
  'member.kick',
  'member.ban',
  'member.unban',
  'message.purge',
]);

const SECURITY_CONFIG_ACTIONS = new Set<ActionId>([
  'security.staff.assign',
  'security.staff.remove',
  'security.staff.manage_profiles',
  'security.security_managers.manage',
  'security.policy.edit',
  'security.approvals.approve',
]);

const MUTATING_ACTIONS = new Set<ActionId>([
  ...MEMBER_MODERATION_ACTIONS,
  ...SECURITY_CONFIG_ACTIONS,
]);

const ACTIONS_BY_LOCKDOWN_SCOPE: Readonly<
  Partial<Record<SecurityLockdownScope, ReadonlySet<ActionId>>>
> = {
  MEMBER_MODERATION: MEMBER_MODERATION_ACTIONS,
  SECURITY_CONFIG: SECURITY_CONFIG_ACTIONS,
  FULL: MUTATING_ACTIONS,
};

function lockedByEmergencyState(context: AuthorizationContext): SecurityDecision | null {
  if (context.emergency.mode === 'PANIC' && MUTATING_ACTIONS.has(context.action)) {
    return makeDecision(
      context,
      PolicyDecision.Deny,
      'PANIC_ACTIVE',
      'Panic mode blocks privileged Knight mutations until it is cleared.',
    );
  }
  if (context.emergency.mode !== 'LOCKDOWN') return null;
  const blocked = context.emergency.lockedScopes.some((scope) =>
    ACTIONS_BY_LOCKDOWN_SCOPE[scope]?.has(context.action),
  );
  return blocked
    ? makeDecision(
        context,
        PolicyDecision.Deny,
        'LOCKDOWN_ACTIVE',
        'The current Lockdown scope blocks this Knight action.',
      )
    : null;
}

function makeDecision(
  context: AuthorizationContext,
  decision: PolicyDecision,
  code: string,
  reason: string,
  metadata: Readonly<Record<string, unknown>> = {},
): SecurityDecision {
  return {
    decision,
    code,
    reason,
    policyVersionId: context.actor.profile?.profileVersionId ?? null,
    metadata,
  };
}
export function evaluatePolicy(context: AuthorizationContext): SecurityDecision {
  if (!context.actor.isGuildOwner && context.actor.profile === null) {
    return makeDecision(
      context,
      PolicyDecision.Deny,
      'NO_ACTIVE_STAFF_ASSIGNMENT',
      'No active Knight Staff Profile is assigned to this actor.',
    );
  }

  if (context.target?.isGuildOwner) {
    return makeDecision(
      context,
      PolicyDecision.Deny,
      'OWNER_TARGET_PROTECTED',
      'The Discord guild owner is protected from staff moderation actions.',
    );
  }

  const emergencyDecision = lockedByEmergencyState(context);
  if (emergencyDecision) return emergencyDecision;
  const access = getEffectiveAccess(context.actor, context.action);

  if (access.restricted) {
    return makeDecision(
      context,
      PolicyDecision.Deny,
      'TEMPORARILY_RESTRICTED',
      'A temporary restriction blocks this action.',
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

  if (!context.actor.isGuildOwner && context.target !== null) {
    if (context.target.elevatedUnregistered && context.target.knightRank === null) {
      return makeDecision(
        context,
        PolicyDecision.Deny,
        'TARGET_OUTRANKS_ACTOR',
        'The target has elevated Discord authority that Knight cannot safely rank.',
      );
    }
    if (
      context.target.knightRank !== null &&
      access.actorRank !== null &&
      context.target.knightRank >= access.actorRank
    ) {
      return makeDecision(
        context,
        PolicyDecision.Deny,
        'TARGET_OUTRANKS_ACTOR',
        'The target is equal to or above the actor in the Knight hierarchy.',
        { actorRank: access.actorRank, targetRank: context.target.knightRank },
      );
    }
  }

  if (
    !context.actor.isGuildOwner &&
    context.target?.protectionLevel === ProtectionLevel.Immutable
  ) {
    return makeDecision(
      context,
      PolicyDecision.Deny,
      'PROTECTED_TARGET',
      'This immutable target cannot be changed by ordinary staff actions.',
      { protectionLevel: context.target.protectionLevel },
    );
  }

  if (
    context.target !== null &&
    (context.target.protectionLevel === ProtectionLevel.Critical ||
      context.target.protectionLevel === ProtectionLevel.Immutable)
  ) {
    return makeDecision(
      context,
      PolicyDecision.RequireApproval,
      'APPROVAL_REQUIRED',
      'This protected target requires an approval before the action can execute.',
      { protectionLevel: context.target.protectionLevel },
    );
  }

  return makeDecision(
    context,
    PolicyDecision.Allow,
    'ALLOWED',
    'Policy evaluation allowed the action.',
  );
}
