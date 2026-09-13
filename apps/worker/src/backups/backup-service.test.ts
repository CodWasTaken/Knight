import { describe, expect, it, vi } from 'vitest';
import { BackupService } from './backup-service.js';

function makeJob(overrides: Record<string, unknown> = {}) {
  return { id: 'backup-1', guildId: '100', requestedBy: 'owner', status: 'RUNNING', ...overrides } as never;
}

function makeService(options: { archiveEnabled?: boolean; policy?: unknown; captureError?: Error } = {}) {
  const backups = {
    recoverInterruptedJobs: vi.fn().mockResolvedValue(undefined),
    listDueDailyPolicies: vi.fn().mockResolvedValue([]),
    enqueueBackup: vi.fn().mockResolvedValue(makeJob({ status: 'PENDING' })),
    claimPendingBackup: vi.fn().mockResolvedValue(makeJob()),
    completeBackup: vi.fn().mockResolvedValue(makeJob({ status: 'COMPLETED' })),
    failBackup: vi.fn().mockResolvedValue(makeJob({ status: 'FAILED' })),
    getPolicy: vi.fn().mockResolvedValue(options.policy ?? null),
  };
  const discord = {
    captureGuild: options.captureError
      ? vi.fn().mockRejectedValue(options.captureError)
      : vi.fn().mockResolvedValue({ guildId: '100', roles: [{ id: 'role-1' }], channels: [] }),
    fetchChannelMessages: vi.fn().mockResolvedValue([{ id: 'message-1', authorId: 'user-1' }]),
  };
  const staff = {
    listProfiles: vi.fn().mockResolvedValue([
      { id: 'profile-1', discordRoleId: 'role-1', currentVersionId: 'version-3' },
    ]),
  };
  const ledger = {
    getLoggingSettings: vi.fn().mockResolvedValue({
      securityChannelId: 'security-log',
      moderationChannelId: null,
    }),
  };
  const security = {
    listProtectedResources: vi.fn().mockResolvedValue([
      { resourceType: 'CHANNEL', resourceId: 'channel-9', level: 'CRITICAL' },
    ]),
  };
  const storage = {
    write: vi.fn().mockResolvedValue({ relativePath: '100/backup-1.json.gz', sha256: 'a'.repeat(64) }),
  };
  const restore = { processNextPendingRestore: vi.fn().mockResolvedValue(false) };
  return {
    service: new BackupService({
      backups,
      discord,
      staff,
      ledger,
      security,
      storage,
      restore,
      archiveEnabled: options.archiveEnabled ?? false,
      now: () => new Date('2026-09-12T12:00:00.000Z'),
    }),
    backups,
    discord,
    storage,
    security,
    restore,
  };
}

describe('BackupService', () => {
  it('recovers interrupted jobs using the worker clock', async () => {
    const { service, backups } = makeService();

    await service.recoverInterruptedJobs();

    expect(backups.recoverInterruptedJobs).toHaveBeenCalledWith(
      new Date('2026-09-12T12:00:00.000Z'),
    );
  });

  it('enqueues each Daily policy currently due', async () => {
    const { service, backups } = makeService();
    backups.listDueDailyPolicies.mockResolvedValue([{ guildId: '100' }, { guildId: '200' }]);
    const now = new Date('2026-09-12T12:00:00.000Z');

    await service.runDueDaily(now);

    expect(backups.listDueDailyPolicies).toHaveBeenCalledWith(now);
    expect(backups.enqueueBackup).toHaveBeenCalledTimes(2);
    expect(backups.enqueueBackup).toHaveBeenCalledWith({ guildId: '100', requestedBy: 'SYSTEM' });
    expect(backups.enqueueBackup).toHaveBeenCalledWith({ guildId: '200', requestedBy: 'SYSTEM' });
  });

  it('captures Discord structure plus Knight recovery references and completes the backup', async () => {
    const { service, backups, storage } = makeService();

    await expect(service.processNextPendingBackup()).resolves.toBe(true);

    expect(storage.write).toHaveBeenCalledWith(
      '100',
      'backup-1',
      expect.objectContaining({
        version: 1,
        guildId: '100',
        createdAt: '2026-09-12T12:00:00.000Z',
        discord: expect.objectContaining({ guildId: '100' }),
        knight: {
          staffProfiles: [{ profileId: 'profile-1', discordRoleId: 'role-1', profileVersionId: 'version-3' }],
          logging: { securityChannelId: 'security-log', moderationChannelId: null },
          protectedResources: [{ resourceType: 'CHANNEL', resourceId: 'channel-9', level: 'CRITICAL' }],
        },
        messageArchives: [],
      }),
    );
    expect(backups.completeBackup).toHaveBeenCalledWith({
      guildId: '100',
      backupId: 'backup-1',
      relativePath: '100/backup-1.json.gz',
      sha256: 'a'.repeat(64),
    });
  });

  it('archives only selected channels up to the configured cap when opt-in is enabled', async () => {
    const { service, discord, storage } = makeService({
      archiveEnabled: true,
      policy: { archiveChannelIds: ['channel-1'], maxMessagesPerChannel: 1000 },
    });

    await service.processNextPendingBackup();

    expect(discord.fetchChannelMessages).toHaveBeenCalledTimes(1);
    expect(discord.fetchChannelMessages).toHaveBeenCalledWith('channel-1', 1000);
    expect(storage.write).toHaveBeenCalledWith(
      '100',
      'backup-1',
      expect.objectContaining({
        messageArchives: [{ channelId: 'channel-1', messages: [{ id: 'message-1', authorId: 'user-1' }] }],
      }),
    );
  });

  it('fails safely when a policy requests archives but operator opt-in is disabled', async () => {
    const { service, backups, discord, storage } = makeService({
      policy: { archiveChannelIds: ['channel-1'], maxMessagesPerChannel: 1000 },
    });

    await expect(service.processNextPendingBackup()).resolves.toBe(true);

    expect(discord.captureGuild).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
    expect(backups.failBackup).toHaveBeenCalledWith({
      guildId: '100',
      backupId: 'backup-1',
      error: 'Message archival is not enabled by the operator',
    });
  });

  it('fails safely rather than snapshotting an invalid persisted protection reference', async () => {
    const made = makeService();
    made.security.listProtectedResources.mockResolvedValue([
      { resourceType: 'OTHER', resourceId: 'x', level: 'CRITICAL' },
    ]);

    await made.service.processNextPendingBackup();

    expect(made.backups.failBackup).toHaveBeenCalledWith({
      guildId: '100', backupId: 'backup-1', error: 'Invalid protected resource reference',
    });
  });

  it('marks capture failures Failed without throwing out of the worker tick', async () => {
    const { service, backups } = makeService({ captureError: new Error('Discord unavailable') });

    await expect(service.runTick(new Date('2026-09-12T12:00:00.000Z'))).resolves.toBeUndefined();

    expect(backups.failBackup).toHaveBeenCalledWith({
      guildId: '100',
      backupId: 'backup-1',
      error: 'Discord unavailable',
    });
  });


  it('processes one pending recovery after backup work in each tick', async () => {
    const made = makeService();
    const now = new Date('2026-09-12T12:00:00.000Z');

    await made.service.runTick(now);

    expect(made.restore.processNextPendingRestore).toHaveBeenCalledTimes(1);
  });

  it('returns false when there is no pending backup', async () => {
    const { service, backups } = makeService();
    backups.claimPendingBackup.mockResolvedValue(null);
    await expect(service.processNextPendingBackup()).resolves.toBe(false);
  });
});
