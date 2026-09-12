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

import { saveLoggingSettingsAction } from './actions';

function formData(security = '', moderation = ''): FormData {
  const data = new FormData();
  data.set('guildId', '100');
  data.set('securityChannelId', security);
  data.set('moderationChannelId', moderation);
  return data;
}
function setup() {
  const saveLoggingSettings = vi.fn().mockResolvedValue(undefined);
  const append = vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' });
  const repositories = {
    guilds: {},
    managers: {},
    staff: {},
    securityLedger: { append, saveLoggingSettings },
    security: {
      getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    },
  };
  const discord = {
    listTextChannels: vi.fn().mockResolvedValue([
      { channelId: 'security', name: 'security-log' },
      { channelId: 'moderation', name: 'moderation-log' },
    ]),
    canSendToChannel: vi.fn().mockResolvedValue(true),
  };
  mocks.auth.mockResolvedValue({ user: { id: 'session-user' } });
  mocks.getWebRuntime.mockReturnValue({ repositories });
  mocks.getWebDiscordAdapter.mockReturnValue(discord);
  mocks.requireGuildAccess.mockResolvedValue('SECURITY_MANAGER');
  return { repositories, discord, append, saveLoggingSettings };
}

describe('logging settings action', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts explicit Disabled values and uses the authenticated actor', async () => {
    const { repositories, saveLoggingSettings } = setup();
    await saveLoggingSettingsAction(formData());
    expect(mocks.requireGuildAccess).toHaveBeenCalledWith(
      '100',
      { user: { id: 'session-user' } },
      repositories,
    );
    expect(saveLoggingSettings).toHaveBeenCalledWith({
      guildId: '100',
      securityChannelId: null,
      moderationChannelId: null,
      updatedBy: 'session-user',
    });
  });

  it('persists validated guild channels', async () => {
    const { discord, append, saveLoggingSettings } = setup();
    await saveLoggingSettingsAction(formData('security', 'moderation'));
    expect(discord.canSendToChannel).toHaveBeenCalledTimes(2);
    expect(saveLoggingSettings).toHaveBeenCalledWith({
      guildId: '100',
      securityChannelId: 'security',
      moderationChannelId: 'moderation',
      updatedBy: 'session-user',
    });
    expect(append).toHaveBeenCalledWith({
      guildId: '100',
      severity: 'LOW',
      source: 'CONFIG',
      action: 'logging.settings.update',
      actorUserId: 'session-user',
      targetId: '100',
      decisionId: null,
      incidentId: null,
      metadata: {
        securityChannelId: 'security',
        moderationChannelId: 'moderation',
      },
    });
    expect(saveLoggingSettings.mock.invocationCallOrder[0]).toBeLessThan(
      append.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps a durably saved choice successful when its ledger hook fails', async () => {
    const { append, saveLoggingSettings } = setup();
    append.mockRejectedValue(new Error('ledger unavailable after save'));

    await expect(saveLoggingSettingsAction(formData())).resolves.toBeUndefined();

    expect(saveLoggingSettings).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/guilds/100/logging');
  });

  it('rejects a submitted channel that is not in the guild channel list', async () => {
    const { saveLoggingSettings } = setup();
    await expect(saveLoggingSettingsAction(formData('outside'))).rejects.toThrow(
      'valid guild text channel',
    );
    expect(saveLoggingSettings).not.toHaveBeenCalled();
  });

  it('rejects a channel Knight cannot view and send to', async () => {
    const { discord, saveLoggingSettings } = setup();
    discord.canSendToChannel.mockResolvedValueOnce(false);
    await expect(saveLoggingSettingsAction(formData('security'))).rejects.toThrow('cannot send');
    expect(saveLoggingSettings).not.toHaveBeenCalled();
  });

  it('can explicitly disable both notification destinations without a Discord token', async () => {
    const { saveLoggingSettings } = setup();
    mocks.getWebDiscordAdapter.mockReturnValue(null);
    await saveLoggingSettingsAction(formData());
    expect(saveLoggingSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        securityChannelId: null,
        moderationChannelId: null,
      }),
    );
  });

  it('fails safely when the web Discord adapter is unavailable', async () => {
    const { saveLoggingSettings } = setup();
    mocks.getWebDiscordAdapter.mockReturnValue(null);
    await expect(saveLoggingSettingsAction(formData('security'))).rejects.toThrow(
      'Live Discord logging',
    );
    expect(saveLoggingSettings).not.toHaveBeenCalled();
  });

  it('blocks logging configuration during Panic', async () => {
    const { repositories, saveLoggingSettings } = setup();
    repositories.security.getSecurityState.mockResolvedValueOnce({
      mode: 'PANIC',
      lockedScopes: [],
    });

    await expect(saveLoggingSettingsAction(formData())).rejects.toThrow('emergency state');
    expect(saveLoggingSettings).not.toHaveBeenCalled();
  });
});
