import { describe, expect, it, vi } from 'vitest';
import { EmergencyService } from './emergency-service.js';

function makeDependencies() {
  return {
    guilds: { get: vi.fn().mockResolvedValue({ id: '100', ownerId: 'owner' }) },
    managers: { isSecurityManager: vi.fn().mockResolvedValue(false) },
    security: {
      getSecurityState: vi.fn().mockResolvedValue({
        guildId: '100',
        mode: 'NORMAL',
        lockedScopes: [],
        reason: null,
        updatedBy: null,
        updatedAt: null,
      }),
      setSecurityState: vi.fn().mockImplementation(async (input) => ({
        ...input,
        updatedAt: new Date('2026-09-12T10:00:00Z'),
      })),
      findOrCreateIncident: vi.fn().mockResolvedValue({ id: 'incident-1' }),
    },
    securityRecorder: { record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }) },
    now: vi.fn(() => new Date('2026-09-12T10:00:00Z')),
  };
}

describe('EmergencyService', () => {
  it('denies an ordinary staff member from changing emergency state', async () => {
    const dependencies = makeDependencies();
    const service = new EmergencyService(dependencies);

    await expect(
      service.lockdown({
        guildId: '100',
        actorUserId: 'staff',
        scopes: ['MEMBER_MODERATION'],
        reason: 'Investigating',
      }),
    ).rejects.toMatchObject({ code: 'EMERGENCY_AUTHORITY_REQUIRED' });
    expect(dependencies.security.setSecurityState).not.toHaveBeenCalled();
  });

  it('allows a Security Manager to activate Lockdown and records it', async () => {
    const dependencies = makeDependencies();
    dependencies.managers.isSecurityManager.mockResolvedValueOnce(true);
    const service = new EmergencyService(dependencies);

    await service.lockdown({
      guildId: '100',
      actorUserId: 'manager',
      scopes: ['MEMBER_MODERATION', 'SECURITY_CONFIG'],
      reason: 'Investigating access',
    });

    expect(dependencies.security.setSecurityState).toHaveBeenCalledWith({
      guildId: '100',
      mode: 'LOCKDOWN',
      lockedScopes: ['MEMBER_MODERATION', 'SECURITY_CONFIG'],
      reason: 'Investigating access',
      updatedBy: 'manager',
    });
    expect(dependencies.securityRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: '100',
        source: 'SECURITY',
        action: 'security.lockdown.enabled',
        actorUserId: 'manager',
      }),
      'SECURITY',
    );
  });

  it('requires explicit confirmation before Panic', async () => {
    const dependencies = makeDependencies();
    const service = new EmergencyService(dependencies);

    await expect(
      service.panic({
        guildId: '100',
        actorUserId: 'owner',
        reason: 'Confirmed compromise',
        confirmed: false,
      }),
    ).rejects.toMatchObject({ code: 'PANIC_CONFIRMATION_REQUIRED' });
    expect(dependencies.security.setSecurityState).not.toHaveBeenCalled();
  });

  it('persists Panic, creates an incident marker, and records the transition', async () => {
    const dependencies = makeDependencies();
    dependencies.managers.isSecurityManager.mockResolvedValueOnce(true);
    const service = new EmergencyService(dependencies);

    await service.panic({
      guildId: '100',
      actorUserId: 'manager',
      reason: 'Confirmed compromise',
      confirmed: true,
    });

    expect(dependencies.security.setSecurityState).toHaveBeenCalledWith({
      guildId: '100',
      mode: 'PANIC',
      lockedScopes: [],
      reason: 'Confirmed compromise',
      updatedBy: 'manager',
    });
    expect(dependencies.security.findOrCreateIncident).toHaveBeenCalledWith({
      guildId: '100',
      actorKey: 'emergency:panic',
      severity: 'CRITICAL',
      summary: 'Panic activated: Confirmed compromise',
      occurredAt: new Date('2026-09-12T10:00:00Z'),
    });
    expect(dependencies.securityRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'CRITICAL',
        action: 'security.panic.enabled',
        incidentId: 'incident-1',
      }),
      'SECURITY',
    );
  });

  it('supports authorized recovery transitions and status reads', async () => {
    const dependencies = makeDependencies();
    dependencies.security.getSecurityState
      .mockResolvedValueOnce({ mode: 'NORMAL' })
      .mockResolvedValueOnce({ mode: 'LOCKDOWN' })
      .mockResolvedValueOnce({ mode: 'PANIC' });
    const service = new EmergencyService(dependencies);

    expect(await service.status('100')).toMatchObject({ mode: 'NORMAL' });
    await service.unlock({ guildId: '100', actorUserId: 'owner', reason: 'Investigation complete' });
    await service.clearPanic({ guildId: '100', actorUserId: 'owner', reason: 'Access restored' });

    expect(dependencies.security.setSecurityState).toHaveBeenNthCalledWith(1, {
      guildId: '100',
      mode: 'NORMAL',
      lockedScopes: [],
      reason: 'Investigation complete',
      updatedBy: 'owner',
    });
    expect(dependencies.security.setSecurityState).toHaveBeenNthCalledWith(2, {
      guildId: '100',
      mode: 'NORMAL',
      lockedScopes: [],
      reason: 'Access restored',
      updatedBy: 'owner',
    });
    expect(dependencies.securityRecorder.record).toHaveBeenCalledTimes(2);
  });

  it('does not let the wrong recovery command clear the active state', async () => {
    const dependencies = makeDependencies();
    const service = new EmergencyService(dependencies);
    dependencies.security.getSecurityState.mockResolvedValueOnce({ mode: 'PANIC' });

    await expect(
      service.unlock({ guildId: '100', actorUserId: 'owner', reason: 'Use the correct control' }),
    ).rejects.toMatchObject({ code: 'INVALID_EMERGENCY_TRANSITION' });
    expect(dependencies.security.setSecurityState).not.toHaveBeenCalled();

    dependencies.security.getSecurityState.mockResolvedValueOnce({ mode: 'PANIC' });
    await expect(
      service.lockdown({
        guildId: '100',
        actorUserId: 'owner',
        scopes: ['FULL'],
        reason: 'Keep restrictions active',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMERGENCY_TRANSITION' });
    expect(dependencies.security.setSecurityState).not.toHaveBeenCalled();
  });

  it('rejects empty reasons and arbitrary Lockdown scopes', async () => {
    const dependencies = makeDependencies();
    const service = new EmergencyService(dependencies);

    await expect(
      service.lockdown({
        guildId: '100',
        actorUserId: 'owner',
        scopes: ['NOT_A_SCOPE' as never],
        reason: 'Investigating',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LOCKDOWN_SCOPE' });
    await expect(
      service.unlock({ guildId: '100', actorUserId: 'owner', reason: '   ' }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });
});
