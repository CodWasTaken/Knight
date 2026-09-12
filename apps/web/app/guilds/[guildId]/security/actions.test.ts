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

import { saveFirewallSettingsAction, saveInventoryTrustAction } from './actions';
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
});
