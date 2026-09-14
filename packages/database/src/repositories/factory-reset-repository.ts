import { GuildMode } from '@knight/contracts';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  backupPolicies,
  backups,
  guardedCategories,
  guildFactoryResetJobs,
  guildFirewallSettings,
  guildLoggingSettings,
  guildSecurityState,
  guilds,
  knownBots,
  knownWebhooks,
  memberWarnings,
  policyDecisions,
  protectedResources,
  recoveryJobs,
  rolePermissionSnapshots,
  securityEvents,
  securityIncidents,
  securityLedger,
  securityManagers,
  setupStates,
  staffAssignments,
  staffOverrides,
  staffProfiles,
  staffProfileVersions,
  temporaryAccess,
} from '../schema/index.js';

export type FactoryResetJobRecord = typeof guildFactoryResetJobs.$inferSelect;
export type FactoryResetExecutionEligibility = Readonly<{
  eligible: boolean;
  blockers: readonly ('GUILD_NOT_FOUND' | 'GUARDED' | 'PANIC' | 'CONFIG_LOCKDOWN')[];
}>;

export class FactoryResetRepository {
  public constructor(private readonly database: Database) {}

  public async enqueue(input: { guildId: string; requestedBy: string }): Promise<FactoryResetJobRecord> {
    return this.database.db.transaction(async (tx) => {
      const [guild] = await tx.select({ id: guilds.id }).from(guilds).where(eq(guilds.id, input.guildId)).for('update').limit(1);
      if (!guild) throw new Error('Guild not found for factory reset');
      const [activeReset] = await tx.select({ id: guildFactoryResetJobs.id }).from(guildFactoryResetJobs).where(and(eq(guildFactoryResetJobs.guildId, input.guildId), inArray(guildFactoryResetJobs.status, ['PENDING', 'RUNNING']))).limit(1);
      if (activeReset) throw new Error('A factory reset is already active');
      const [activeBackup] = await tx.select({ id: backups.id }).from(backups).where(and(eq(backups.guildId, input.guildId), inArray(backups.status, ['PENDING', 'RUNNING']))).limit(1);
      const [activeRecovery] = await tx.select({ id: recoveryJobs.id }).from(recoveryJobs).where(and(eq(recoveryJobs.guildId, input.guildId), inArray(recoveryJobs.status, ['PENDING', 'RUNNING', 'PREVIEW_READY']))).limit(1);
      if (activeBackup || activeRecovery) throw new Error('Active backup or recovery work blocks factory reset');
      const [record] = await tx.insert(guildFactoryResetJobs).values(input).returning();
      if (!record) throw new Error('Failed to enqueue factory reset');
      return record;
    });
  }

  public async claimPending(): Promise<FactoryResetJobRecord | null> {
    return this.database.db.transaction(async (tx) => {
      const [pending] = await tx.select({ id: guildFactoryResetJobs.id }).from(guildFactoryResetJobs).where(eq(guildFactoryResetJobs.status, 'PENDING')).orderBy(asc(guildFactoryResetJobs.createdAt), asc(guildFactoryResetJobs.id)).for('update', { skipLocked: true }).limit(1);
      if (!pending) return null;
      const now = new Date();
      const [record] = await tx.update(guildFactoryResetJobs).set({ status: 'RUNNING', startedAt: now, completedAt: null, error: null, updatedAt: now }).where(and(eq(guildFactoryResetJobs.id, pending.id), eq(guildFactoryResetJobs.status, 'PENDING'))).returning();
      return record ?? null;
    });
  }

  public async getActive(guildId: string): Promise<FactoryResetJobRecord | null> {
    const [record] = await this.database.db.select().from(guildFactoryResetJobs).where(and(eq(guildFactoryResetJobs.guildId, guildId), inArray(guildFactoryResetJobs.status, ['PENDING', 'RUNNING']))).limit(1);
    return record ?? null;
  }

  public async getLatest(guildId: string): Promise<FactoryResetJobRecord | null> {
    const [record] = await this.database.db.select().from(guildFactoryResetJobs).where(eq(guildFactoryResetJobs.guildId, guildId)).orderBy(desc(guildFactoryResetJobs.createdAt), desc(guildFactoryResetJobs.id)).limit(1);
    return record ?? null;
  }

  public async complete(input: { guildId: string; resetJobId: string }): Promise<FactoryResetJobRecord> {
    const now = new Date();
    const [record] = await this.database.db.update(guildFactoryResetJobs).set({ status: 'COMPLETED', error: null, completedAt: now, updatedAt: now }).where(and(eq(guildFactoryResetJobs.guildId, input.guildId), eq(guildFactoryResetJobs.id, input.resetJobId), eq(guildFactoryResetJobs.status, 'RUNNING'))).returning();
    if (!record) throw new Error('Factory reset job is not running');
    return record;
  }

  public async fail(input: { guildId: string; resetJobId: string; error: string }): Promise<FactoryResetJobRecord> {
    const now = new Date();
    const [record] = await this.database.db.update(guildFactoryResetJobs).set({ status: 'FAILED', error: input.error, completedAt: now, updatedAt: now }).where(and(eq(guildFactoryResetJobs.guildId, input.guildId), eq(guildFactoryResetJobs.id, input.resetJobId), eq(guildFactoryResetJobs.status, 'RUNNING'))).returning();
    if (!record) throw new Error('Factory reset job is not running');
    return record;
  }

  public async recoverInterrupted(now = new Date()): Promise<void> {
    await this.database.db.update(guildFactoryResetJobs).set({ status: 'PENDING', error: null, startedAt: null, completedAt: null, updatedAt: now }).where(eq(guildFactoryResetJobs.status, 'RUNNING'));
  }

  public async getExecutionEligibility(guildId: string): Promise<FactoryResetExecutionEligibility> {
    const [guild] = await this.database.db.select({ mode: guilds.mode }).from(guilds).where(eq(guilds.id, guildId)).limit(1);
    if (!guild) return { eligible: false, blockers: ['GUILD_NOT_FOUND'] };
    const [security] = await this.database.db.select({ mode: guildSecurityState.mode, lockedScopes: guildSecurityState.lockedScopes }).from(guildSecurityState).where(eq(guildSecurityState.guildId, guildId)).limit(1);
    const blockers: FactoryResetExecutionEligibility['blockers'][number][] = [];
    if (guild.mode === 'GUARDED') blockers.push('GUARDED');
    if (security?.mode === 'PANIC') blockers.push('PANIC');
    if (security?.mode === 'LOCKDOWN' && security.lockedScopes.some((scope) => scope === 'SECURITY_CONFIG' || scope === 'FULL')) blockers.push('CONFIG_LOCKDOWN');
    return { eligible: blockers.length === 0, blockers };
  }

  public async resetGuildKnightState(input: { guildId: string; resetJobId: string; ownerId: string }): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [guild] = await tx.select({ id: guilds.id }).from(guilds).where(eq(guilds.id, input.guildId)).for('update').limit(1);
      if (!guild) throw new Error('Guild not found for factory reset execution');
      await tx.delete(recoveryJobs).where(eq(recoveryJobs.guildId, input.guildId));
      await tx.delete(backups).where(eq(backups.guildId, input.guildId));
      await tx.delete(backupPolicies).where(eq(backupPolicies.guildId, input.guildId));
      await tx.delete(policyDecisions).where(eq(policyDecisions.guildId, input.guildId));
      await tx.delete(memberWarnings).where(eq(memberWarnings.guildId, input.guildId));
      await tx.delete(staffAssignments).where(eq(staffAssignments.guildId, input.guildId));
      await tx.delete(staffOverrides).where(eq(staffOverrides.guildId, input.guildId));
      await tx.delete(temporaryAccess).where(eq(temporaryAccess.guildId, input.guildId));
      await tx.delete(staffProfileVersions).where(eq(staffProfileVersions.guildId, input.guildId));
      await tx.delete(staffProfiles).where(eq(staffProfiles.guildId, input.guildId));
      await tx.delete(securityManagers).where(eq(securityManagers.guildId, input.guildId));
      await tx.delete(securityEvents).where(eq(securityEvents.guildId, input.guildId));
      await tx.delete(securityIncidents).where(eq(securityIncidents.guildId, input.guildId));
      await tx.delete(protectedResources).where(eq(protectedResources.guildId, input.guildId));
      await tx.delete(guildFirewallSettings).where(eq(guildFirewallSettings.guildId, input.guildId));
      await tx.delete(knownBots).where(eq(knownBots.guildId, input.guildId));
      await tx.delete(knownWebhooks).where(eq(knownWebhooks.guildId, input.guildId));
      await tx.delete(guildSecurityState).where(eq(guildSecurityState.guildId, input.guildId));
      await tx.delete(securityLedger).where(eq(securityLedger.guildId, input.guildId));
      await tx.delete(guildLoggingSettings).where(eq(guildLoggingSettings.guildId, input.guildId));
      await tx.delete(rolePermissionSnapshots).where(eq(rolePermissionSnapshots.guildId, input.guildId));
      await tx.delete(guardedCategories).where(eq(guardedCategories.guildId, input.guildId));
      await tx.delete(setupStates).where(eq(setupStates.guildId, input.guildId));
      await tx.delete(guildFactoryResetJobs).where(and(eq(guildFactoryResetJobs.guildId, input.guildId), ne(guildFactoryResetJobs.id, input.resetJobId)));
      await tx.update(guilds).set({ ownerId: input.ownerId, mode: GuildMode.Observe, updatedAt: new Date() }).where(eq(guilds.id, input.guildId));
      await tx.insert(setupStates).values({ guildId: input.guildId, step: 'WELCOME', completedSteps: [] }).onConflictDoUpdate({ target: setupStates.guildId, set: { step: 'WELCOME', completedSteps: [], updatedAt: new Date() } });
    });
  }
}
