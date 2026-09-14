import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireGuildAccess: vi.fn(),
  getWebRuntime: vi.fn(),
  getWebSetupServices: vi.fn(),
  getPreflight: vi.fn(),
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
  factoryResetAction: vi.fn(),
}));
vi.mock('../../../../lib/factory-reset-service', () => ({
  FactoryResetService: class { getPreflight = mocks.getPreflight; },
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import SetupPage from './page';

describe('setup page', () => {
  beforeEach(() => mocks.getPreflight.mockResolvedValue({ allowed: true, isOwner: true, blockers: [] }));
  it('presents no-op Guarded Moderation as activatable without raw implementation labels', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } });
    const runtime = { repositories: {} };
    mocks.getWebRuntime.mockReturnValue(runtime);
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getWebSetupServices.mockReturnValue({
      setup: { getState: vi.fn().mockResolvedValue({
        mode: 'TEST', step: 'COMPLETE', completedSteps: ['COMPLETE'], profileCount: 1,
        profileReady: true, securityManagerCount: 0, securityManagerIds: [],
        manageRolesReady: true, hierarchyHealthy: true, blockingRoleIds: [],
        currentStepReady: true, currentStepBlockers: [], protectedResourceCount: 0,
        nextAction: 'Review Knight protection status.',
      }) },
      migrations: { previewBanGuard: vi.fn().mockResolvedValue({ blocked: false, staffCount: 0, roles: [] }) },
    });
    const html = renderToStaticMarkup(await SetupPage({ params: Promise.resolve({ guildId: '100' }) }));
    expect(html).toContain('Guarded Moderation');
    expect(html).toContain('No native moderation permissions need removal');
    for (const check of [
      'Setup complete',
      'Current user is owner',
      'Knight has Manage Roles',
      'Knight role hierarchy healthy',
      'Emergency state permits configuration',
      'No native permissions need removal',
    ]) expect(html).toContain(check);
    expect(html).not.toContain('MEMBER_BAN Guarded');
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Enable Guarded moderation/);
    for (const step of ['Health', 'Staff', 'Policies', 'Logging', 'Protection', 'Backups', 'Review']) expect(html).toContain(step);
    expect(html).toContain('Danger Zone');
    expect(html).toContain('RESET KNIGHT');
    expect(html).toContain('Discord roles, channels, members, webhooks, and permissions are not touched');
  });
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
          currentStepReady: true,
          currentStepBlockers: [],
          protectedResourceCount: 0,
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
    expect(html).toContain('Security, Moderation, Messages, and Voice');
  });
  it('shows setup blockers, links to the relevant configuration, and disables advancement', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } });
    const runtime = { repositories: {} };
    mocks.getWebRuntime.mockReturnValue(runtime);
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getWebSetupServices.mockReturnValue({
      setup: {
        getState: vi.fn().mockResolvedValue({
          mode: 'OBSERVE', step: 'BACKUPS', completedSteps: [],
          profileCount: 1, profileReady: true, securityManagerCount: 0,
          securityManagerIds: [], manageRolesReady: true, hierarchyHealthy: true,
          blockingRoleIds: [], currentStepReady: false,
          currentStepBlockers: ['Save an explicit backup policy before continuing; Disabled is valid.'],
          protectedResourceCount: 0, nextAction: 'Continue setup to OBSERVE.',
        }),
      },
      migrations: {},
    });

    const html = renderToStaticMarkup(
      await SetupPage({ params: Promise.resolve({ guildId: '100' }) }),
    );

    expect(html).toContain('Save an explicit backup policy before continuing');
    expect(html).toContain('href="/guilds/100/recovery"');
    expect(html).toContain('disabled=""');
  });

  it('shows a safe reset notice without rendering URL-controlled text', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } });
    mocks.getWebRuntime.mockReturnValue({ repositories: {} });
    mocks.requireGuildAccess.mockResolvedValue('OWNER');
    mocks.getWebSetupServices.mockReturnValue({ setup: { getState: vi.fn().mockResolvedValue({
      mode: 'OBSERVE', step: 'WELCOME', completedSteps: [], profileCount: 0, profileReady: false,
      securityManagerCount: 0, securityManagerIds: [], manageRolesReady: true, hierarchyHealthy: true,
      blockingRoleIds: [], currentStepReady: true, currentStepBlockers: [], protectedResourceCount: 0,
      nextAction: 'Continue setup.',
    }) }, migrations: {} });
    const html = renderToStaticMarkup(await SetupPage({ params: Promise.resolve({ guildId: '100' }), searchParams: Promise.resolve({ notice: 'reset-queued<script>' }) }));
    expect(html).not.toContain('reset-queued&lt;script&gt;');
  });

});
