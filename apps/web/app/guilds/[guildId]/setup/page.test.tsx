import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireGuildAccess: vi.fn(),
  getWebRuntime: vi.fn(),
  getWebSetupServices: vi.fn(),
}));

vi.mock('../../../../auth', () => ({ auth: mocks.auth }));
vi.mock('../../../../lib/authorization', () => ({
  requireGuildAccess: mocks.requireGuildAccess,
}));
vi.mock('../../../../lib/server-runtime', () => ({ getWebRuntime: mocks.getWebRuntime }));
vi.mock('../../../../lib/setup-runtime', () => ({
  getWebSetupServices: mocks.getWebSetupServices,
}));
vi.mock('./actions', () => ({
  advanceSetupAction: vi.fn(),
  enableGuardedBanAction: vi.fn(),
  enterTestModeAction: vi.fn(),
  rollbackGuardedBanAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import SetupPage from './page';

describe('setup page', () => {
  it('links the LOGGING step to an explicit notification choice', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } });
    const runtime = { repositories: {} };
    mocks.getWebRuntime.mockReturnValue(runtime);
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getWebSetupServices.mockReturnValue({
      setup: {
        getState: vi.fn().mockResolvedValue({
          mode: 'OBSERVE',
          step: 'LOGGING',
          completedSteps: ['WELCOME', 'HEALTH', 'STAFF', 'POLICIES'],
          profileCount: 1,
          profileReady: true,
          securityManagerCount: 0,
          securityManagerIds: [],
          manageRolesReady: true,
          hierarchyHealthy: true,
          blockingRoleIds: [],
          nextAction: 'Continue setup to PROTECTION.',
        }),
      },
      migrations: {},
    });

    const html = renderToStaticMarkup(
      await SetupPage({ params: Promise.resolve({ guildId: '100' }) }),
    );

    expect(html).toContain('href="/guilds/100/logging"');
    expect(html).toContain('Choosing Disabled is valid');
  });
});
