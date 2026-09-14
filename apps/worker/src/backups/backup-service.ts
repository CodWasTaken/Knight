import type {
  ArchivedMessageEvidence,
  DiscordStructuralSnapshot,
  KnightProtectedResourceRecoveryReference,
  StructuralBackupPayload,
} from '@knight/contracts';

export type BackupJob = Readonly<{ id: string; guildId: string }>;
const BACKUP_LOCK_TTL_MS = 5 * 60_000;

type BackupDependencies = Readonly<{
  backups: {
    recoverInterruptedJobs(now?: Date): Promise<void>;
    listDueDailyPolicies(now: Date): Promise<readonly { guildId: string }[]>;
    enqueueBackup(input: { guildId: string; requestedBy: string }): Promise<unknown>;
    claimPendingBackup(): Promise<BackupJob | null>;
    getPolicy(guildId: string): Promise<{
      archiveChannelIds: readonly string[];
      maxMessagesPerChannel: number;
    } | null>;
    completeBackup(input: {
      guildId: string;
      backupId: string;
      relativePath: string;
      sha256: string;
    }): Promise<unknown>;
    failBackup(input: { guildId: string; backupId: string; error: string }): Promise<unknown>;
  };
  discord: {
    captureGuild(guildId: string): Promise<DiscordStructuralSnapshot>;
    fetchChannelMessages(channelId: string, limit: number): Promise<readonly ArchivedMessageEvidence[]>;
  };
  staff: {
    listProfiles(guildId: string): Promise<readonly {
      id: string;
      discordRoleId: string;
      currentVersionId: string | null;
    }[]>;
  };
  ledger: {
    getLoggingSettings(guildId: string): Promise<{
      securityChannelId: string | null;
      moderationChannelId: string | null;
      messageChannelId: string | null;
      voiceChannelId: string | null;
    } | null>;
  };
  security: {
    listProtectedResources(guildId: string): Promise<readonly {
      resourceType: string;
      resourceId: string;
      level: string;
    }[]>;
  };
  storage: {
    write(guildId: string, backupId: string, payload: StructuralBackupPayload): Promise<{
      relativePath: string;
      sha256: string;
    }>;
  };
  restore: { processNextPendingRestore(): Promise<boolean> };
  reset: { recoverInterrupted(): Promise<void>; processNextPendingReset(): Promise<boolean> };
  locks: {
    acquire(key: string, ttlMs: number): Promise<string | null>;
    release(key: string, token: string): Promise<boolean>;
  };
  archiveEnabled: boolean;
  now(): Date;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Backup failed';
}

function protectedReference(resource: {
  resourceType: string;
  resourceId: string;
  level: string;
}): KnightProtectedResourceRecoveryReference {
  if (
    !['USER', 'ROLE', 'CHANNEL'].includes(resource.resourceType) ||
    !['IMPORTANT', 'CRITICAL', 'IMMUTABLE'].includes(resource.level)
  ) {
    throw new Error('Invalid protected resource reference');
  }
  return {
    resourceType: resource.resourceType as KnightProtectedResourceRecoveryReference['resourceType'],
    resourceId: resource.resourceId,
    level: resource.level as KnightProtectedResourceRecoveryReference['level'],
  };
}


export class BackupService {
  public constructor(private readonly dependencies: BackupDependencies) {}

  public async recoverInterruptedJobs(): Promise<void> {
    await Promise.all([
      this.dependencies.backups.recoverInterruptedJobs(this.dependencies.now()),
      this.dependencies.reset.recoverInterrupted(),
    ]);
  }

  public async runDueDaily(now: Date): Promise<void> {
    const due = await this.dependencies.backups.listDueDailyPolicies(now);
    for (const policy of due) {
      await this.dependencies.backups.enqueueBackup({ guildId: policy.guildId, requestedBy: 'SYSTEM' });
    }
  }

  public async processNextPendingBackup(): Promise<boolean> {
    const job = await this.dependencies.backups.claimPendingBackup();
    if (!job) return false;

    const lockKey = `guild-operation:${job.guildId}`;
    let token: string | null = null;
    try {
      token = await this.dependencies.locks.acquire(lockKey, BACKUP_LOCK_TTL_MS);
      if (token === null) throw new Error('Another guild operation is already running');
      const policy = await this.dependencies.backups.getPolicy(job.guildId);
      const archiveChannelIds = policy?.archiveChannelIds ?? [];
      if (archiveChannelIds.length > 0 && !this.dependencies.archiveEnabled) {
        throw new Error('Message archival is not enabled by the operator');
      }

      const [discord, profiles, logging, protectedResources] = await Promise.all([
        this.dependencies.discord.captureGuild(job.guildId),
        this.dependencies.staff.listProfiles(job.guildId),
        this.dependencies.ledger.getLoggingSettings(job.guildId),
        this.dependencies.security.listProtectedResources(job.guildId),
      ]);

      const messageArchives = [];
      for (const channelId of archiveChannelIds) {
        const messages = await this.dependencies.discord.fetchChannelMessages(
          channelId,
          policy?.maxMessagesPerChannel ?? 1000,
        );
        messageArchives.push({ channelId, messages });
      }

      const payload: StructuralBackupPayload = {
        version: 1,
        guildId: job.guildId,
        createdAt: this.dependencies.now().toISOString(),
        discord,
        knight: {
          staffProfiles: profiles.map((profile) => ({
            profileId: profile.id,
            discordRoleId: profile.discordRoleId,
            profileVersionId: profile.currentVersionId,
          })),
          logging: logging
            ? {
                securityChannelId: logging.securityChannelId,
                moderationChannelId: logging.moderationChannelId,
                messageChannelId: logging.messageChannelId,
                voiceChannelId: logging.voiceChannelId,
              }
            : null,
          protectedResources: protectedResources.map(protectedReference),
        },
        messageArchives,
      };
      const written = await this.dependencies.storage.write(job.guildId, job.id, payload);
      await this.dependencies.backups.completeBackup({
        guildId: job.guildId,
        backupId: job.id,
        ...written,
      });
    } catch (error) {
      await this.dependencies.backups.failBackup({
        guildId: job.guildId,
        backupId: job.id,
        error: errorMessage(error),
      });
    } finally {
      if (token !== null) await this.dependencies.locks.release(lockKey, token).catch(() => false);
    }
    return true;
  }

  public async runTick(now: Date): Promise<void> {
    await this.dependencies.reset.processNextPendingReset();
    await this.runDueDaily(now);
    await this.processNextPendingBackup();
    await this.dependencies.restore.processNextPendingRestore();
  }
}
