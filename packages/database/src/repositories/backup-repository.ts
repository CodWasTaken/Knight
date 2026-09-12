import type { BackupPolicyMode } from '@knight/contracts';
import { and, asc, desc, eq, gte, inArray, notExists, or, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { backupPolicies, backups, recoveryJobs } from '../schema/index.js';

export type BackupPolicyRecord = typeof backupPolicies.$inferSelect;
export type BackupRecord = typeof backups.$inferSelect;
export type RecoveryJobRecord = typeof recoveryJobs.$inferSelect;

export class BackupRepository {
  public constructor(private readonly database: Database) {}

  public async savePolicy(input: {
    guildId: string;
    mode: BackupPolicyMode;
    archiveChannelIds: readonly string[];
    maxMessagesPerChannel?: number;
    updatedBy: string;
  }): Promise<BackupPolicyRecord> {
    const values = {
      guildId: input.guildId,
      mode: input.mode,
      archiveChannelIds: [...input.archiveChannelIds],
      maxMessagesPerChannel: input.maxMessagesPerChannel ?? 1000,
      updatedBy: input.updatedBy,
    };
    const [record] = await this.database.db
      .insert(backupPolicies)
      .values(values)
      .onConflictDoUpdate({
        target: backupPolicies.guildId,
        set: {
          mode: values.mode,
          archiveChannelIds: values.archiveChannelIds,
          maxMessagesPerChannel: values.maxMessagesPerChannel,
          updatedBy: values.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!record) throw new Error('Failed to save backup policy');
    return record;
  }

  public async getPolicy(guildId: string): Promise<BackupPolicyRecord | null> {
    const [record] = await this.database.db
      .select()
      .from(backupPolicies)
      .where(eq(backupPolicies.guildId, guildId))
      .limit(1);
    return record ?? null;
  }

  public async listDueDailyPolicies(now: Date): Promise<BackupPolicyRecord[]> {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return this.database.db
      .select()
      .from(backupPolicies)
      .where(
        and(
          eq(backupPolicies.mode, 'DAILY'),
          notExists(
            this.database.db
              .select({ one: sql<number>`1` })
              .from(backups)
              .where(
                and(
                  eq(backups.guildId, backupPolicies.guildId),
                  or(
                    inArray(backups.status, ['PENDING', 'RUNNING']),
                    and(eq(backups.status, 'COMPLETED'), gte(backups.completedAt, cutoff)),
                  ),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(backupPolicies.guildId));
  }

  public async enqueueBackup(input: {
    guildId: string;
    requestedBy: string;
  }): Promise<BackupRecord> {
    const [record] = await this.database.db.insert(backups).values(input).returning();
    if (!record) throw new Error('Failed to enqueue backup');
    return record;
  }

  public async claimPendingBackup(): Promise<BackupRecord | null> {
    return this.database.db.transaction(async (tx) => {
      const [pending] = await tx
        .select({ id: backups.id })
        .from(backups)
        .where(eq(backups.status, 'PENDING'))
        .orderBy(asc(backups.createdAt), asc(backups.id))
        .for('update', { skipLocked: true })
        .limit(1);
      if (!pending) return null;

      const [claimed] = await tx
        .update(backups)
        .set({ status: 'RUNNING', startedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(backups.id, pending.id), eq(backups.status, 'PENDING')))
        .returning();
      return claimed ?? null;
    });
  }

  public async completeBackup(input: {
    guildId: string;
    backupId: string;
    relativePath: string;
    sha256: string;
  }): Promise<BackupRecord> {
    const now = new Date();
    const [record] = await this.database.db
      .update(backups)
      .set({
        status: 'COMPLETED',
        relativePath: input.relativePath,
        sha256: input.sha256,
        error: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(eq(backups.guildId, input.guildId), eq(backups.id, input.backupId)))
      .returning();
    if (!record) throw new Error('Backup not found in guild');
    return record;
  }

  public async failBackup(input: {
    guildId: string;
    backupId: string;
    error: string;
  }): Promise<BackupRecord> {
    const now = new Date();
    const [record] = await this.database.db
      .update(backups)
      .set({ status: 'FAILED', error: input.error, completedAt: now, updatedAt: now })
      .where(and(eq(backups.guildId, input.guildId), eq(backups.id, input.backupId)))
      .returning();
    if (!record) throw new Error('Backup not found in guild');
    return record;
  }

  public async getBackup(guildId: string, backupId: string): Promise<BackupRecord | null> {
    const [record] = await this.database.db
      .select()
      .from(backups)
      .where(and(eq(backups.guildId, guildId), eq(backups.id, backupId)))
      .limit(1);
    return record ?? null;
  }

  public async listBackups(guildId: string, limit = 50): Promise<BackupRecord[]> {
    return this.database.db
      .select()
      .from(backups)
      .where(eq(backups.guildId, guildId))
      .orderBy(desc(backups.createdAt), desc(backups.id))
      .limit(Math.max(1, Math.min(limit, 100)));
  }

  public async enqueueRestorePreview(input: {
    guildId: string;
    backupId: string;
    requestedBy: string;
  }): Promise<RecoveryJobRecord> {
    const backup = await this.getBackup(input.guildId, input.backupId);
    if (!backup) throw new Error('Backup not found in guild');
    const [record] = await this.database.db.insert(recoveryJobs).values(input).returning();
    if (!record) throw new Error('Failed to enqueue restore preview');
    return record;
  }

  public async saveRestorePreview(input: {
    guildId: string;
    jobId: string;
    preview: Record<string, unknown>;
  }): Promise<RecoveryJobRecord> {
    const [record] = await this.database.db
      .update(recoveryJobs)
      .set({ status: 'PREVIEW_READY', preview: input.preview, error: null, updatedAt: new Date() })
      .where(
        and(
          eq(recoveryJobs.guildId, input.guildId),
          eq(recoveryJobs.id, input.jobId),
          eq(recoveryJobs.phase, 'PREVIEW'),
          eq(recoveryJobs.status, 'RUNNING'),
        ),
      )
      .returning();
    if (!record) throw new Error('Restore preview job not running in guild');
    return record;
  }

  public async confirmRestore(input: {
    guildId: string;
    jobId: string;
    confirmedBy: string;
  }): Promise<RecoveryJobRecord> {
    const now = new Date();
    const [record] = await this.database.db
      .update(recoveryJobs)
      .set({
        phase: 'EXECUTION',
        status: 'PENDING',
        confirmedBy: input.confirmedBy,
        confirmedAt: now,
        startedAt: null,
        completedAt: null,
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(recoveryJobs.guildId, input.guildId),
          eq(recoveryJobs.id, input.jobId),
          eq(recoveryJobs.phase, 'PREVIEW'),
          eq(recoveryJobs.status, 'PREVIEW_READY'),
        ),
      )
      .returning();
    if (!record) throw new Error('Restore preview is not ready for confirmation');
    return record;
  }

  public async claimPendingRestore(): Promise<RecoveryJobRecord | null> {
    return this.database.db.transaction(async (tx) => {
      const [pending] = await tx
        .select({ id: recoveryJobs.id })
        .from(recoveryJobs)
        .where(eq(recoveryJobs.status, 'PENDING'))
        .orderBy(asc(recoveryJobs.createdAt), asc(recoveryJobs.id))
        .for('update', { skipLocked: true })
        .limit(1);
      if (!pending) return null;

      const [claimed] = await tx
        .update(recoveryJobs)
        .set({ status: 'RUNNING', startedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(recoveryJobs.id, pending.id), eq(recoveryJobs.status, 'PENDING')))
        .returning();
      return claimed ?? null;
    });
  }

  public async updateRestoreCheckpoint(input: {
    guildId: string;
    jobId: string;
    checkpoint: Record<string, unknown>;
  }): Promise<RecoveryJobRecord> {
    const [record] = await this.database.db
      .update(recoveryJobs)
      .set({ checkpoint: input.checkpoint, updatedAt: new Date() })
      .where(and(eq(recoveryJobs.guildId, input.guildId), eq(recoveryJobs.id, input.jobId)))
      .returning();
    if (!record) throw new Error('Recovery job not found in guild');
    return record;
  }

  public async failRestore(input: {
    guildId: string;
    jobId: string;
    error: string;
  }): Promise<RecoveryJobRecord> {
    const now = new Date();
    const [record] = await this.database.db
      .update(recoveryJobs)
      .set({ status: 'FAILED', error: input.error, completedAt: now, updatedAt: now })
      .where(and(eq(recoveryJobs.guildId, input.guildId), eq(recoveryJobs.id, input.jobId)))
      .returning();
    if (!record) throw new Error('Recovery job not found in guild');
    return record;
  }

  public async getRecoveryJob(
    guildId: string,
    jobId: string,
  ): Promise<RecoveryJobRecord | null> {
    const [record] = await this.database.db
      .select()
      .from(recoveryJobs)
      .where(and(eq(recoveryJobs.guildId, guildId), eq(recoveryJobs.id, jobId)))
      .limit(1);
    return record ?? null;
  }
}
