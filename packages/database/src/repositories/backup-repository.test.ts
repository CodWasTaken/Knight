import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, createDatabase } from '../client.js';
import { applyMigrations } from '../migrations.js';
import { GuildRepository } from './guild-repository.js';
import { BackupRepository } from './backup-repository.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';
const database = createDatabase(databaseUrl);
const guilds = new GuildRepository(database);
const backups = new BackupRepository(database);

describe('backup persistence', () => {
  beforeAll(async () => {
    await applyMigrations(database);
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE guilds CASCADE');
    await guilds.createOrUpdateOwner('g1', 'owner-1');
    await guilds.createOrUpdateOwner('g2', 'owner-2');
    await guilds.createOrUpdateOwner('g3', 'owner-3');
  });

  afterAll(async () => closeDatabase(database));

  it('distinguishes an explicit Disabled policy from an unconfigured guild', async () => {
    expect(await backups.getPolicy('g1')).toBeNull();

    await backups.savePolicy({
      guildId: 'g1',
      mode: 'DISABLED',
      archiveChannelIds: [],
      updatedBy: 'owner-1',
    });

    expect(await backups.getPolicy('g1')).toMatchObject({
      guildId: 'g1',
      mode: 'DISABLED',
      archiveChannelIds: [],
      maxMessagesPerChannel: 1000,
      updatedBy: 'owner-1',
    });
    expect(await backups.getPolicy('g2')).toBeNull();
  });

  it('persists selected archive channels and defaults the per-channel cap to 1000', async () => {
    await backups.savePolicy({
      guildId: 'g1',
      mode: 'DAILY',
      archiveChannelIds: ['channel-1', 'channel-2'],
      updatedBy: 'owner-1',
    });

    expect(await backups.getPolicy('g1')).toMatchObject({
      mode: 'DAILY',
      archiveChannelIds: ['channel-1', 'channel-2'],
      maxMessagesPerChannel: 1000,
    });
  });

  it('claims pending backups one at a time and marks them Running', async () => {
    const first = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    const second = await backups.enqueueBackup({ guildId: 'g2', requestedBy: 'owner-2' });

    const claimedFirst = await backups.claimPendingBackup();
    const claimedSecond = await backups.claimPendingBackup();

    expect(claimedFirst).toMatchObject({ status: 'RUNNING' });
    expect(claimedSecond).toMatchObject({ status: 'RUNNING' });
    expect(new Set([claimedFirst?.id, claimedSecond?.id])).toEqual(new Set([first.id, second.id]));
    expect(await backups.claimPendingBackup()).toBeNull();
  });

  it('selects only Daily policies that do not already have a current backup job', async () => {
    await backups.savePolicy({ guildId: 'g1', mode: 'DAILY', archiveChannelIds: [], updatedBy: 'owner-1' });
    await backups.savePolicy({ guildId: 'g2', mode: 'DAILY', archiveChannelIds: [], updatedBy: 'owner-2' });
    await backups.savePolicy({ guildId: 'g3', mode: 'MANUAL', archiveChannelIds: [], updatedBy: 'owner-3' });

    const now = new Date();
    expect((await backups.listDueDailyPolicies(now)).map((policy) => policy.guildId)).toEqual(['g1', 'g2']);

    await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'SYSTEM' });

    expect((await backups.listDueDailyPolicies(now)).map((policy) => policy.guildId)).toEqual(['g2']);
  });

  it('persists backup completion and failure metadata without deleting earlier good backups', async () => {
    const good = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({
      guildId: 'g1',
      backupId: good.id,
      relativePath: 'g1/good.json.gz',
      sha256: 'a'.repeat(64),
    });
    const failed = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.failBackup({ guildId: 'g1', backupId: failed.id, error: 'capture failed' });

    expect(await backups.getBackup('g1', good.id)).toMatchObject({
      status: 'COMPLETED',
      relativePath: 'g1/good.json.gz',
      sha256: 'a'.repeat(64),
      error: null,
    });
    expect(await backups.getBackup('g1', failed.id)).toMatchObject({
      status: 'FAILED',
      error: 'capture failed',
    });
    expect((await backups.listBackups('g1')).map((backup) => backup.id)).toContain(good.id);
  });

  it('moves restore jobs from preview through owner confirmation to execution', async () => {
    const backup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({
      guildId: 'g1',
      backupId: backup.id,
      relativePath: 'g1/backup.json.gz',
      sha256: 'b'.repeat(64),
    });

    const job = await backups.enqueueRestorePreview({ guildId: 'g1', backupId: backup.id, requestedBy: 'manager-1' });
    expect(job).toMatchObject({ phase: 'PREVIEW', status: 'PENDING', confirmedBy: null });

    expect(await backups.claimPendingRestore()).toMatchObject({ id: job.id, phase: 'PREVIEW', status: 'RUNNING' });
    await backups.saveRestorePreview({ guildId: 'g1', jobId: job.id, preview: { operations: [] } });
    expect(await backups.getRecoveryJob('g1', job.id)).toMatchObject({ phase: 'PREVIEW', status: 'PREVIEW_READY' });

    await backups.confirmRestore({ guildId: 'g1', jobId: job.id, confirmedBy: 'owner-1' });
    expect(await backups.getRecoveryJob('g1', job.id)).toMatchObject({
      phase: 'EXECUTION',
      status: 'PENDING',
      confirmedBy: 'owner-1',
    });
    expect(await backups.claimPendingRestore()).toMatchObject({ id: job.id, phase: 'EXECUTION', status: 'RUNNING' });
  });

  it('keeps backup and recovery records isolated by guild', async () => {
    const backup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({
      guildId: 'g1',
      backupId: backup.id,
      relativePath: 'g1/backup.json.gz',
      sha256: 'c'.repeat(64),
    });
    const job = await backups.enqueueRestorePreview({ guildId: 'g1', backupId: backup.id, requestedBy: 'owner-1' });

    expect(await backups.getBackup('g2', backup.id)).toBeNull();
    expect(await backups.getRecoveryJob('g2', job.id)).toBeNull();
    await expect(
      backups.enqueueRestorePreview({ guildId: 'g2', backupId: backup.id, requestedBy: 'owner-2' }),
    ).rejects.toThrow('Backup not found in guild');
  });

  it('lists recent recovery jobs newest-first and scoped to the guild', async () => {
    const firstBackup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({ guildId: 'g1', backupId: firstBackup.id, relativePath: 'g1/one.json.gz', sha256: 'e'.repeat(64) });
    const first = await backups.enqueueRestorePreview({ guildId: 'g1', backupId: firstBackup.id, requestedBy: 'owner-1' });
    const secondBackup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({ guildId: 'g1', backupId: secondBackup.id, relativePath: 'g1/two.json.gz', sha256: 'f'.repeat(64) });
    const second = await backups.enqueueRestorePreview({ guildId: 'g1', backupId: secondBackup.id, requestedBy: 'owner-1' });

    const otherBackup = await backups.enqueueBackup({ guildId: 'g2', requestedBy: 'owner-2' });
    await backups.completeBackup({ guildId: 'g2', backupId: otherBackup.id, relativePath: 'g2/one.json.gz', sha256: '0'.repeat(64) });
    await backups.enqueueRestorePreview({ guildId: 'g2', backupId: otherBackup.id, requestedBy: 'owner-2' });

    expect((await backups.listRecoveryJobs('g1', 2)).map((job) => job.id)).toEqual([second.id, first.id]);
  });

  it('finds an active recovery job only within the requested guild', async () => {
    const backup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({
      guildId: 'g1', backupId: backup.id, relativePath: 'g1/active.json.gz', sha256: 'e'.repeat(64),
    });
    const job = await backups.enqueueRestorePreview({ guildId: 'g1', backupId: backup.id, requestedBy: 'owner-1' });

    expect(await backups.getActiveRecoveryJob('g1')).toMatchObject({ id: job.id, status: 'PENDING' });
    expect(await backups.getActiveRecoveryJob('g2')).toBeNull();
  });

  it('persists restore checkpoints and the failure that stopped execution', async () => {
    const backup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({
      guildId: 'g1',
      backupId: backup.id,
      relativePath: 'g1/backup.json.gz',
      sha256: 'd'.repeat(64),
    });
    const job = await backups.enqueueRestorePreview({ guildId: 'g1', backupId: backup.id, requestedBy: 'owner-1' });
    await backups.claimPendingRestore();
    await backups.saveRestorePreview({ guildId: 'g1', jobId: job.id, preview: { operations: [] } });
    await backups.confirmRestore({ guildId: 'g1', jobId: job.id, confirmedBy: 'owner-1' });
    await backups.claimPendingRestore();

    const checkpoint = { nextOperationIndex: 3, roleIdMap: { oldRole: 'newRole' } };
    await backups.updateRestoreCheckpoint({ guildId: 'g1', jobId: job.id, checkpoint });
    await backups.failRestore({ guildId: 'g1', jobId: job.id, error: 'Discord write failed' });

    expect(await backups.getRecoveryJob('g1', job.id)).toMatchObject({
      status: 'FAILED',
      checkpoint,
      error: 'Discord write failed',
    });
  });
  it('retries failed execution from its durable checkpoint and marks completion', async () => {
    const backup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.completeBackup({
      guildId: 'g1', backupId: backup.id, relativePath: 'g1/retry.json.gz', sha256: '9'.repeat(64),
    });
    const job = await backups.enqueueRestorePreview({ guildId: 'g1', backupId: backup.id, requestedBy: 'owner-1' });
    await backups.claimPendingRestore();
    await backups.saveRestorePreview({ guildId: 'g1', jobId: job.id, preview: { operations: [] } });
    await backups.confirmRestore({ guildId: 'g1', jobId: job.id, confirmedBy: 'owner-1' });
    await backups.claimPendingRestore();
    const checkpoint = { nextOperationIndex: 4, roleIdMap: { old: 'new' }, channelIdMap: {} };
    await backups.updateRestoreCheckpoint({ guildId: 'g1', jobId: job.id, checkpoint });
    await backups.failRestore({ guildId: 'g1', jobId: job.id, error: 'write failed' });

    expect(await backups.getRecoveryJobById(job.id)).toMatchObject({ guildId: 'g1', status: 'FAILED' });
    await backups.retryRestore({ guildId: 'g1', jobId: job.id });
    expect(await backups.getRecoveryJob('g1', job.id)).toMatchObject({
      phase: 'EXECUTION', status: 'PENDING', confirmedBy: 'owner-1', checkpoint, error: null,
    });
    await backups.claimPendingRestore();
    await backups.completeRestore({ guildId: 'g1', jobId: job.id });
    expect(await backups.getRecoveryJob('g1', job.id)).toMatchObject({ status: 'COMPLETED', error: null });
  });


  it('recovers interrupted jobs safely after a worker restart', async () => {
    const runningBackup = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'owner-1' });
    await backups.claimPendingBackup();

    const previewBackup = await backups.enqueueBackup({ guildId: 'g2', requestedBy: 'owner-2' });
    await backups.completeBackup({ guildId: 'g2', backupId: previewBackup.id, relativePath: 'g2/preview.json.gz', sha256: '7'.repeat(64) });
    const preview = await backups.enqueueRestorePreview({ guildId: 'g2', backupId: previewBackup.id, requestedBy: 'owner-2' });
    await backups.claimPendingRestore();

    const executionBackup = await backups.enqueueBackup({ guildId: 'g3', requestedBy: 'owner-3' });
    await backups.completeBackup({ guildId: 'g3', backupId: executionBackup.id, relativePath: 'g3/execution.json.gz', sha256: '8'.repeat(64) });
    const execution = await backups.enqueueRestorePreview({ guildId: 'g3', backupId: executionBackup.id, requestedBy: 'owner-3' });
    await backups.claimPendingRestore();
    await backups.saveRestorePreview({ guildId: 'g3', jobId: execution.id, preview: { operations: [] } });
    await backups.confirmRestore({ guildId: 'g3', jobId: execution.id, confirmedBy: 'owner-3' });
    await backups.claimPendingRestore();
    const checkpoint = { nextOperationIndex: 2, roleIdMap: { old: 'new' }, channelIdMap: {} };
    await backups.updateRestoreCheckpoint({ guildId: 'g3', jobId: execution.id, checkpoint });

    await backups.recoverInterruptedJobs(new Date('2026-09-13T12:00:00.000Z'));

    expect(await backups.getBackup('g1', runningBackup.id)).toMatchObject({ status: 'PENDING', startedAt: null });
    expect(await backups.getRecoveryJob('g2', preview.id)).toMatchObject({ phase: 'PREVIEW', status: 'PENDING', startedAt: null });
    expect(await backups.getRecoveryJob('g3', execution.id)).toMatchObject({
      phase: 'EXECUTION',
      status: 'FAILED',
      checkpoint,
      error: 'Recovery execution interrupted by worker restart; owner retry required.',
    });
  });


  it('backs off failed Daily backup attempts before retrying', async () => {
    await backups.savePolicy({ guildId: 'g1', mode: 'DAILY', archiveChannelIds: [], updatedBy: 'owner-1' });
    const failed = await backups.enqueueBackup({ guildId: 'g1', requestedBy: 'SYSTEM' });
    await backups.failBackup({ guildId: 'g1', backupId: failed.id, error: 'Discord capture failed' });
    const failedRecord = await backups.getBackup('g1', failed.id);
    if (failedRecord === null) throw new Error('Failed backup missing');

    const beforeBackoff = new Date(failedRecord.updatedAt.getTime() + 59 * 60_000);
    const afterBackoff = new Date(failedRecord.updatedAt.getTime() + 61 * 60_000);

    expect(await backups.listDueDailyPolicies(beforeBackoff)).toEqual([]);
    expect((await backups.listDueDailyPolicies(afterBackoff)).map((policy) => policy.guildId)).toContain('g1');
  });

});
