import type { ActionId } from '@knight/contracts';
import type { AuthorizationActor } from './types.js';

export type EffectiveAccess = Readonly<{
  actorRank: number | null;
  profileVersionId: string | null;
  hasPermission: boolean;
  restricted: boolean;
}>;

export function getEffectiveAccess(actor: AuthorizationActor, action: ActionId): EffectiveAccess {
  const restricted = actor.temporaryRestrictions.includes(action);
  const profileGranted = actor.profile?.permissions.includes(action) ?? false;
  const temporaryGranted = actor.temporaryGrants.includes(action);

  return {
    actorRank: actor.profile?.rank ?? null,
    profileVersionId: actor.profile?.profileVersionId ?? null,
    hasPermission: actor.isGuildOwner || profileGranted || temporaryGranted,
    restricted,
  };
}
