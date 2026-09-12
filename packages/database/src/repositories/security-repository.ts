import { ProtectionLevel } from '@knight/contracts';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  guildFirewallSettings,
  guilds,
  knownBots,
  knownWebhooks,
  protectedResources,
  securityEvents,
  securityIncidents,
} from '../schema/index.js';
import type { SecurityLedgerSeverity } from './security-ledger-repository.js';

export type SecurityResourceType = 'USER' | 'ROLE' | 'CHANNEL';
export type FirewallMode = 'OBSERVE' | 'ALERT' | 'ENFORCE';
export type InventoryTrustState = 'TRUSTED' | 'APPROVED' | 'UNKNOWN' | 'BLOCKED';
export type SecurityEventRecord = typeof securityEvents.$inferSelect;
export type SecurityIncidentRecord = typeof securityIncidents.$inferSelect;
export type ProtectedResourceRecord = typeof protectedResources.$inferSelect;
export type BotInventoryRecord = typeof knownBots.$inferSelect;
export type WebhookInventoryRecord = typeof knownWebhooks.$inferSelect;
export type FirewallSettingsView = Readonly<{
  guildId: string;
  botMode: FirewallMode;
  webhookMode: FirewallMode;
  configured: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
}>;

export class SecurityRepository {
  public constructor(private readonly database: Database) {}

  public async recordEvent(input: {
    guildId: string;
    source: string;
    action: string;
    actorUserId: string | null;
    targetType: string;
    targetId: string;
    auditLogId: string | null;
    executionId: string | null;
    incidentId: string | null;
    metadata: Record<string, unknown>;
    occurredAt: Date;
  }): Promise<SecurityEventRecord> {
    const [record] = await this.database.db.insert(securityEvents).values(input).returning();
    if (!record) throw new Error('Failed to record security event');
    return record;
  }

  public async listEvents(guildId: string, limit = 100): Promise<SecurityEventRecord[]> {
    return this.database.db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.guildId, guildId))
      .orderBy(desc(securityEvents.occurredAt), desc(securityEvents.id))
      .limit(Math.max(1, Math.min(limit, 100)));
  }

  public async findOrCreateIncident(input: {
    guildId: string;
    actorKey: string;
    severity: SecurityLedgerSeverity;
    summary: string;
    occurredAt: Date;
  }): Promise<SecurityIncidentRecord> {
    return this.database.db.transaction(async (tx) => {
      const [guild] = await tx
        .select({ id: guilds.id })
        .from(guilds)
        .where(eq(guilds.id, input.guildId))
        .for('update')
        .limit(1);
      if (!guild) throw new Error('Guild not found for security incident');

      const windowStart = new Date(input.occurredAt.getTime() - 5 * 60_000);
      const [existing] = await tx
        .select()
        .from(securityIncidents)
        .where(
          and(
            eq(securityIncidents.guildId, input.guildId),
            eq(securityIncidents.actorKey, input.actorKey),
            eq(securityIncidents.status, 'ACTIVE'),
            gte(securityIncidents.lastSeenAt, windowStart),
            lte(securityIncidents.lastSeenAt, input.occurredAt),
          ),
        )
        .orderBy(desc(securityIncidents.lastSeenAt))
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(securityIncidents)
          .set({
            lastSeenAt: input.occurredAt,
            eventCount: sql`${securityIncidents.eventCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(securityIncidents.id, existing.id))
          .returning();
        if (!updated) throw new Error('Failed to update security incident');
        return updated;
      }

      const [created] = await tx
        .insert(securityIncidents)
        .values({
          guildId: input.guildId,
          actorKey: input.actorKey,
          severity: input.severity,
          summary: input.summary,
          firstSeenAt: input.occurredAt,
          lastSeenAt: input.occurredAt,
        })
        .returning();
      if (!created) throw new Error('Failed to create security incident');
      return created;
    });
  }

  public async listActiveIncidents(guildId: string): Promise<SecurityIncidentRecord[]> {
    return this.database.db
      .select()
      .from(securityIncidents)
      .where(and(eq(securityIncidents.guildId, guildId), eq(securityIncidents.status, 'ACTIVE')))
      .orderBy(desc(securityIncidents.lastSeenAt))
      .limit(100);
  }

  public async getProtectionLevel(
    guildId: string,
    resourceType: SecurityResourceType,
    resourceId: string,
  ): Promise<ProtectionLevel> {
    const [record] = await this.database.db
      .select({ level: protectedResources.level })
      .from(protectedResources)
      .where(
        and(
          eq(protectedResources.guildId, guildId),
          eq(protectedResources.resourceType, resourceType),
          eq(protectedResources.resourceId, resourceId),
        ),
      )
      .limit(1);
    return record?.level ?? ProtectionLevel.Normal;
  }

  public async saveProtection(input: {
    guildId: string;
    resourceType: SecurityResourceType;
    resourceId: string;
    level: Exclude<ProtectionLevel, ProtectionLevel.Normal>;
    updatedBy: string;
  }): Promise<ProtectedResourceRecord> {
    const [record] = await this.database.db
      .insert(protectedResources)
      .values(input)
      .onConflictDoUpdate({
        target: [
          protectedResources.guildId,
          protectedResources.resourceType,
          protectedResources.resourceId,
        ],
        set: { level: input.level, updatedBy: input.updatedBy, updatedAt: new Date() },
      })
      .returning();
    if (!record) throw new Error('Failed to save protected resource');
    return record;
  }

  public async removeProtection(
    guildId: string,
    resourceType: SecurityResourceType,
    resourceId: string,
  ): Promise<void> {
    await this.database.db
      .delete(protectedResources)
      .where(
        and(
          eq(protectedResources.guildId, guildId),
          eq(protectedResources.resourceType, resourceType),
          eq(protectedResources.resourceId, resourceId),
        ),
      );
  }

  public async listProtectedResources(guildId: string): Promise<ProtectedResourceRecord[]> {
    return this.database.db
      .select()
      .from(protectedResources)
      .where(eq(protectedResources.guildId, guildId))
      .orderBy(asc(protectedResources.resourceType), asc(protectedResources.resourceId));
  }

  public async getFirewallSettings(guildId: string): Promise<FirewallSettingsView> {
    const [settings] = await this.database.db
      .select()
      .from(guildFirewallSettings)
      .where(eq(guildFirewallSettings.guildId, guildId))
      .limit(1);
    if (!settings) {
      return {
        guildId,
        botMode: 'OBSERVE',
        webhookMode: 'OBSERVE',
        configured: false,
        updatedBy: null,
        updatedAt: null,
      };
    }
    return {
      ...settings,
      botMode: settings.botMode as FirewallMode,
      webhookMode: settings.webhookMode as FirewallMode,
      configured: true,
    };
  }

  public async saveFirewallSettings(input: {
    guildId: string;
    botMode: FirewallMode;
    webhookMode: FirewallMode;
    updatedBy: string;
  }): Promise<FirewallSettingsView> {
    const [settings] = await this.database.db
      .insert(guildFirewallSettings)
      .values(input)
      .onConflictDoUpdate({
        target: guildFirewallSettings.guildId,
        set: {
          botMode: input.botMode,
          webhookMode: input.webhookMode,
          updatedBy: input.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!settings) throw new Error('Failed to save firewall settings');
    return {
      ...settings,
      botMode: settings.botMode as FirewallMode,
      webhookMode: settings.webhookMode as FirewallMode,
      configured: true,
    };
  }

  public async upsertBotInventory(input: {
    guildId: string;
    botUserId: string;
    trustState: InventoryTrustState;
    invitedByUserId: string | null;
    seenAt: Date;
  }): Promise<BotInventoryRecord> {
    const [record] = await this.database.db
      .insert(knownBots)
      .values({ ...input, firstSeenAt: input.seenAt, lastSeenAt: input.seenAt })
      .onConflictDoUpdate({
        target: [knownBots.guildId, knownBots.botUserId],
        set: {
          trustState: input.trustState,
          invitedByUserId: input.invitedByUserId,
          lastSeenAt: input.seenAt,
        },
      })
      .returning();
    if (!record) throw new Error('Failed to upsert bot inventory');
    return record;
  }

  public async getBotInventory(
    guildId: string,
    botUserId: string,
  ): Promise<BotInventoryRecord | null> {
    const [record] = await this.database.db
      .select()
      .from(knownBots)
      .where(and(eq(knownBots.guildId, guildId), eq(knownBots.botUserId, botUserId)))
      .limit(1);
    return record ?? null;
  }

  public async listBotInventory(guildId: string): Promise<BotInventoryRecord[]> {
    return this.database.db
      .select()
      .from(knownBots)
      .where(eq(knownBots.guildId, guildId))
      .orderBy(desc(knownBots.lastSeenAt));
  }

  public async setBotTrustState(
    guildId: string,
    botUserId: string,
    trustState: InventoryTrustState,
  ): Promise<BotInventoryRecord | null> {
    const [record] = await this.database.db
      .update(knownBots)
      .set({ trustState })
      .where(and(eq(knownBots.guildId, guildId), eq(knownBots.botUserId, botUserId)))
      .returning();
    return record ?? null;
  }

  public async upsertWebhookInventory(input: {
    guildId: string;
    webhookId: string;
    channelId: string;
    trustState: InventoryTrustState;
    seenAt: Date;
  }): Promise<WebhookInventoryRecord> {
    const [record] = await this.database.db
      .insert(knownWebhooks)
      .values({ ...input, firstSeenAt: input.seenAt, lastSeenAt: input.seenAt })
      .onConflictDoUpdate({
        target: [knownWebhooks.guildId, knownWebhooks.webhookId],
        set: { channelId: input.channelId, trustState: input.trustState, lastSeenAt: input.seenAt },
      })
      .returning();
    if (!record) throw new Error('Failed to upsert webhook inventory');
    return record;
  }

  public async getWebhookInventory(
    guildId: string,
    webhookId: string,
  ): Promise<WebhookInventoryRecord | null> {
    const [record] = await this.database.db
      .select()
      .from(knownWebhooks)
      .where(and(eq(knownWebhooks.guildId, guildId), eq(knownWebhooks.webhookId, webhookId)))
      .limit(1);
    return record ?? null;
  }

  public async listWebhookInventory(guildId: string): Promise<WebhookInventoryRecord[]> {
    return this.database.db
      .select()
      .from(knownWebhooks)
      .where(eq(knownWebhooks.guildId, guildId))
      .orderBy(desc(knownWebhooks.lastSeenAt));
  }

  public async setWebhookTrustState(
    guildId: string,
    webhookId: string,
    trustState: InventoryTrustState,
  ): Promise<WebhookInventoryRecord | null> {
    const [record] = await this.database.db
      .update(knownWebhooks)
      .set({ trustState })
      .where(and(eq(knownWebhooks.guildId, guildId), eq(knownWebhooks.webhookId, webhookId)))
      .returning();
    return record ?? null;
  }
}
