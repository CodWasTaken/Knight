import { ProtectionLevel } from '@knight/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getWebRuntime: vi.fn(),
  getWebDiscordAdapter: vi.fn(),
  requireGuildAccess: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../../../../auth', () => ({ auth: mocks.auth }));
vi.mock('../../../../lib/authorization', () => ({ requireGuildAccess: mocks.requireGuildAccess }));
vi.mock('../../../../lib/server-runtime', () => ({ getWebRuntime: mocks.getWebRuntime }));
vi.mock('../../../../lib/discord-runtime', () => ({
  getWebDiscordAdapter: mocks.getWebDiscordAdapter,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import {
  activateLockdownAction,
  activatePanicAction,
  clearLockdownAction,
  clearPanicAction,
  saveFirewallSettingsAction,
  saveInventoryTrustAction,
} from './actions';
import {
  removeProtectedResourceAction,
  saveProtectedResourceAction,
} from './protected/actions';

function data(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
}

function setup() {
  const security = {
    saveFirewallSettings: vi.fn().mockResolvedValue({}),
    setBotTrustState: vi.fn().mockResolvedValue({ botUserId: '111', trustState: 'TRUSTED' }),
    setWebhookTrustState: vi.fn().mockResolvedValue({
      webhookId: '222',
      trustState: 'APPROVED',
    }),
    saveProtection: vi.fn().mockResolvedValue({}),
    getProtectionLevel: vi.fn().mockResolvedValue(ProtectionLevel.Critical),
    removeProtection: vi.fn().mockResolvedValue(undefined),
    getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    transitionSecurityState: vi.fn().mockResolvedValue({}),
    findOrCreateIncident: vi.fn().mockResolvedValue({ id: 'incident-1' }),
  };
  const repositories = {
    guilds: {},
    managers: {},
    staff: {},
    security,
    securityLedger: { append: vi.fn().mockResolvedValue({}) },
  };
  const discord = {
    getGuildState: vi.fn().mockResolvedValue({
      roles: [
        { roleId: '333', name: 'Staff', managed: false },
        { roleId: '444', name: 'Managed', managed: true },
      ],
    }),
    getMemberState: vi.fn().mockResolvedValue({ userId: '555' }),
    getGuildChannelState: vi.fn().mockResolvedValue({ channelId: '666', name: 'general' }),
  };
  mocks.auth.mockResolvedValue({ user: { id: 'session-user' } });
  mocks.getWebRuntime.mockReturnValue({ repositories });
  mocks.getWebDiscordAdapter.mockReturnValue(discord);
  mocks.requireGuildAccess.mockResolvedValue('SECURITY_MANAGER');
  return { repositories, security, discord };
}

describe('security dashboard actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves valid firewall modes with the authenticated actor', async () => {
    const { repositories, security } = setup();

    await saveFirewallSettingsAction(
      data({ guildId: '100', botMode: 'OBSERVE', webhookMode: 'ENFORCE', actorUserId: 'forged' }),
    );

    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(
      '100',
      { user: { id: 'session-user' } },
      repositories,
    );
    expect(security.saveFirewallSettings).toHaveBeenCalledWith({
      guildId: '100',
      botMode: 'OBSERVE',
      webhookMode: 'ENFORCE',
      updatedBy: 'session-user',
    });
  });

  it('rejects an invalid firewall mode before persistence', async () => {
    const { security } = setup();
    await expect(
      saveFirewallSettingsAction(
        data({ guildId: '100', botMode: 'DELETE_ALL', webhookMode: 'OBSERVE' }),
      ),
    ).rejects.toThrow('firewall mode');
    expect(security.saveFirewallSettings).not.toHaveBeenCalled();
  });

  it('blocks firewall configuration while bots and webhooks are locked down', async () => {
    const { security } = setup();
    security.getSecurityState.mockResolvedValueOnce({
      mode: 'LOCKDOWN',
      lockedScopes: ['BOTS_WEBHOOKS'],
    });

    await expect(
      saveFirewallSettingsAction(
        data({ guildId: '100', botMode: 'OBSERVE', webhookMode: 'ALERT' }),
      ),
    ).rejects.toThrow('emergency state');
    expect(security.saveFirewallSettings).not.toHaveBeenCalled();
  });

  it('blocks inventory trust changes during Panic', async () => {
    const { security } = setup();
    security.getSecurityState.mockResolvedValueOnce({ mode: 'PANIC', lockedScopes: [] });

    await expect(
      saveInventoryTrustAction(
        data({ guildId: '100', inventoryType: 'BOT', resourceId: '111', trustState: 'BLOCKED' }),
      ),
    ).rejects.toThrow('emergency state');
    expect(security.setBotTrustState).not.toHaveBeenCalled();
  });

  it('rejects an inventory ID that is not stored in the authorized guild', async () => {
    const { security } = setup();
    security.setBotTrustState.mockResolvedValueOnce(null);

    await expect(
      saveInventoryTrustAction(
        data({ guildId: '100', inventoryType: 'BOT', resourceId: '111', trustState: 'BLOCKED' }),
      ),
    ).rejects.toThrow('inventory entry');
  });

  it('rejects malformed protected resource IDs', async () => {
    const { security, discord } = setup();
    await expect(
      saveProtectedResourceAction(
        data({ guildId: '100', resourceType: 'USER', resourceId: 'not-an-id', level: 'CRITICAL' }),
      ),
    ).rejects.toThrow('resource ID');
    expect(discord.getMemberState).not.toHaveBeenCalled();
    expect(security.saveProtection).not.toHaveBeenCalled();
  });

  it('blocks protected-resource configuration during security Lockdown', async () => {
    const { security } = setup();
    security.getSecurityState.mockResolvedValueOnce({
      mode: 'LOCKDOWN',
      lockedScopes: ['SECURITY_CONFIG'],
    });

    await expect(
      saveProtectedResourceAction(
        data({ guildId: '100', resourceType: 'USER', resourceId: '555', level: 'CRITICAL' }),
      ),
    ).rejects.toThrow('emergency state');
    expect(security.saveProtection).not.toHaveBeenCalled();
  });

  it('rejects managed roles and channels outside the authorized guild', async () => {
    const { security, discord } = setup();
    await expect(
      saveProtectedResourceAction(
        data({ guildId: '100', resourceType: 'ROLE', resourceId: '444', level: 'IMMUTABLE' }),
      ),
    ).rejects.toThrow('managed role');

    discord.getGuildChannelState.mockResolvedValueOnce(null);
    await expect(
      saveProtectedResourceAction(
        data({ guildId: '100', resourceType: 'CHANNEL', resourceId: '777', level: 'IMPORTANT' }),
      ),
    ).rejects.toThrow('does not belong');
    expect(security.saveProtection).not.toHaveBeenCalled();
  });

  it('rejects removing a protected resource that is not stored for this guild', async () => {
    const { security } = setup();
    security.getProtectionLevel.mockResolvedValueOnce(ProtectionLevel.Normal);

    await expect(
      removeProtectedResourceAction(
        data({ guildId: '100', resourceType: 'ROLE', resourceId: '333' }),
      ),
    ).rejects.toThrow('does not belong');
    expect(security.removeProtection).not.toHaveBeenCalled();
  });

  it('saves an existing member protection with the session actor', async () => {
    const { security } = setup();
    await saveProtectedResourceAction(
      data({ guildId: '100', resourceType: 'USER', resourceId: '555', level: 'CRITICAL' }),
    );

    expect(security.saveProtection).toHaveBeenCalledWith({
      guildId: '100',
      resourceType: 'USER',
      resourceId: '555',
      level: ProtectionLevel.Critical,
      updatedBy: 'session-user',
    });
  });

  it('allows an authorized Security Manager to activate and clear Lockdown', async () => {
    const { security } = setup();
    await activateLockdownAction(
      data({ guildId: '100', scope: 'SECURITY_CONFIG', reason: 'Investigating access' }),
    );
    await clearLockdownAction(
      data({ guildId: '100', reason: 'Investigation complete' }),
    );

    expect(security.transitionSecurityState).toHaveBeenNthCalledWith(1, {
      guildId: '100',
      expectedModes: ['NORMAL', 'LOCKDOWN'],
      mode: 'LOCKDOWN',
      lockedScopes: ['SECURITY_CONFIG'],
      reason: 'Investigating access',
      updatedBy: 'session-user',
    });
    expect(security.transitionSecurityState).toHaveBeenNthCalledWith(2, {
      guildId: '100',
      expectedModes: ['LOCKDOWN'],
      mode: 'NORMAL',
      lockedScopes: [],
      reason: 'Investigation complete',
      updatedBy: 'session-user',
    });
  });

  it('allows the owner and rejects a denied user through guild authorization', async () => {
    const { security } = setup();
    mocks.requireGuildAccess.mockResolvedValueOnce('OWNER');
    await activateLockdownAction(
      data({ guildId: '100', scope: 'FULL', reason: 'Owner containment' }),
    );
    expect(security.transitionSecurityState).toHaveBeenCalledTimes(1);

    mocks.requireGuildAccess.mockRejectedValueOnce(new Error('denied'));
    await expect(
      activateLockdownAction(
        data({ guildId: '100', scope: 'FULL', reason: 'Unauthorized request' }),
      ),
    ).rejects.toThrow('denied');
    expect(security.transitionSecurityState).toHaveBeenCalledTimes(1);
  });

  it('rejects arbitrary Lockdown scopes before persistence', async () => {
    const { security } = setup();

    await expect(
      activateLockdownAction(
        data({ guildId: '100', scope: 'CUSTOM_SCOPE', reason: 'Investigating' }),
      ),
    ).rejects.toThrow('Lockdown scope');
    expect(security.transitionSecurityState).not.toHaveBeenCalled();
  });

  it('requires explicit Panic confirmation and records a confirmed incident', async () => {
    const { security, repositories } = setup();

    await expect(
      activatePanicAction(data({ guildId: '100', reason: 'Confirmed compromise' })),
    ).rejects.toThrow('confirmation');
    expect(security.transitionSecurityState).not.toHaveBeenCalled();

    await activatePanicAction(
      data({ guildId: '100', reason: 'Confirmed compromise', confirm: 'on' }),
    );
    expect(security.transitionSecurityState).toHaveBeenCalledWith({
      guildId: '100',
      expectedModes: ['NORMAL', 'LOCKDOWN', 'PANIC'],
      mode: 'PANIC',
      lockedScopes: [],
      reason: 'Confirmed compromise',
      updatedBy: 'session-user',
    });
    expect(security.findOrCreateIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: '100',
        actorKey: 'emergency:panic',
        severity: 'CRITICAL',
      }),
    );
    expect(repositories.securityLedger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.panic.enabled',
        actorUserId: 'session-user',
        incidentId: 'incident-1',
      }),
    );
  });

  it('only clears Panic through the explicit Panic recovery action', async () => {
    const { security } = setup();
    await clearPanicAction(data({ guildId: '100', reason: 'Access restored' }));

    expect(security.transitionSecurityState).toHaveBeenCalledWith({
      guildId: '100',
      expectedModes: ['PANIC'],
      mode: 'NORMAL',
      lockedScopes: [],
      reason: 'Access restored',
      updatedBy: 'session-user',
    });
  });

  it('does not report success when the authoritative ledger append fails after persistence', async () => {
    const { security, repositories } = setup();
    repositories.securityLedger.append.mockRejectedValueOnce(new Error('ledger unavailable'));

    await expect(
      activateLockdownAction(
        data({ guildId: '100', scope: 'FULL', reason: 'Incident containment' }),
      ),
    ).rejects.toThrow('ledger unavailable');
    expect(security.transitionSecurityState).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith('/guilds/100/security');
  });
});
