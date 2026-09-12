import { describe, expect, it, vi } from 'vitest';
import { BackupCommandService } from './backup.js';

function makeDependencies() {
  return {
    guilds: { get: vi.fn().mockResolvedValue({ ownerId: '1' }) },
    managers: { isSecurityManager: vi.fn().mockResolvedValue(false) },
    backups: {
      enqueueBackup: vi.fn().mockResolvedValue({ id: 'backup-1', status: 'PENDING' }),
      listBackups: vi.fn().mockResolvedValue([
        {
          id: 'backup-1', status: 'COMPLETED', createdAt: new Date('2026-09-12T10:00:00Z'),
          completedAt: new Date('2026-09-12T10:00:05Z'), error: null,
        },
      ]),
      getActiveRecoveryJob: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('BackupCommandService', () => {
  it('lets the guild owner enqueue a manual backup without doing filesystem work', async () => {
    const deps = makeDependencies();
    const service = new BackupCommandService(deps);

    const result = await service.create({ guildId: '100', actorUserId: '1' });

    expect(deps.backups.enqueueBackup).toHaveBeenCalledWith({
      guildId: '100', requestedBy: '1',
    });
    expect(result.content).toContain('backup-1');
    expect(result.content).toContain('PENDING');
  });

  it('lets an explicit Security Manager create and read backup status', async () => {
    const deps = makeDependencies();
    deps.guilds.get.mockResolvedValueOnce({ ownerId: 'owner' });
    deps.managers.isSecurityManager.mockResolvedValue(true);
    const service = new BackupCommandService(deps);

    await service.create({ guildId: '100', actorUserId: 'manager' });
    const result = await service.status({ guildId: '100', actorUserId: 'manager' });

    expect(deps.managers.isSecurityManager).toHaveBeenCalledWith('100', 'manager');
    expect(result.content).toContain('Latest backup: backup-1 — COMPLETED');
    expect(result.content).toContain('2026-09-12T10:00:05.000Z');
  });

  it('denies an actor who is neither owner nor Security Manager', async () => {
    const deps = makeDependencies();
    deps.guilds.get.mockResolvedValue({ ownerId: 'owner' });
    const service = new BackupCommandService(deps);

    await expect(service.create({ guildId: '100', actorUserId: 'outsider' })).rejects.toMatchObject({
      code: 'BACKUP_ACCESS_DENIED',
    });
    expect(deps.backups.enqueueBackup).not.toHaveBeenCalled();
  });

  it('reports an active recovery job from Postgres status data', async () => {
    const deps = makeDependencies();
    deps.backups.getActiveRecoveryJob.mockResolvedValue({
      id: 'restore-1', phase: 'PREVIEW', status: 'PREVIEW_READY',
      updatedAt: new Date('2026-09-12T11:00:00Z'),
    });
    const service = new BackupCommandService(deps);

    const result = await service.status({ guildId: '100', actorUserId: '1' });

    expect(deps.backups.listBackups).toHaveBeenCalledWith('100', 1);
    expect(deps.backups.getActiveRecoveryJob).toHaveBeenCalledWith('100');
    expect(result.content).toContain('Active recovery: restore-1 — PREVIEW/PREVIEW_READY');
  });

  it('reports empty backup state without inventing recovery activity', async () => {
    const deps = makeDependencies();
    deps.backups.listBackups.mockResolvedValue([]);
    const service = new BackupCommandService(deps);

    const result = await service.status({ guildId: '100', actorUserId: '1' });
    expect(result.content).toContain('Latest backup: none');
    expect(result.content).toContain('Active recovery: none');
  });
});