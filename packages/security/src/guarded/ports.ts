import type { ActionId, ActionPolicy, RateWindow, SecurityDecision } from '@knight/contracts';
import type { AuthorizationContext } from '../authorization/types.js';

export type GuardedActionRequest = Readonly<{
  guildId: string;
  actorUserId: string;
  action: ActionId;
  targetId: string | null;
  nowMs: number;
}>;

export type GuardedActionContext = AuthorizationContext &
  Readonly<{
    actionPolicy: ActionPolicy;
  }>;

export type RateLimitWindowResult = Readonly<{
  max: number;
  windowMs: number;
  used: number;
  remaining: number;
  resetAtMs: number;
}>;
export type RateLimitResult = Readonly<{
  allowed: boolean;
  windows: readonly RateLimitWindowResult[];
}>;

export interface StaffStatePort {
  getContext(request: GuardedActionRequest): Promise<GuardedActionContext>;
}

export interface RateLimitPort {
  consume(key: string, windows: readonly RateWindow[], nowMs: number): Promise<RateLimitResult>;
}

export interface DecisionLogPort {
  record(request: GuardedActionRequest, decision: SecurityDecision): Promise<unknown>;
}

export type GuardedActionPorts = Readonly<{
  staffState: StaffStatePort;
  rateLimits: RateLimitPort;
  decisions: DecisionLogPort;
}>;
