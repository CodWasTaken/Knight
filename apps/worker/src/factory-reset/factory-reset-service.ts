const FACTORY_RESET_LOCK_TTL_MS = 5 * 60_000;

type ResetJob = Readonly<{ id: string; guildId: string; requestedBy: string }>;

type FactoryResetDependencies = Readonly<{
  resets: {
    claimPending(): Promise<ResetJob | null>;
    getExecutionEligibility(guildId: string): Promise<{ eligible: boolean; blockers: readonly string[] }>;
    resetGuildKnightState(input: { guildId: string; resetJobId: string }): Promise<void>;
    complete(input: { guildId: string; resetJobId: string }): Promise<unknown>;
    fail(input: { guildId: string; resetJobId: string; error: string }): Promise<unknown>;
    recoverInterrupted(): Promise<void>;
  };
  storage: { deleteGuild(guildId: string): Promise<void> };
  locks: {
    acquire(key: string, ttlMs: number): Promise<string | null>;
    release(key: string, token: string): Promise<boolean>;
  };
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Factory reset failed';
}

export class FactoryResetService {
  public constructor(private readonly dependencies: FactoryResetDependencies) {}

  public async recoverInterrupted(): Promise<void> {
    await this.dependencies.resets.recoverInterrupted();
  }

  public async processNextPendingReset(): Promise<boolean> {
    const job = await this.dependencies.resets.claimPending();
    if (!job) return false;
    const lockKey = `guild-operation:${job.guildId}`;
    let token: string | null = null;
    try {
      token = await this.dependencies.locks.acquire(lockKey, FACTORY_RESET_LOCK_TTL_MS);
      if (token === null) throw new Error('Another guild operation is already running');
      const eligibility = await this.dependencies.resets.getExecutionEligibility(job.guildId);
      if (!eligibility.eligible) {
        throw new Error(`Factory reset is blocked: ${eligibility.blockers.join(', ')}`);
      }
      await this.dependencies.storage.deleteGuild(job.guildId);
      await this.dependencies.resets.resetGuildKnightState({
        guildId: job.guildId,
        resetJobId: job.id,
      });
      await this.dependencies.resets.complete({ guildId: job.guildId, resetJobId: job.id });
    } catch (error) {
      await this.dependencies.resets.fail({ guildId: job.guildId, resetJobId: job.id, error: errorMessage(error) });
    } finally {
      if (token !== null) await this.dependencies.locks.release(lockKey, token).catch(() => false);
    }
    return true;
  }
}
