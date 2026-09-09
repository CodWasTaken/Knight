import type { ActionId, PolicyDecision } from '@knight/contracts';
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
  metadata?: Record<string, unknown>;
}>;

export class PolicyDecisionRepository {
  public constructor(private readonly database: Database) {}

  public async record(input: PolicyDecisionRecordInput): Promise<string> {
    const [decision] = await this.database.db
      .insert(policyDecisions)
      .values({
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: input.action,
        targetId: input.targetId ?? null,
        decision: input.decision,
        code: input.code,
        profileVersionId: input.profileVersionId ?? null,
        metadata: input.metadata ?? {},
      })
      .returning({ id: policyDecisions.id });

    if (!decision) throw new Error('Failed to record policy decision');
    return decision.id;
  }
}
