import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getWebRuntime: vi.fn() }));
vi.mock('../../../../lib/server-runtime', () => ({ getWebRuntime: mocks.getWebRuntime }));
vi.mock('./actions', () => ({
  activateLockdownAction: vi.fn(),
  activatePanicAction: vi.fn(),
  clearLockdownAction: vi.fn(),
  clearPanicAction: vi.fn(),
  saveFirewallSettingsAction: vi.fn(),
  saveInventoryTrustAction: vi.fn(),
}));

import SecurityPage from './page';

describe('security dashboard page', () => {
  it('renders current emergency state and separate recovery controls', async () => {
    mocks.getWebRuntime.mockReturnValue({
      repositories: {
        security: {
          getSecurityState: vi.fn().mockResolvedValue({
            mode: 'LOCKDOWN',
            lockedScopes: ['MEMBER_MODERATION'],
            reason: 'Investigating access',
            updatedBy: 'manager-1',
            updatedAt: new Date('2026-09-12T10:00:00Z'),
          }),
          getFirewallSettings: vi.fn().mockResolvedValue({
            botMode: 'OBSERVE',
            webhookMode: 'OBSERVE',
            configured: true,
          }),
          listActiveIncidents: vi.fn().mockResolvedValue([]),
          listBotInventory: vi.fn().mockResolvedValue([]),
          listWebhookInventory: vi.fn().mockResolvedValue([]),
        },
      },
    });

    const html = renderToStaticMarkup(
      await SecurityPage({ params: Promise.resolve({ guildId: '100' }) }),
    );

    expect(html).toContain('Emergency state');
    expect(html).toContain('LOCKDOWN');
    expect(html).toContain('MEMBER_MODERATION');
    expect(html).toContain('Investigating access');
    expect(html).toContain('Enable Lockdown');
    expect(html).toContain('Clear Lockdown');
    expect(html).toContain('Activate Panic');
    expect(html).toContain('Clear Panic');
    expect(html).toContain('name="confirm"');
  });
});
