import { describe, expect, it, vi } from 'vitest';
import { FactoryResetService } from './factory-reset-service.js';

function dependencies(overrides: Record<string, unknown> = {}) {
  const base = {
    guilds: { get: vi.fn().mockResolvedValue({ id: '100', ownerId: 'owner', mode: 'OBSERVE' }) },
    backups: { getActiveBackup: vi.fn().mockResolvedValue(null), getActiveRecoveryJob: vi.fn().mockResolvedValue(null) },
    factoryResets: {
      getActive: vi.fn().mockResolvedValue(null),
      getExecutionEligibility: vi.fn().mockResolvedValue({ eligible: true, blockers: [] }),
      enqueue: vi.fn().mockResolvedValue({ id: 'reset-1', status: 'PENDING' }),
    },
  };
  return {
    ...base,
    ...overrides,
    backups: { ...base.backups, ...(overrides.backups as object | undefined) },
    factoryResets: { ...base.factoryResets, ...(overrides.factoryResets as object | undefined) },
  };
}

describe('FactoryResetService', () => {
  it('allows only the Discord owner and rechecks before enqueue', async () => {
    const deps = dependencies();
    const service = new FactoryResetService(deps as never);
    await expect(service.requestReset({ guildId: '100', actorUserId: 'manager' })).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
    await expect(service.requestReset({ guildId: '100', actorUserId: 'owner' })).resolves.toMatchObject({ id: 'reset-1' });
    expect(deps.guilds.get).toHaveBeenCalledTimes(2);
    expect(deps.factoryResets.enqueue).toHaveBeenCalledWith({ guildId: '100', requestedBy: 'owner' });
  });

  it.each([
    ['GUARDED', { factoryResets: { getExecutionEligibility: vi.fn().mockResolvedValue({ eligible: false, blockers: ['GUARDED'] }) } }],
    ['Panic', { factoryResets: { getExecutionEligibility: vi.fn().mockResolvedValue({ eligible: false, blockers: ['PANIC'] }) } }],
    ['configuration Lockdown', { factoryResets: { getExecutionEligibility: vi.fn().mockResolvedValue({ eligible: false, blockers: ['CONFIG_LOCKDOWN'] }) } }],
    ['active backup', { backups: { getActiveBackup: vi.fn().mockResolvedValue({ id: 'b1' }), getActiveRecoveryJob: vi.fn().mockResolvedValue(null) } }],
    ['active recovery', { backups: { getActiveBackup: vi.fn().mockResolvedValue(null), getActiveRecoveryJob: vi.fn().mockResolvedValue({ id: 'r1' }) } }],
    ['active reset', { factoryResets: { getActive: vi.fn().mockResolvedValue({ id: 'x' }), getExecutionEligibility: vi.fn().mockResolvedValue({ eligible: true, blockers: [] }), enqueue: vi.fn() } }],
  ])('refuses reset during %s', async (_label, override) => {
    const deps = dependencies(override) as never;
    const preflight = await new FactoryResetService(deps).getPreflight('100', 'owner');
    expect(preflight.allowed).toBe(false);
  });
});
