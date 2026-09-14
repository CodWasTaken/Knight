import type {
  DiscordStructuralChannel,
  DiscordStructuralPermissionOverwrite,
  DiscordStructuralRole,
  StructuralBackupPayload,
} from '@knight/contracts';
import {
  planRestore,
  type RestoreOperation,
  type RestorePreview,
} from './restore-planner.js';

const RECOVERY_LOCK_TTL_MS = 5 * 60_000;

type RecoveryJob = Readonly<{
  id: string;
  guildId: string;
  backupId: string;
  phase: string;
  status: string;
  preview: unknown;
  checkpoint: unknown;
  confirmedBy: string | null;
}>;

type BackupRecord = Readonly<{
  status: string;
  relativePath: string | null;
  sha256: string | null;
}>;
type RecreateGuard = Readonly<{
  kind: 'ROLE' | 'CATEGORY' | 'CHANNEL';
  sourceId: string;
  knownIds: readonly string[];
  markerName: string;
}>;
type RestoreCheckpoint = Readonly<{
  nextOperationIndex: number;
  roleIdMap: Readonly<Record<string, string>>;
  channelIdMap: Readonly<Record<string, string>>;
  recreateGuard?: RecreateGuard;
}>;

type RestoreDependencies = Readonly<{
  backups: {
    claimPendingRestore(): Promise<RecoveryJob | null>;
    getRecoveryJobById(jobId: string): Promise<RecoveryJob | null>;
    getBackup(guildId: string, backupId: string): Promise<BackupRecord | null>;
    saveRestorePreview(input: {
      guildId: string;
      jobId: string;
      preview: Record<string, unknown>;
    }): Promise<unknown>;
    updateRestoreCheckpoint(input: {
      guildId: string;
      jobId: string;
      checkpoint: Record<string, unknown>;
    }): Promise<unknown>;
    failRestore(input: { guildId: string; jobId: string; error: string }): Promise<unknown>;
    completeRestore(input: { guildId: string; jobId: string }): Promise<unknown>;
  };
  storage: {
    readVerified<T>(relativePath: string, expectedSha256: string): Promise<T>;
  };
  discord: {
    captureGuild(guildId: string): Promise<StructuralBackupPayload['discord']>;
    createRole(guildId: string, role: DiscordStructuralRole, reason: string): Promise<{ id: string }>;
    updateRole(guildId: string, roleId: string, role: DiscordStructuralRole, reason: string): Promise<void>;
    setRolePositions(guildId: string, positions: readonly { id: string; position: number }[], reason: string): Promise<void>;
    createChannel(guildId: string, channel: DiscordStructuralChannel, reason: string): Promise<{ id: string }>;
    updateChannel(channelId: string, channel: DiscordStructuralChannel, reason: string): Promise<void>;
    setChannelPositions(guildId: string, positions: readonly { id: string; position: number; parentId: string | null }[], reason: string): Promise<void>;
    setChannelPermissionOverwrites(channelId: string, overwrites: readonly DiscordStructuralPermissionOverwrite[], reason: string): Promise<void>;
  };
  locks: {
    acquire(key: string, ttlMs: number): Promise<string | null>;
    release(key: string, token: string): Promise<boolean>;
  };
  staff: {
    remapDiscordRoleForRecovery(input: Record<string, string>): Promise<unknown>;
  };
  security: {
    remapProtectedResourceForRecovery(input: Record<string, string>): Promise<unknown>;
  };
  ledger: {
    remapLoggingChannelForRecovery(input: Record<string, string>): Promise<unknown>;
  };
}>;
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Recovery failed';
}

function asPreview(value: unknown): RestorePreview {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('guildId' in value) ||
    !('backupCreatedAt' in value) ||
    !('operations' in value) ||
    !Array.isArray(value.operations)
  ) {
    throw new Error('Recovery preview is missing or invalid');
  }
  return value as RestorePreview;
}

function asCheckpoint(value: unknown): RestoreCheckpoint {
  if (value === null || typeof value !== 'object') {
    return { nextOperationIndex: 0, roleIdMap: {}, channelIdMap: {} };
  }
  const checkpoint = value as Partial<RestoreCheckpoint>;
  const normalized = {
    nextOperationIndex: Number.isInteger(checkpoint.nextOperationIndex)
      ? Math.max(0, checkpoint.nextOperationIndex ?? 0)
      : 0,
    roleIdMap: checkpoint.roleIdMap ?? {},
    channelIdMap: checkpoint.channelIdMap ?? {},
  };
  return checkpoint.recreateGuard === undefined
    ? normalized
    : { ...normalized, recreateGuard: checkpoint.recreateGuard };
}
function roleId(sourceId: string, checkpoint: RestoreCheckpoint): string {
  return checkpoint.roleIdMap[sourceId] ?? sourceId;
}

function channelId(sourceId: string, checkpoint: RestoreCheckpoint): string {
  return checkpoint.channelIdMap[sourceId] ?? sourceId;
}

function remapChannel(
  channel: DiscordStructuralChannel,
  checkpoint: RestoreCheckpoint,
): DiscordStructuralChannel {
  return {
    ...channel,
    parentId: channel.parentId === null ? null : channelId(channel.parentId, checkpoint),
  };
}

function remapOverwrites(
  overwrites: readonly DiscordStructuralPermissionOverwrite[],
  checkpoint: RestoreCheckpoint,
): readonly DiscordStructuralPermissionOverwrite[] {
  return overwrites.map((overwrite) => ({
    ...overwrite,
    id: overwrite.type === 'ROLE' ? roleId(overwrite.id, checkpoint) : overwrite.id,
  }));
}

function nextCheckpoint(
  checkpoint: RestoreCheckpoint,
  nextOperationIndex: number,
  maps: Partial<Pick<RestoreCheckpoint, 'roleIdMap' | 'channelIdMap'>> = {},
): RestoreCheckpoint {
  return {
    nextOperationIndex,
    roleIdMap: maps.roleIdMap ?? checkpoint.roleIdMap,
    channelIdMap: maps.channelIdMap ?? checkpoint.channelIdMap,
  };
}

function auditReason(jobId: string, operation: RestoreOperation): string {
  return `Knight recovery ${jobId}: ${operation.kind}`;
}

function recreateMarkerName(jobId: string, sourceId: string): string {
  return `knight-recovery-${jobId}-${sourceId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
}

export class RestoreService {
  public constructor(private readonly dependencies: RestoreDependencies) {}

  public async processNextPendingRestore(): Promise<boolean> {
    const job = await this.dependencies.backups.claimPendingRestore();
    if (job === null) return false;
    if (job.phase === 'PREVIEW') {
      await this.processPreviewJob(job.id);
      return true;
    }
    if (job.phase === 'EXECUTION') {
      await this.processExecutionJob(job.id);
      return true;
    }
    await this.dependencies.backups.failRestore({
      guildId: job.guildId,
      jobId: job.id,
      error: 'Recovery job phase is invalid',
    });
    return true;
  }

  private async getJob(jobId: string): Promise<RecoveryJob> {
    const job = await this.dependencies.backups.getRecoveryJobById(jobId);
    if (job === null) throw new Error('Recovery job not found');
    return job;
  }

  private async getBackup(job: RecoveryJob): Promise<{ relativePath: string; sha256: string }> {
    const backup = await this.dependencies.backups.getBackup(job.guildId, job.backupId);
    if (
      backup === null ||
      backup.status !== 'COMPLETED' ||
      backup.relativePath === null ||
      backup.sha256 === null
    ) {
      throw new Error('Recovery backup is not complete');
    }
    return { relativePath: backup.relativePath, sha256: backup.sha256 };
  }

  public async processPreviewJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job.phase !== 'PREVIEW' || job.status !== 'RUNNING') {
      throw new Error('Recovery preview job is not running');
    }

    try {
      const backup = await this.getBackup(job);
      const snapshot = await this.dependencies.storage.readVerified<StructuralBackupPayload>(
        backup.relativePath,
        backup.sha256,
      );
      const current = await this.dependencies.discord.captureGuild(job.guildId);
      const preview = planRestore(snapshot, current);
      await this.dependencies.backups.saveRestorePreview({
        guildId: job.guildId,
        jobId: job.id,
        preview: preview as unknown as Record<string, unknown>,
      });
    } catch (error) {
      await this.dependencies.backups.failRestore({
        guildId: job.guildId,
        jobId: job.id,
        error: errorMessage(error),
      });
    }
  }

  private async prepareRecreateGuard(
    job: RecoveryJob,
    kind: RecreateGuard['kind'],
    sourceId: string,
    checkpoint: RestoreCheckpoint,
  ): Promise<Readonly<{ checkpoint: RestoreCheckpoint; current: StructuralBackupPayload['discord'] }>> {
    const current = await this.dependencies.discord.captureGuild(job.guildId);
    if (checkpoint.recreateGuard !== undefined) {
      if (
        checkpoint.recreateGuard.kind !== kind ||
        checkpoint.recreateGuard.sourceId !== sourceId
      ) {
        throw new Error('Recovery recreate checkpoint does not match the pending operation');
      }
      return { checkpoint, current };
    }

    const knownIds = kind === 'ROLE'
      ? current.roles.map((role) => role.id)
      : current.channels.map((channel) => channel.id);
    const guarded: RestoreCheckpoint = {
      ...checkpoint,
      recreateGuard: {
        kind,
        sourceId,
        knownIds,
        markerName: recreateMarkerName(job.id, sourceId),
      },
    };
    await this.dependencies.backups.updateRestoreCheckpoint({
      guildId: job.guildId,
      jobId: job.id,
      checkpoint: guarded as unknown as Record<string, unknown>,
    });
    return { checkpoint: guarded, current };
  }

  private async persistMappedCheckpoint(
    job: RecoveryJob,
    checkpoint: RestoreCheckpoint,
  ): Promise<void> {
    await this.dependencies.backups.updateRestoreCheckpoint({
      guildId: job.guildId,
      jobId: job.id,
      checkpoint: checkpoint as unknown as Record<string, unknown>,
    });
  }

  private async executeOperation(
    job: RecoveryJob,
    operation: RestoreOperation,
    checkpoint: RestoreCheckpoint,
  ): Promise<RestoreCheckpoint> {
    const reason = auditReason(job.id, operation);
    switch (operation.kind) {
      case 'ROLE': {
        if (operation.classification === 'NOT_RECOVERABLE') return checkpoint;
        if (operation.classification === 'RECREATE') {
          const mappedRoleId = checkpoint.roleIdMap[operation.sourceId];
          if (mappedRoleId !== undefined) {
            await this.dependencies.discord.updateRole(
              job.guildId, mappedRoleId, operation.role, reason,
            );
            return checkpoint;
          }

          const prepared = await this.prepareRecreateGuard(
            job, 'ROLE', operation.sourceId, checkpoint,
          );
          const guard = prepared.checkpoint.recreateGuard;
          if (guard === undefined) throw new Error('Recovery recreate guard is missing');
          const knownIds = new Set(guard.knownIds);
          const candidates = prepared.current.roles.filter(
            (role) => !knownIds.has(role.id) && !role.managed && role.name === guard.markerName,
          );
          if (candidates.length > 1) {
            throw new Error('Recovery role recreation is ambiguous');
          }
          const createdId = candidates[0]?.id ?? (await this.dependencies.discord.createRole(
            job.guildId,
            { ...operation.role, name: guard.markerName },
            reason,
          )).id;
          const mappedCheckpoint = nextCheckpoint(
            prepared.checkpoint,
            prepared.checkpoint.nextOperationIndex,
            {
              roleIdMap: {
                ...prepared.checkpoint.roleIdMap,
                [operation.sourceId]: createdId,
              },
            },
          );
          await this.persistMappedCheckpoint(job, mappedCheckpoint);
          await this.dependencies.discord.updateRole(
            job.guildId, createdId, operation.role, reason,
          );
          return mappedCheckpoint;
        }
        await this.dependencies.discord.updateRole(
          job.guildId,
          roleId(operation.sourceId, checkpoint),
          operation.role,
          reason,
        );
        return checkpoint;
      }

      case 'ROLE_ORDER':
        await this.dependencies.discord.setRolePositions(
          job.guildId,
          operation.roles.map((item) => ({ id: roleId(item.sourceId, checkpoint), position: item.position })),
          reason,
        );
        return checkpoint;
      case 'CATEGORY':
      case 'CHANNEL': {
        const channel = remapChannel(operation.channel, checkpoint);
        if (operation.classification === 'RECREATE') {
          const mappedChannelId = checkpoint.channelIdMap[operation.sourceId];
          if (mappedChannelId !== undefined) {
            await this.dependencies.discord.updateChannel(mappedChannelId, channel, reason);
            return checkpoint;
          }

          const prepared = await this.prepareRecreateGuard(
            job, operation.kind, operation.sourceId, checkpoint,
          );
          const guard = prepared.checkpoint.recreateGuard;
          if (guard === undefined) throw new Error('Recovery recreate guard is missing');
          const knownIds = new Set(guard.knownIds);
          const candidates = prepared.current.channels.filter(
            (candidate) =>
              !knownIds.has(candidate.id) &&
              candidate.type === channel.type &&
              candidate.name === guard.markerName,
          );
          if (candidates.length > 1) {
            throw new Error('Recovery channel recreation is ambiguous');
          }
          const createdId = candidates[0]?.id ?? (await this.dependencies.discord.createChannel(
            job.guildId,
            { ...channel, name: guard.markerName },
            reason,
          )).id;
          const mappedCheckpoint = nextCheckpoint(
            prepared.checkpoint,
            prepared.checkpoint.nextOperationIndex,
            {
              channelIdMap: {
                ...prepared.checkpoint.channelIdMap,
                [operation.sourceId]: createdId,
              },
            },
          );
          await this.persistMappedCheckpoint(job, mappedCheckpoint);
          await this.dependencies.discord.updateChannel(createdId, channel, reason);
          return mappedCheckpoint;
        }
        await this.dependencies.discord.updateChannel(
          channelId(operation.sourceId, checkpoint),
          channel,
          reason,
        );
        return checkpoint;
      }

      case 'CHANNEL_ORDER':
        await this.dependencies.discord.setChannelPositions(
          job.guildId,
          operation.channels.map((item) => ({
            id: channelId(item.sourceId, checkpoint),
            position: item.position,
            parentId: item.parentId === null ? null : channelId(item.parentId, checkpoint),
          })),
          reason,
        );
        return checkpoint;
      case 'OVERWRITES':
        await this.dependencies.discord.setChannelPermissionOverwrites(
          channelId(operation.sourceChannelId, checkpoint),
          remapOverwrites(operation.overwrites, checkpoint),
          reason,
        );
        return checkpoint;

      case 'KNIGHT_STAFF_PROFILE': {
        const newRoleId = roleId(operation.reference.discordRoleId, checkpoint);
        if (newRoleId === operation.reference.discordRoleId) return checkpoint;
        await this.dependencies.staff.remapDiscordRoleForRecovery({
          guildId: job.guildId,
          profileId: operation.reference.profileId,
          oldDiscordRoleId: operation.reference.discordRoleId,
          newDiscordRoleId: newRoleId,
          recoveryJobId: job.id,
        });
        return checkpoint;
      }

      case 'KNIGHT_PROTECTED_RESOURCE': {
        const oldResourceId = operation.reference.resourceId;
        const newResourceId = operation.reference.resourceType === 'ROLE'
          ? roleId(oldResourceId, checkpoint)
          : operation.reference.resourceType === 'CHANNEL'
            ? channelId(oldResourceId, checkpoint)
            : oldResourceId;
        if (newResourceId === oldResourceId) return checkpoint;
        await this.dependencies.security.remapProtectedResourceForRecovery({
          guildId: job.guildId,
          resourceType: operation.reference.resourceType,
          oldResourceId,
          newResourceId,
          recoveryJobId: job.id,
        });
        return checkpoint;
      }

      case 'KNIGHT_LOGGING': {
        const channelIds = [
          operation.reference.securityChannelId,
          operation.reference.moderationChannelId,
          operation.reference.messageChannelId ?? null,
          operation.reference.voiceChannelId ?? null,
        ].filter((value): value is string => value !== null);
        for (const oldChannelId of new Set(channelIds)) {
          const newChannelId = channelId(oldChannelId, checkpoint);
          if (newChannelId === oldChannelId) continue;
          await this.dependencies.ledger.remapLoggingChannelForRecovery({
            guildId: job.guildId,
            oldChannelId,
            newChannelId,
            recoveryJobId: job.id,
          });
        }
        return checkpoint;
      }

      case 'MESSAGE_ARCHIVE':
        return checkpoint;
    }
  }
  public async processExecutionJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job.phase !== 'EXECUTION' || job.status !== 'RUNNING') {
      throw new Error('Recovery execution job is not running');
    }
    if (job.confirmedBy === null) {
      await this.dependencies.backups.failRestore({
        guildId: job.guildId,
        jobId: job.id,
        error: 'Recovery execution requires owner confirmation',
      });
      return;
    }

    try {
      const backup = await this.getBackup(job);
      await this.dependencies.storage.readVerified<StructuralBackupPayload>(
        backup.relativePath,
        backup.sha256,
      );
      const preview = asPreview(job.preview);
      let checkpoint = asCheckpoint(job.checkpoint);
      const lockKey = `guild-operation:${job.guildId}`;
      const token = await this.dependencies.locks.acquire(lockKey, RECOVERY_LOCK_TTL_MS);
      if (token === null) {
        await this.dependencies.backups.failRestore({
          guildId: job.guildId,
          jobId: job.id,
          error: 'Recovery is already running for this guild',
        });
        return;
      }
      try {
        for (
          let index = checkpoint.nextOperationIndex;
          index < preview.operations.length;
          index += 1
        ) {
          const operation = preview.operations[index];
          if (operation === undefined) throw new Error('Recovery operation is missing');
          const withMaps = await this.executeOperation(job, operation, checkpoint);
          checkpoint = nextCheckpoint(withMaps, index + 1);
          await this.dependencies.backups.updateRestoreCheckpoint({
            guildId: job.guildId,
            jobId: job.id,
            checkpoint: checkpoint as unknown as Record<string, unknown>,
          });
        }
        await this.dependencies.backups.completeRestore({ guildId: job.guildId, jobId: job.id });
      } catch (error) {
        await this.dependencies.backups.failRestore({
          guildId: job.guildId,
          jobId: job.id,
          error: errorMessage(error),
        });
      } finally {
        await this.dependencies.locks.release(lockKey, token).catch(() => false);
      }
    } catch (error) {
      await this.dependencies.backups.failRestore({
        guildId: job.guildId,
        jobId: job.id,
        error: errorMessage(error),
      });
    }
  }
}
