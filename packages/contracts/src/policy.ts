import type { ActionId } from './actions.js';

export enum PolicyDecision {
  Allow = 'ALLOW',
  Deny = 'DENY',
  RequireApproval = 'REQUIRE_APPROVAL',
  Contain = 'CONTAIN',
}

export enum GuildMode {
  Observe = 'OBSERVE',
  Test = 'TEST',
  Guarded = 'GUARDED',
}

export enum ProtectionLevel {
  Normal = 'NORMAL',
  Important = 'IMPORTANT',
  Critical = 'CRITICAL',
  Immutable = 'IMMUTABLE',
}

export type RateWindow = Readonly<{
  max: number;
  windowMs: number;
}>;

export type ActionPolicy = Readonly<{
  enabled: boolean;
  unlimited: boolean;
  rateWindows: readonly RateWindow[];
}>;

export type ActionPolicies = Readonly<Partial<Record<ActionId, ActionPolicy>>>;

export type SecurityDecision = Readonly<{
  decision: PolicyDecision;
  code: string;
  reason: string;
  policyVersionId: string | null;
  metadata: Readonly<Record<string, unknown>>;
}>;
