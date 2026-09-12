import type { RestorePreview } from './restore-planner.js';
import { describe, expect, it, vi } from 'vitest';
import { RestoreService } from './restore-service.js';

const snapshot = {
  version: 1 as const,
  guildId: '100',
  createdAt: '2026-09-12T10:00:00.000Z',
  discord: { guildId: '100', roles: [], channels: [] },
  knight: { staffProfiles: [], logging: null, protectedResources: [] },
  messageArchives: [],
};

function runningJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', guildId: '100', backupId: 'backup-1', phase: 'PREVIEW', status: 'RUNNING',
    preview: null, checkpoint: {}, confirmedBy: null, ...overrides,
  } as never;
}

function backupRecord() {
  return {
    id: 'backup-1', guildId: '100', status: 'COMPLETED',
    relativePath: '100/backup-1.json.gz', sha256: 'a'.repeat(64),
  } as never;
}
function makeDependencies() {
  const backups = {
    claimPendingRestore: vi.fn().mockResolvedValue(runningJob()),
    getRecoveryJobById: vi.fn().mockResolvedValue(runningJob()),
    getBackup: vi.fn().mockResolvedValue(backupRecord()),
    saveRestorePreview: vi.fn().mockResolvedValue(runningJob({ status: 'PREVIEW_READY' })),
    updateRestoreCheckpoint: vi.fn().mockResolvedValue(runningJob()),
    failRestore: vi.fn().mockResolvedValue(runningJob({ status: 'FAILED' })),
    completeRestore: vi.fn().mockResolvedValue(runningJob({ status: 'COMPLETED' })),
  };
  const storage = { readVerified: vi.fn().mockResolvedValue(snapshot) };
  const discord = {
    captureGuild: vi.fn().mockResolvedValue(snapshot.discord),
    createRole: vi.fn().mockResolvedValue({ id: 'new-role' }),
    updateRole: vi.fn().mockResolvedValue(undefined),
    setRolePositions: vi.fn().mockResolvedValue(undefined),
    createChannel: vi.fn().mockResolvedValue({ id: 'new-channel' }),
    updateChannel: vi.fn().mockResolvedValue(undefined),
    setChannelPositions: vi.fn().mockResolvedValue(undefined),
    setChannelPermissionOverwrites: vi.fn().mockResolvedValue(undefined),
  };
  const locks = {
    acquire: vi.fn().mockResolvedValue('lock-token'),
    release: vi.fn().mockResolvedValue(true),
  };
  const staff = { remapDiscordRoleForRecovery: vi.fn().mockResolvedValue(undefined) };
  const security = { remapProtectedResourceForRecovery: vi.fn().mockResolvedValue(undefined) };
  const ledger = { remapLoggingChannelForRecovery: vi.fn().mockResolvedValue(undefined) };
  return { backups, storage, discord, locks, staff, security, ledger };
}

function makeService() {
  const dependencies = makeDependencies();
  return { service: new RestoreService(dependencies), ...dependencies };
}

function executionPreview(): RestorePreview {
  return {
    guildId: '100',
    backupCreatedAt: '2026-09-12T10:00:00.000Z',
    operations: [
      {
        kind: 'ROLE', classification: 'RECREATE', sourceId: 'old-role',
        role: {
          id: 'old-role', name: 'Staff', managed: false, permissions: '8', position: 2,
          color: 0, hoist: false, mentionable: false,
        },
      },
      {
        kind: 'CHANNEL', classification: 'RECREATE', sourceId: 'old-channel',
        channel: {
          id: 'old-channel', name: 'general', type: 'TEXT', parentId: null, position: 1,
          permissionOverwrites: [],
        },
      },
      { kind: 'MESSAGE_ARCHIVE', classification: 'ARCHIVE_ONLY', sourceChannelId: 'old-channel', messageCount: 3 },
    ],
  };
}

describe('RestoreService', () => {

  it('claims one pending recovery job and dispatches by phase', async () => {
    const made = makeService();
    const previewSpy = vi.spyOn(made.service, 'processPreviewJob').mockResolvedValueOnce(undefined);

    await expect(made.service.processNextPendingRestore()).resolves.toBe(true);
    expect(previewSpy).toHaveBeenCalledWith('job-1');

    made.backups.claimPendingRestore.mockResolvedValueOnce(runningJob({ phase: 'EXECUTION' }));
    const executionSpy = vi.spyOn(made.service, 'processExecutionJob').mockResolvedValueOnce(undefined);
    await expect(made.service.processNextPendingRestore()).resolves.toBe(true);
    expect(executionSpy).toHaveBeenCalledWith('job-1');

    made.backups.claimPendingRestore.mockResolvedValueOnce(null);
    await expect(made.service.processNextPendingRestore()).resolves.toBe(false);
  });
  it('verifies the stored SHA before using a backup for preview planning', async () => {
    const made = makeService();

    await made.service.processPreviewJob('job-1');

    expect(made.storage.readVerified).toHaveBeenCalledWith(
      '100/backup-1.json.gz',
      'a'.repeat(64),
    );
    expect(made.discord.captureGuild).toHaveBeenCalledWith('100');
    expect(made.storage.readVerified.mock.invocationCallOrder[0]).toBeLessThan(
      made.discord.captureGuild.mock.invocationCallOrder[0]!,
    );
    expect(made.backups.saveRestorePreview).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: '100', jobId: 'job-1' }),
    );
  });

  it('refuses execution when owner confirmation is absent', async () => {
    const made = makeService();
    made.backups.getRecoveryJobById.mockResolvedValueOnce(runningJob({
      phase: 'EXECUTION', preview: executionPreview(), confirmedBy: null,
    }));

    await made.service.processExecutionJob('job-1');

    expect(made.locks.acquire).not.toHaveBeenCalled();
    expect(made.discord.createRole).not.toHaveBeenCalled();
    expect(made.backups.failRestore).toHaveBeenCalledWith({
      guildId: '100', jobId: 'job-1', error: 'Recovery execution requires owner confirmation',
    });
  });

  it('stops immediately on a failed operation and preserves the completed checkpoint', async () => {
    const made = makeService();
    made.backups.getRecoveryJobById.mockResolvedValueOnce(runningJob({
      phase: 'EXECUTION', preview: executionPreview(), confirmedBy: 'owner-1',
    }));
    made.discord.createChannel.mockRejectedValueOnce(new Error('Discord channel create failed'));

    await made.service.processExecutionJob('job-1');

    expect(made.discord.createRole).toHaveBeenCalledTimes(1);
    expect(made.backups.updateRestoreCheckpoint).toHaveBeenCalledWith({
      guildId: '100',
      jobId: 'job-1',
      checkpoint: {
        nextOperationIndex: 1,
        roleIdMap: { 'old-role': 'new-role' },
        channelIdMap: {},
      },
    });
    expect(made.backups.failRestore).toHaveBeenCalledWith({
      guildId: '100', jobId: 'job-1', error: 'Discord channel create failed',
    });
    expect(made.backups.completeRestore).not.toHaveBeenCalled();
    expect(made.locks.release).toHaveBeenCalledWith('recovery:100', 'lock-token');
  });

  it('resumes from the next uncompleted operation and never replays archived messages', async () => {
    const made = makeService();
    made.backups.getRecoveryJobById.mockResolvedValueOnce(runningJob({
      phase: 'EXECUTION', preview: executionPreview(), confirmedBy: 'owner-1',
      checkpoint: {
        nextOperationIndex: 1,
        roleIdMap: { 'old-role': 'new-role' },
        channelIdMap: {},
      },
    }));

    await made.service.processExecutionJob('job-1');

    expect(made.discord.createRole).not.toHaveBeenCalled();
    expect(made.discord.createChannel).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({ id: 'old-channel' }),
      expect.stringContaining('job-1'),
    );
    expect(made.backups.completeRestore).toHaveBeenCalledWith({ guildId: '100', jobId: 'job-1' });
    expect(made.backups.updateRestoreCheckpoint).toHaveBeenLastCalledWith({
      guildId: '100',
      jobId: 'job-1',
      checkpoint: {
        nextOperationIndex: 3,
        roleIdMap: { 'old-role': 'new-role' },
        channelIdMap: { 'old-channel': 'new-channel' },
      },
    });
  });


  it('does not rewrite Knight references when Discord IDs were not recreated', async () => {
    const made = makeService();
    const preview: RestorePreview = {
      guildId: '100',
      backupCreatedAt: '2026-09-12T10:00:00.000Z',
      operations: [
        {
          kind: 'KNIGHT_STAFF_PROFILE', classification: 'REVERT',
          reference: { profileId: 'profile-1', discordRoleId: 'managed-role', profileVersionId: 'v1' },
        },
        {
          kind: 'KNIGHT_PROTECTED_RESOURCE', classification: 'REVERT',
          reference: { resourceType: 'ROLE', resourceId: 'managed-role', level: 'CRITICAL' },
        },
      ],
    };
    made.backups.getRecoveryJobById.mockResolvedValueOnce(runningJob({
      phase: 'EXECUTION', preview, confirmedBy: 'owner-1',
    }));

    await made.service.processExecutionJob('job-1');

    expect(made.staff.remapDiscordRoleForRecovery).not.toHaveBeenCalled();
    expect(made.security.remapProtectedResourceForRecovery).not.toHaveBeenCalled();
    expect(made.backups.completeRestore).toHaveBeenCalledWith({ guildId: '100', jobId: 'job-1' });
  });

  it('does not execute writes when the per-guild recovery lock is already held', async () => {
    const made = makeService();
    made.backups.getRecoveryJobById.mockResolvedValueOnce(runningJob({
      phase: 'EXECUTION', preview: executionPreview(), confirmedBy: 'owner-1',
    }));
    made.locks.acquire.mockResolvedValueOnce(null);

    await made.service.processExecutionJob('job-1');

    expect(made.locks.acquire).toHaveBeenCalledWith('recovery:100', expect.any(Number));
    expect(made.discord.createRole).not.toHaveBeenCalled();
    expect(made.backups.failRestore).toHaveBeenCalledWith({
      guildId: '100', jobId: 'job-1', error: 'Recovery is already running for this guild',
    });
  });
});
