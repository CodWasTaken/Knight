import type {
  ActionId,
  ProtectionLevel,
  SecurityLockdownScope,
  SecurityStateMode,
  StaffProfileSnapshot,
} from '@knight/contracts';

export type AuthorizationActor = Readonly<{
  userId: string;
  isGuildOwner: boolean;
  profile: StaffProfileSnapshot | null;
  temporaryGrants: readonly ActionId[];
  temporaryRestrictions: readonly ActionId[];
}>;

export type AuthorizationTarget = Readonly<{
  userId: string;
  isGuildOwner: boolean;
  knightRank: number | null;
  elevatedUnregistered: boolean;
  protectionLevel: ProtectionLevel;
}>;

export type AuthorizationEmergencyState = Readonly<{
  mode: SecurityStateMode;
  lockedScopes: readonly SecurityLockdownScope[];
}>;
export type AuthorizationContext = Readonly<{
  action: ActionId;
  actor: AuthorizationActor;
  target: AuthorizationTarget | null;
  emergency: AuthorizationEmergencyState;
}>;
