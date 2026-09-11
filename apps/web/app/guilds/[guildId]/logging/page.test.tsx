import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWebRuntime: vi.fn(),
  getWebDiscordAdapter: vi.fn(),
}));

vi.mock('../../../../lib/server-runtime', () => ({ getWebRuntime: mocks.getWebRuntime }));
vi.mock('../../../../lib/discord-runtime', () => ({
  getWebDiscordAdapter: mocks.getWebDiscordAdapter,
}));
vi.mock('./actions', () => ({ saveLoggingSettingsAction: vi.fn() }));

import LoggingPage from './page';

describe('logging settings page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads current settings and existing Discord text channels', async () => {
    const getLoggingSettings = vi.fn().mockResolvedValue({
      securityChannelId: 'security',
      moderationChannelId: null,
    });
    const listTextChannels = vi.fn().mockResolvedValue([
      { channelId: 'security', name: 'security-log' },
      { channelId: 'moderation', name: 'moderation-log' },
    ]);
    const runtime = { repositories: { securityLedger: { getLoggingSettings } } };
    mocks.getWebRuntime.mockReturnValue(runtime);
    mocks.getWebDiscordAdapter.mockReturnValue({ listTextChannels });

    const html = renderToStaticMarkup(
      await LoggingPage({ params: Promise.resolve({ guildId: '100' }) }),
    );

    expect(getLoggingSettings).toHaveBeenCalledWith('100');
    expect(listTextChannels).toHaveBeenCalledWith('100');
    expect(html).toContain('Security destination');
    expect(html).toContain('Moderation destination');
    expect(html).toContain('Disabled');
    expect(html).toContain('security-log');
    expect(html).toContain('moderation-log');
    expect(html).toContain('value="security" selected=""');
  });

  it('keeps Disabled settings available when live Discord validation is unavailable', async () => {
    mocks.getWebRuntime.mockReturnValue({
      repositories: { securityLedger: { getLoggingSettings: vi.fn().mockResolvedValue(null) } },
    });
    mocks.getWebDiscordAdapter.mockReturnValue(null);

    const html = renderToStaticMarkup(
      await LoggingPage({ params: Promise.resolve({ guildId: '100' }) }),
    );

    expect(html).toContain('Live Discord validation is unavailable');
    expect(html).toContain('name="securityChannelId"');
    expect(html).toContain('name="moderationChannelId"');
    expect(html.match(/value=""/g)).toHaveLength(2);
    expect(html).toContain('Save logging settings');
  });
});
