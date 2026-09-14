import type { WebRepositories } from './server-dependencies.js';

export class FactoryResetError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FactoryResetError';
  }
}

type ResetDependencies = Pick<WebRepositories, 'guilds' | 'backups' | 'factoryResets'>;

export class FactoryResetService {
  public constructor(private readonly dependencies: ResetDependencies) {}

  public async getPreflight(guildId: string, actorUserId: string) {
    const guild = await this.dependencies.guilds.get(guildId);
    if (!guild) return { allowed: false, isOwner: false, blockers: ['Guild is not configured.'] } as const;
    const isOwner = guild.ownerId === actorUserId;
    const [eligibility, backup, recovery, reset] = await Promise.all([
      this.dependencies.factoryResets.getExecutionEligibility(guildId),
      this.dependencies.backups.getActiveBackup(guildId),
      this.dependencies.backups.getActiveRecoveryJob(guildId),
      this.dependencies.factoryResets.getActive(guildId),
    ]);
    const blockers: string[] = eligibility.blockers.map((blocker) => blocker === 'GUARDED'
      ? 'Rollback Guarded before factory reset.'
      : blocker === 'PANIC'
        ? 'Exit Panic before factory reset.'
        : blocker === 'CONFIG_LOCKDOWN'
          ? 'Exit configuration-blocking Lockdown before factory reset.'
          : 'Guild is not configured.');
    if (!isOwner) blockers.push('Only the Discord guild owner can factory reset Knight.');
    if (backup) blockers.push('Wait for the active backup to finish.');
    if (recovery) blockers.push('Finish or clear the active recovery operation.');
    if (reset) blockers.push('A factory reset is already active.');
    return { allowed: blockers.length === 0, isOwner, blockers } as const;
  }

  public async requestReset(input: { guildId: string; actorUserId: string }) {
    const preflight = await this.getPreflight(input.guildId, input.actorUserId);
    if (!preflight.isOwner) throw new FactoryResetError('OWNER_REQUIRED', 'Only the Discord guild owner can factory reset Knight.');
    if (!preflight.allowed) throw new FactoryResetError('RESET_BLOCKED', preflight.blockers.join(' '));
    return this.dependencies.factoryResets.enqueue({ guildId: input.guildId, requestedBy: input.actorUserId });
  }
}
