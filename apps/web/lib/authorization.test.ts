import { describe, expect, it, vi } from 'vitest';
import { requireGuildAccess, type GuildAuthorizationDependencies } from './authorization';

function makeDependencies(): GuildAuthorizationDependencies {
  return {
    guilds: { get: vi.fn().mockResolvedValue({ ownerId: '1' }) },
    managers: { isSecurityManager: vi.fn().mockResolvedValue(false) },
  };
}

function session(userId: string | null, nativeDiscordAdministrator = false) {
  return userId === null
    ? null
    : ({
        user: { id: userId, name: 'Test User' },
        nativeDiscordAdministrator,
      } as const);
}

describe('requireGuildAccess', () => {
  it('allows the persisted guild owner', async () => {
    const deps = makeDependencies();

    await expect(requireGuildAccess('100', session('1'), deps)).resolves.toBe('OWNER');
    expect(deps.managers.isSecurityManager).not.toHaveBeenCalled();
  });

  it('allows an explicit Knight Security Manager', async () => {
    const deps = makeDependencies();
    deps.managers.isSecurityManager = vi.fn().mockResolvedValue(true);

    await expect(requireGuildAccess('100', session('42'), deps)).resolves.toBe('SECURITY_MANAGER');
    expect(deps.managers.isSecurityManager).toHaveBeenCalledWith('100', '42');
  });

  it('denies an arbitrary native Discord Administrator', async () => {
    const deps = makeDependencies();

    await expect(requireGuildAccess('100', session('77', true), deps)).rejects.toMatchObject({
      code: 'GUILD_ACCESS_DENIED',
    });
  });

  it('denies unauthenticated requests before reading guild state', async () => {
    const deps = makeDependencies();

    await expect(requireGuildAccess('100', session(null), deps)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(deps.guilds.get).not.toHaveBeenCalled();
    expect(deps.managers.isSecurityManager).not.toHaveBeenCalled();
  });

  it('denies access to an unconfigured guild', async () => {
    const deps = makeDependencies();
    deps.guilds.get = vi.fn().mockResolvedValue(null);

    await expect(requireGuildAccess('404', session('1'), deps)).rejects.toMatchObject({
      code: 'GUILD_NOT_CONFIGURED',
    });
  });
});
