import { describe, expect, it, vi } from 'vitest';
import { SecurityManagerService } from './security-manager-service.js';

function makeDependencies() {
  return {
    guilds: {
      get: vi.fn().mockResolvedValue({ id: '100', ownerId: '1' }),
    },
    managers: {
      isSecurityManager: vi.fn().mockResolvedValue(false),
      grant: vi.fn().mockResolvedValue(undefined),
      revoke: vi.fn().mockResolvedValue(undefined),
    },
    securityRecorder: { record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }) },
  };
}

describe('SecurityManagerService', () => {
  it('allows the guild owner to grant and revoke Security Manager authority', async () => {
    const deps = makeDependencies();
    const service = new SecurityManagerService(deps);

    await service.grant({ guildId: '100', actorUserId: '1', userId: '42' });
    await service.revoke({ guildId: '100', actorUserId: '1', userId: '42' });

    expect(deps.managers.grant).toHaveBeenCalledWith({
      guildId: '100',
      userId: '42',
      grantedBy: '1',
    });
    expect(deps.managers.revoke).toHaveBeenCalledWith('100', '42');
    expect(deps.securityRecorder.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'security.manager.add', actorUserId: '1', targetId: '42' }),
      'SECURITY',
    );
    expect(deps.securityRecorder.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'security.manager.remove', actorUserId: '1', targetId: '42' }),
      'SECURITY',
    );
  });
  it('does not let a Security Manager grant themselves manager authority', async () => {
    const deps = makeDependencies();
    deps.managers.isSecurityManager.mockResolvedValueOnce(true);
    const service = new SecurityManagerService(deps);

    await expect(
      service.grant({ guildId: '100', actorUserId: '42', userId: '42' }),
    ).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
    expect(deps.managers.grant).not.toHaveBeenCalled();
  });

  it('denies non-owner revocation even when the actor is already a Security Manager', async () => {
    const deps = makeDependencies();
    deps.managers.isSecurityManager.mockResolvedValueOnce(true);
    const service = new SecurityManagerService(deps);

    await expect(
      service.revoke({ guildId: '100', actorUserId: '42', userId: '77' }),
    ).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
    expect(deps.managers.revoke).not.toHaveBeenCalled();
  });
});
