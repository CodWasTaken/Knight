export type BackupCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
}>;

type BackupStatusRecord = Readonly<{
  id: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
}>;

type RecoveryStatusRecord = Readonly<{
  id: string;
  phase: string;
  status: string;
  updatedAt: Date;
}>;

export type BackupCommandDependencies = Readonly<{
  guilds: { get(guildId: string): Promise<{ ownerId: string } | null> };
  managers: { isSecurityManager(guildId: string, userId: string): Promise<boolean> };
  backups: {
    enqueueBackup(input: { guildId: string; requestedBy: string }): Promise<{ id: string; status: string }>;
    listBackups(guildId: string, limit: number): Promise<readonly BackupStatusRecord[]>;
    getActiveRecoveryJob(guildId: string): Promise<RecoveryStatusRecord | null>;
  };
}>;

export class BackupCommandError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BackupCommandError';
  }
}


export class BackupCommandService {
  public constructor(private readonly dependencies: BackupCommandDependencies) {}

  private async requireAccess(input: BackupCommandInput): Promise<void> {
    const guild = await this.dependencies.guilds.get(input.guildId);
    if (guild === null) {
      throw new BackupCommandError(
        'GUILD_NOT_CONFIGURED',
        'Knight is not configured for this Discord server.',
      );
    }
    if (guild.ownerId === input.actorUserId) return;
    if (await this.dependencies.managers.isSecurityManager(input.guildId, input.actorUserId)) return;
    throw new BackupCommandError(
      'BACKUP_ACCESS_DENIED',
      'Only the guild owner or a Knight Security Manager may manage backups.',
    );
  }

  public async create(input: BackupCommandInput): Promise<{ content: string }> {
    await this.requireAccess(input);
    const backup = await this.dependencies.backups.enqueueBackup({
      guildId: input.guildId,
      requestedBy: input.actorUserId,
    });
    return { content: `Backup queued: ${backup.id} (${backup.status}).` };
  }

  public async status(input: BackupCommandInput): Promise<{ content: string }> {
    await this.requireAccess(input);
    const [backups, activeRecovery] = await Promise.all([
      this.dependencies.backups.listBackups(input.guildId, 1),
      this.dependencies.backups.getActiveRecoveryJob(input.guildId),
    ]);
    const latest = backups[0];
    const lines = latest === undefined
      ? ['Latest backup: none.']
      : [
          `Latest backup: ${latest.id} — ${latest.status} at ${(latest.completedAt ?? latest.createdAt).toISOString()}.`,
        ];

    if (latest?.error) lines.push(`Last backup error: ${latest.error}`);
    lines.push(
      activeRecovery === null
        ? 'Active recovery: none.'
        : `Active recovery: ${activeRecovery.id} — ${activeRecovery.phase}/${activeRecovery.status} (updated ${activeRecovery.updatedAt.toISOString()}).`,
    );
    return { content: lines.join('\n') };
  }
}

export type BackupCommandPort = Pick<BackupCommandService, 'create' | 'status'>;