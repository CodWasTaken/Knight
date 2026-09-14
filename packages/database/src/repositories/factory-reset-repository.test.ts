import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../client.js';
import { applyMigrations } from '../migrations.js';
import { users } from '../schema/index.js';
import { BackupRepository } from './backup-repository.js';
import { FactoryResetRepository } from './factory-reset-repository.js';
import { GuildRepository } from './guild-repository.js';
import { SecurityLedgerRepository } from './security-ledger-repository.js';
import { StaffRepository } from './staff-repository.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';
const database = createDatabase(databaseUrl);
const guilds = new GuildRepository(database);
const backups = new BackupRepository(database);
const resets = new FactoryResetRepository(database);

describe('factory reset persistence', () => {
  beforeAll(async () => applyMigrations(database));
  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE guilds, users CASCADE');
    await guilds.createOrUpdateOwner('g1', 'owner-1');
    await guilds.createOrUpdateOwner('g2', 'owner-2');
  });
  afterAll(async () => closeDatabase(database));

  it('allows only one active reset and recovers interrupted work', async () => {
    const queued = await resets.enqueue({ guildId: 'g1', requestedBy: 'owner-1' });
    await expect(resets.enqueue({ guildId: 'g1', requestedBy: 'owner-1' })).rejects.toThrow('active');
    expect(await resets.claimPending()).toMatchObject({ id: queued.id, status: 'RUNNING' });
    await resets.recoverInterrupted(new Date('2026-09-14T12:00:00Z'));
    expect(await resets.getActive('g1')).toMatchObject({ id: queued.id, status: 'PENDING' });
  });

  it('serializes reset enqueue against active backup and recovery work', async () => {
    const backup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await expect(resets.enqueue({ guildId: 'g1', requestedBy: 'owner-1' })).rejects.toThrow('backup or recovery');
    await backups.failBackup({ guildId: 'g1', backupId: backup.id, error: 'test' });
    const complete = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({ guildId: 'g1', backupId: complete.id, relativePath: 'g1/a', sha256: 'a'.repeat(64) });
    await backups.enqueueRestorePreview({ guildId: 'g1', backupId: complete.id, requestedBy: 'owner-1' });
    await expect(resets.enqueue({ guildId: 'g1', requestedBy: 'owner-1' })).rejects.toThrow('backup or recovery');
  });

  it('rejects new backup and restore transitions while reset is active', async () => {
    const existing = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({ guildId: 'g1', backupId: existing.id, relativePath: 'g1/a', sha256: 'a'.repeat(64) });
    const preview = await backups.enqueueRestorePreview({ guildId: 'g1', backupId: existing.id, requestedBy: 'owner-1' });
    await backups.claimPendingRestore();
    await backups.saveRestorePreview({ guildId: 'g1', jobId: preview.id, preview: {} });
    await database.pool.query("UPDATE recovery_jobs SET status = 'COMPLETED' WHERE id = $1", [preview.id]);
    await resets.enqueue({ guildId: 'g1', requestedBy: 'owner-1' });
    await expect(backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' })).rejects.toThrow('factory reset');
    await expect(backups.enqueueRestorePreview({ guildId: 'g1', backupId: existing.id, requestedBy: 'owner-1' })).rejects.toThrow('factory reset');
    await database.pool.query("UPDATE recovery_jobs SET status = 'PREVIEW_READY' WHERE id = $1", [preview.id]);
    await expect(backups.confirmRestore({ guildId: 'g1', jobId: preview.id, confirmedBy: 'owner-1' })).rejects.toThrow('factory reset');
  });

  it('wipes guild Knight state but preserves owner, fresh setup, auth users, and other guilds', async () => {
    await database.db.insert(users).values({ id: 'auth-user', email: 'owner@example.test' });
    const staff = new StaffRepository(database);
    await staff.createProfileWithInitialVersion({ guildId: 'g1', name: 'Mod', discordRoleId: 'role-1', rank: 1, permissions: [], actionPolicies: {}, createdBy: 'owner-1' });
    await new SecurityLedgerRepository(database).saveLoggingSettings({ guildId: 'g1', securityChannelId: 's', moderationChannelId: 'm', messageChannelId: 'x', voiceChannelId: 'v', storeDeletedMessageContent: true, updatedBy: 'owner-1' });
    await guilds.updateSetupState('g1', 'COMPLETE', ['WELCOME', 'HEALTH', 'STAFF', 'POLICIES', 'LOGGING', 'PROTECTION', 'BACKUPS', 'COMPLETE']);
    const job = await resets.enqueue({ guildId: 'g1', requestedBy: 'owner-1' });
    await resets.claimPending();

    await resets.resetGuildKnightState({ guildId: 'g1', resetJobId: job.id });
    await resets.complete({ guildId: 'g1', resetJobId: job.id });

    expect(await guilds.get('g1')).toMatchObject({ ownerId: 'owner-1', mode: 'OBSERVE' });
    expect(await guilds.getSetupState('g1')).toMatchObject({ step: 'WELCOME', completedSteps: [] });
    expect(await new SecurityLedgerRepository(database).getLoggingSettings('g1')).toBeNull();
    expect((await database.pool.query('SELECT id FROM staff_profiles WHERE guild_id = $1', ['g1'])).rowCount).toBe(0);
    expect((await database.pool.query('SELECT id FROM users WHERE id = $1', ['auth-user'])).rowCount).toBe(1);
    expect(await guilds.get('g2')).toMatchObject({ ownerId: 'owner-2' });
    expect(await resets.getLatest('g1')).toMatchObject({ id: job.id, status: 'COMPLETED' });
  });

  it('is retry-safe for the same reset job', async () => {
    const job = await resets.enqueue({ guildId: 'g1', requestedBy: 'owner-1' });
    await resets.claimPending();
    await resets.resetGuildKnightState({ guildId: 'g1', resetJobId: job.id });
    await resets.resetGuildKnightState({ guildId: 'g1', resetJobId: job.id });
    expect(await guilds.getSetupState('g1')).toMatchObject({ step: 'WELCOME', completedSteps: [] });
  });

  it('preserves the current stored Discord owner when ownership changes after enqueue', async () => {
    const job = await resets.enqueue({ guildId: 'g1', requestedBy: 'owner-1' });
    await resets.claimPending();
    await guilds.createOrUpdateOwner('g1', 'owner-new');
    await resets.resetGuildKnightState({ guildId: 'g1', resetJobId: job.id });
    expect(await guilds.get('g1')).toMatchObject({ ownerId: 'owner-new' });
  });
});
