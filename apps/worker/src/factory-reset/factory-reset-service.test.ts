import { describe, expect, it, vi } from 'vitest';
import { FactoryResetService } from './factory-reset-service.js';

function makeService() {
  const job = { id: 'reset-1', guildId: '100', requestedBy: 'owner-1', status: 'RUNNING' };
  const resets = {
    claimPending: vi.fn().mockResolvedValue(job),
    getExecutionEligibility: vi.fn().mockResolvedValue({ eligible: true, blockers: [] }),
    resetGuildKnightState: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue({ ...job, status: 'COMPLETED' }),
    fail: vi.fn().mockResolvedValue({ ...job, status: 'FAILED' }),
    recoverInterrupted: vi.fn().mockResolvedValue(undefined),
  };
  const storage = { deleteGuild: vi.fn().mockResolvedValue(undefined) };
  const locks = { acquire: vi.fn().mockResolvedValue('token'), release: vi.fn().mockResolvedValue(true) };
  return { service: new FactoryResetService({ resets, storage, locks }), resets, storage, locks };
}

describe('FactoryResetService', () => {
  it('rechecks eligibility under the guild operation lock before deleting files and state', async () => {
    const made = makeService();
    await expect(made.service.processNextPendingReset()).resolves.toBe(true);
    expect(made.locks.acquire).toHaveBeenCalledWith('guild-operation:100', expect.any(Number));
    expect(made.resets.getExecutionEligibility.mock.invocationCallOrder[0]).toBeLessThan(made.storage.deleteGuild.mock.invocationCallOrder[0]!);
    expect(made.storage.deleteGuild.mock.invocationCallOrder[0]).toBeLessThan(made.resets.resetGuildKnightState.mock.invocationCallOrder[0]!);
    expect(made.resets.resetGuildKnightState).toHaveBeenCalledWith({ guildId: '100', resetJobId: 'reset-1', ownerId: 'owner-1' });
    expect(made.resets.complete).toHaveBeenCalledWith({ guildId: '100', resetJobId: 'reset-1' });
    expect(made.locks.release).toHaveBeenCalledWith('guild-operation:100', 'token');
  });

  it('fails without destructive work when eligibility changed after queueing', async () => {
    const made = makeService();
    made.resets.getExecutionEligibility.mockResolvedValueOnce({ eligible: false, blockers: ['GUARDED'] });
    await made.service.processNextPendingReset();
    expect(made.storage.deleteGuild).not.toHaveBeenCalled();
    expect(made.resets.fail).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('GUARDED') }));
    expect(made.resets.complete).not.toHaveBeenCalled();
  });

  it.each(['files', 'database'] as const)('never completes when %s cleanup fails', async (failure) => {
    const made = makeService();
    if (failure === 'files') made.storage.deleteGuild.mockRejectedValueOnce(new Error('disk failed'));
    else made.resets.resetGuildKnightState.mockRejectedValueOnce(new Error('database failed'));
    await made.service.processNextPendingReset();
    expect(made.resets.complete).not.toHaveBeenCalled();
    expect(made.resets.fail).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('failed') }));
  });

  it('fails safely when another guild operation holds the lock', async () => {
    const made = makeService();
    made.locks.acquire.mockResolvedValueOnce(null);
    await made.service.processNextPendingReset();
    expect(made.storage.deleteGuild).not.toHaveBeenCalled();
    expect(made.resets.fail).toHaveBeenCalled();
  });

  it('recovers interrupted reset jobs through the repository', async () => {
    const made = makeService();
    await made.service.recoverInterrupted();
    expect(made.resets.recoverInterrupted).toHaveBeenCalledTimes(1);
  });
});
