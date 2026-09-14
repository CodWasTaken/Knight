import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getWebRuntime: vi.fn(), getWebDiscordAdapter: vi.fn() }));
vi.mock('../../../lib/server-runtime', () => ({ getWebRuntime: mocks.getWebRuntime }));
vi.mock('../../../lib/discord-runtime', () => ({ getWebDiscordAdapter: mocks.getWebDiscordAdapter }));
import GuildHome from './page';

describe('guild overview', () => {
  it('shows the live server name and core operations status with a next action', async () => {
    mocks.getWebRuntime.mockReturnValue({ repositories: {
      guilds: { get: vi.fn().mockResolvedValue({ id: '100', mode: 'OBSERVE' }), getSetupState: vi.fn().mockResolvedValue({ step: 'LOGGING', completedSteps: ['WELCOME'] }) },
      securityLedger: { getLoggingSettings: vi.fn().mockResolvedValue({ securityChannelId: 's', moderationChannelId: null, messageChannelId: 'm', voiceChannelId: 'v' }) },
      backups: { getPolicy: vi.fn().mockResolvedValue({ mode: 'DAILY' }), listBackups: vi.fn().mockResolvedValue([{ status: 'COMPLETED' }]) },
      security: { getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL' }) },
      staff: { listProfiles: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
    } });
    mocks.getWebDiscordAdapter.mockReturnValue({ getGuildIdentity: vi.fn().mockResolvedValue({ guildId: '100', name: 'Knight Ops' }) });
    const html = renderToStaticMarkup(await GuildHome({ params: Promise.resolve({ guildId: '100' }) }));
    for (const text of ['Knight Ops', 'OBSERVE', 'Setup progress', 'Security', 'Moderation', 'Messages', 'Voice', 'DAILY', 'NORMAL', 'Staff Profiles', 'Next action']) expect(html).toContain(text);
  });
});
