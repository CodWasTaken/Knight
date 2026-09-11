import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWebRuntime: vi.fn(),
  getWebSetupServices: vi.fn(),
  requireGuildAccess: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../../../../auth', () => ({ auth: mocks.auth }));
vi.mock('../../../../lib/authorization', () => ({
  requireGuildAccess: mocks.requireGuildAccess,
}));
vi.mock('../../../../lib/server-runtime', () => ({
  getWebRuntime: mocks.getWebRuntime,
}));
vi.mock('../../../../lib/setup-runtime', () => ({
  getWebSetupServices: mocks.getWebSetupServices,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
import {
  advanceSetupAction,
  enableGuardedBanAction,
  enterTestModeAction,
  rollbackGuardedBanAction,
} from './actions';

function formData(): FormData {
  const data = new FormData();
  data.set('guildId', '100');
  data.set('actorUserId', 'forged-owner');
  return data;
}

function confirmedFormData(): FormData {
  const data = formData();
  data.set('confirmGuarded', 'yes');
  return data;
}

describe('setup actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops before setup service resolution when live guild authorization denies access', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'stranger' } });
    mocks.getWebRuntime.mockReturnValue({ repositories: { guilds: {}, managers: {}, staff: {} } });
    mocks.requireGuildAccess.mockRejectedValue(new Error('denied'));

    await expect(enterTestModeAction(formData())).rejects.toThrow('denied');
    expect(mocks.getWebSetupServices).not.toHaveBeenCalled();
  });
  it('uses the Auth.js actor for setup step and Test transition actions', async () => {
    const setup = {
      advanceStep: vi.fn().mockResolvedValue(undefined),
      transitionMode: vi.fn().mockResolvedValue(undefined),
    };
    mocks.auth.mockResolvedValue({ user: { id: 'session-manager' } });
    const repositories = { guilds: {}, managers: {}, staff: {} };
    mocks.getWebRuntime.mockReturnValue({ repositories });
    mocks.requireGuildAccess.mockResolvedValue('SECURITY_MANAGER');
    mocks.getWebSetupServices.mockReturnValue({ setup, migrations: {} });

    await advanceSetupAction(formData());
    await enterTestModeAction(formData());

    expect(setup.advanceStep).toHaveBeenCalledWith('100', 'session-manager');
    expect(setup.transitionMode).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: 'session-manager',
      targetMode: 'TEST',
    });
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(
      '100',
      { user: { id: 'session-manager' } },
      repositories,
    );
  });
  it('passes the session actor into Guarded enable and rollback for owner enforcement', async () => {
    const migrations = {
      enableBanGuard: vi.fn().mockResolvedValue(undefined),
      rollbackBanGuard: vi.fn().mockResolvedValue(undefined),
    };
    mocks.auth.mockResolvedValue({ user: { id: 'session-owner' } });
    const repositories = { guilds: {}, managers: {}, staff: {} };
    mocks.getWebRuntime.mockReturnValue({ repositories });
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getWebSetupServices.mockReturnValue({ setup: {}, migrations });

    await enableGuardedBanAction(confirmedFormData());
    await rollbackGuardedBanAction(formData());

    expect(migrations.enableBanGuard).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: 'session-owner',
    });
    expect(migrations.rollbackBanGuard).toHaveBeenCalledWith({
      guildId: '100',
      actorUserId: 'session-owner',
    });
  });

  it('requires explicit owner confirmation before Guarded enable', async () => {
    const migrations = { enableBanGuard: vi.fn() };
    mocks.auth.mockResolvedValue({ user: { id: 'session-owner' } });
    const repositories = { guilds: {}, managers: {}, staff: {} };
    mocks.getWebRuntime.mockReturnValue({ repositories });
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getWebSetupServices.mockReturnValue({ setup: {}, migrations });

    await expect(enableGuardedBanAction(formData())).rejects.toThrow('explicit owner confirmation');
    expect(migrations.enableBanGuard).not.toHaveBeenCalled();
  });

  it('fails safely when live Discord setup credentials are not configured', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'session-owner' } });
    const repositories = { guilds: {}, managers: {}, staff: {} };
    mocks.getWebRuntime.mockReturnValue({ repositories });
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getWebSetupServices.mockReturnValue(null);

    await expect(enableGuardedBanAction(formData())).rejects.toThrow(
      'Live Discord setup operations are unavailable',
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
