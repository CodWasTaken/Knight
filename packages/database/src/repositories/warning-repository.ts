import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { memberWarnings } from '../schema/index.js';

export type WarningDmDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export type WarningRecord = Readonly<{
  id: string;
  guildId: string;
  targetUserId: string;
  actorUserId: string;
  reason: string;
  actorProfileVersionId: string | null;
  dmDeliveryStatus: string;
  createdAt: Date;
}>;

export class WarningRepository {
  public constructor(private readonly database: Database) {}

  public async create(input: {
    guildId: string;
    targetUserId: string;
    actorUserId: string;
    reason: string;
    actorProfileVersionId: string | null;
  }): Promise<WarningRecord> {
    const [warning] = await this.database.db.insert(memberWarnings).values(input).returning();
    if (!warning) throw new Error('Failed to create member warning');
    return warning;
  }

  public async setDmDeliveryStatus(
    guildId: string,
    warningId: string,
    status: WarningDmDeliveryStatus,
  ): Promise<void> {
    await this.database.db
      .update(memberWarnings)
      .set({ dmDeliveryStatus: status })
      .where(and(eq(memberWarnings.guildId, guildId), eq(memberWarnings.id, warningId)));
  }

  public async listForUser(guildId: string, targetUserId: string): Promise<WarningRecord[]> {
    return this.database.db
      .select()
      .from(memberWarnings)
      .where(
        and(eq(memberWarnings.guildId, guildId), eq(memberWarnings.targetUserId, targetUserId)),
      )
      .orderBy(desc(memberWarnings.createdAt), desc(memberWarnings.id));
  }
}
