import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { guildLoggingSettings, guilds, securityLedger } from '../schema/index.js';

export type SecurityLedgerSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AppendSecurityLedgerInput = Readonly<{
  guildId: string;
  severity: SecurityLedgerSeverity;
  source: string;
  action: string;
  actorUserId: string | null;
  targetId: string | null;
  decisionId: string | null;
  incidentId: string | null;
  metadata: Record<string, unknown>;
}>;

export type SecurityLedgerRecord = typeof securityLedger.$inferSelect;
export type LoggingSettingsRecord = typeof guildLoggingSettings.$inferSelect;

export type SecurityLedgerFilters = Readonly<{
  source?: string;
  action?: string;
  severity?: SecurityLedgerSeverity;
  actorUserId?: string;
  targetId?: string;
  limit?: number;
}>;
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function hashEntry(
  input: AppendSecurityLedgerInput,
  previousHash: string | null,
  createdAt: Date,
): string {
  const payload = {
    ...input,
    metadata: stableValue(input.metadata),
    previousHash,
    createdAt: createdAt.toISOString(),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export class SecurityLedgerRepository {
  public constructor(private readonly database: Database) {}

  public async append(input: AppendSecurityLedgerInput): Promise<SecurityLedgerRecord> {
    return this.database.db.transaction(async (tx) => {
      const [guild] = await tx
        .select({ id: guilds.id })
        .from(guilds)
        .where(eq(guilds.id, input.guildId))
        .for('update')
        .limit(1);
      if (!guild) throw new Error('Guild not found for security ledger append');

      const [latest] = await tx
        .select({ entryHash: securityLedger.entryHash })
        .from(securityLedger)
        .where(eq(securityLedger.guildId, input.guildId))
        .orderBy(desc(securityLedger.id))
        .limit(1);

      const previousHash = latest?.entryHash ?? null;
      const createdAt = new Date();
      const entryHash = hashEntry(input, previousHash, createdAt);
      const [record] = await tx
        .insert(securityLedger)
        .values({ ...input, previousHash, entryHash, createdAt })
        .returning();
      if (!record) throw new Error('Failed to append security ledger entry');
      return record;
    });
  }

  public async listRecent(
    guildId: string,
    filters: SecurityLedgerFilters,
  ): Promise<SecurityLedgerRecord[]> {
    const conditions = [eq(securityLedger.guildId, guildId)];
    if (filters.source !== undefined) conditions.push(eq(securityLedger.source, filters.source));
    if (filters.action !== undefined) conditions.push(eq(securityLedger.action, filters.action));
    if (filters.severity !== undefined) {
      conditions.push(eq(securityLedger.severity, filters.severity));
    }
    if (filters.actorUserId !== undefined) {
      conditions.push(eq(securityLedger.actorUserId, filters.actorUserId));
    }
    if (filters.targetId !== undefined) conditions.push(eq(securityLedger.targetId, filters.targetId));
    const limit = Math.max(1, Math.min(filters.limit ?? 100, 100));

    return this.database.db
      .select()
      .from(securityLedger)
      .where(and(...conditions))
      .orderBy(desc(securityLedger.id))
      .limit(limit);
  }

  public async getLoggingSettings(guildId: string): Promise<LoggingSettingsRecord | null> {
    const [settings] = await this.database.db
      .select()
      .from(guildLoggingSettings)
      .where(eq(guildLoggingSettings.guildId, guildId))
      .limit(1);
    return settings ?? null;
  }

  public async remapLoggingChannelForRecovery(input: {
    guildId: string;
    oldChannelId: string;
    newChannelId: string;
    recoveryJobId: string;
  }): Promise<LoggingSettingsRecord | null> {
    return this.database.db.transaction(async (tx) => {
      const [settings] = await tx
        .select()
        .from(guildLoggingSettings)
        .where(eq(guildLoggingSettings.guildId, input.guildId))
        .for('update')
        .limit(1);
      if (!settings) return null;

      const securityChannelId =
        settings.securityChannelId === input.oldChannelId ? input.newChannelId : settings.securityChannelId;
      const moderationChannelId =
        settings.moderationChannelId === input.oldChannelId ? input.newChannelId : settings.moderationChannelId;
      const messageChannelId =
        settings.messageChannelId === input.oldChannelId ? input.newChannelId : settings.messageChannelId;
      const voiceChannelId =
        settings.voiceChannelId === input.oldChannelId ? input.newChannelId : settings.voiceChannelId;
      if (securityChannelId === settings.securityChannelId && moderationChannelId === settings.moderationChannelId && messageChannelId === settings.messageChannelId && voiceChannelId === settings.voiceChannelId) {
        return settings;
      }

      const [updated] = await tx
        .update(guildLoggingSettings)
        .set({
          securityChannelId,
          moderationChannelId,
          messageChannelId,
          voiceChannelId,
          updatedBy: `RECOVERY:${input.recoveryJobId}`,
          updatedAt: new Date(),
        })
        .where(eq(guildLoggingSettings.guildId, input.guildId))
        .returning();
      if (!updated) throw new Error('Failed to remap recovery logging channel');
      return updated;
    });
  }

  public async saveLoggingSettings(input: {
    guildId: string;
    securityChannelId: string | null;
    moderationChannelId: string | null;
    messageChannelId?: string | null;
    voiceChannelId?: string | null;
    storeDeletedMessageContent?: boolean;
    updatedBy: string;
  }): Promise<LoggingSettingsRecord> {
    const values = {
      ...input,
      messageChannelId: input.messageChannelId ?? null,
      voiceChannelId: input.voiceChannelId ?? null,
      storeDeletedMessageContent: input.storeDeletedMessageContent ?? false,
    };
    const [settings] = await this.database.db
      .insert(guildLoggingSettings)
      .values(values)
      .onConflictDoUpdate({
        target: guildLoggingSettings.guildId,
        set: {
          securityChannelId: input.securityChannelId,
          moderationChannelId: input.moderationChannelId,
          messageChannelId: values.messageChannelId,
          voiceChannelId: values.voiceChannelId,
          storeDeletedMessageContent: values.storeDeletedMessageContent,
          updatedBy: input.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!settings) throw new Error('Failed to save guild logging settings');
    return settings;
  }
}
