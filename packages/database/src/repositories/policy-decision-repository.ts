import type { ActionId, PolicyDecision, SecurityDecision } from '@knight/contracts';
import type { Database } from '../client.js';
import { policyDecisions } from '../schema/index.js';

export type PolicyDecisionRecordInput = Readonly<{
  guildId: string;
  actorUserId: string;
  action: ActionId;
  targetId?: string | null;
  decision: PolicyDecision;
  code: string;
  profileVersionId?: string | null;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type PolicyDecisionRequest = Readonly<{
  guildId: string;
  actorUserId: string;
  action: ActionId;
  targetId?: string | null;
}>;
function normalizeDecision(
  input: PolicyDecisionRecordInput | PolicyDecisionRequest,
  decision?: SecurityDecision,
): PolicyDecisionRecordInput {
  if (!decision) return input as PolicyDecisionRecordInput;

  return {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetId: input.targetId ?? null,
    decision: decision.decision,
    code: decision.code,
    profileVersionId: decision.policyVersionId,
    metadata: decision.metadata,
  };
}

export class PolicyDecisionRepository {
  public constructor(private readonly database: Database) {}

  public async record(input: PolicyDecisionRecordInput): Promise<string>;
  public async record(request: PolicyDecisionRequest, decision: SecurityDecision): Promise<string>;
  public async record(
    input: PolicyDecisionRecordInput | PolicyDecisionRequest,
    decision?: SecurityDecision,
  ): Promise<string> {
    const normalized = normalizeDecision(input, decision);
    const [stored] = await this.database.db
      .insert(policyDecisions)
      .values({
        guildId: normalized.guildId,
        actorUserId: normalized.actorUserId,
        action: normalized.action,
        targetId: normalized.targetId ?? null,
        decision: normalized.decision,
        code: normalized.code,
        profileVersionId: normalized.profileVersionId ?? null,
        metadata: normalized.metadata ?? {},
      })
      .returning({ id: policyDecisions.id });

    if (!stored) throw new Error('Failed to record policy decision');
    return stored.id;
  }
}
