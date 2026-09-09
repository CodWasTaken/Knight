import type { ActionId, ActionPolicies, ActionPolicy } from '@knight/contracts';

export type AuthoritySnapshot = Readonly<{
  rank: number;
  permissions: readonly ActionId[];
  actionPolicies: ActionPolicies;
  activeRestrictions: readonly ActionId[];
}>;

export type AuthorityChangeInput = Readonly<{
  actorUserId: string;
  affectedUserIds: readonly string[];
  before: AuthoritySnapshot;
  after: AuthoritySnapshot;
}>;

function addedPermission(before: readonly ActionId[], after: readonly ActionId[]): boolean {
  const previous = new Set(before);
  return after.some((action) => !previous.has(action));
}

function removedRestriction(before: readonly ActionId[], after: readonly ActionId[]): boolean {
  const next = new Set(after);
  return before.some((action) => !next.has(action));
}
function actionPolicyIncreased(
  before: ActionPolicy | undefined,
  after: ActionPolicy | undefined,
): boolean {
  if (!after) return false;
  if (!before) return after.enabled || after.unlimited;
  if (!before.enabled && after.enabled) return true;
  if (!before.unlimited && after.unlimited) return true;
  if (before.unlimited || after.unlimited) return false;

  const nextByWindow = new Map(after.rateWindows.map((window) => [window.windowMs, window.max]));
  return before.rateWindows.some((window) => {
    const nextMax = nextByWindow.get(window.windowMs);
    return nextMax === undefined || nextMax > window.max;
  });
}

function actionPoliciesIncreased(before: ActionPolicies, after: ActionPolicies): boolean {
  const actions = new Set<ActionId>([
    ...(Object.keys(before) as ActionId[]),
    ...(Object.keys(after) as ActionId[]),
  ]);

  for (const action of actions) {
    if (actionPolicyIncreased(before[action], after[action])) return true;
  }

  return false;
}
export function wouldIncreaseOwnAuthority(input: AuthorityChangeInput): boolean {
  if (!input.affectedUserIds.includes(input.actorUserId)) return false;
  if (input.after.rank > input.before.rank) return true;
  if (addedPermission(input.before.permissions, input.after.permissions)) return true;
  if (removedRestriction(input.before.activeRestrictions, input.after.activeRestrictions))
    return true;
  return actionPoliciesIncreased(input.before.actionPolicies, input.after.actionPolicies);
}
