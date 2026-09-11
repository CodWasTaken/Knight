import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getWebRuntime: vi.fn() }));

vi.mock('../../../../lib/server-runtime', () => ({ getWebRuntime: mocks.getWebRuntime }));

import LogsPage from './page';

describe('security logs page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the latest 100 ledger entries with supported query filters', async () => {
    const listRecent = vi.fn().mockResolvedValue([
      {
        id: 7,
        createdAt: new Date('2026-09-12T10:30:00.000Z'),
        severity: 'HIGH',
        source: 'KNIGHT',
        action: 'member.ban',
        actorUserId: 'actor-1',
        targetId: 'target-1',
        decisionId: 'decision-1',
        incidentId: 'incident-1',
        metadata: { secretDetail: 'do not render by default' },
      },
    ]);
    mocks.getWebRuntime.mockReturnValue({ repositories: { securityLedger: { listRecent } } });

    const html = renderToStaticMarkup(
      await LogsPage({
        params: Promise.resolve({ guildId: '100' }),
        searchParams: Promise.resolve({
          source: ' KNIGHT ',
          action: 'member.ban',
          severity: 'HIGH',
          actor: 'actor-1',
          target: 'target-1',
        }),
      }),
    );

    expect(listRecent).toHaveBeenCalledWith('100', {
      source: 'KNIGHT',
      action: 'member.ban',
      severity: 'HIGH',
      actorUserId: 'actor-1',
      targetId: 'target-1',
      limit: 100,
    });
    for (const value of [
      'HIGH',
      'KNIGHT',
      'member.ban',
      'actor-1',
      'target-1',
      'decision-1',
      'incident-1',
    ]) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain('secretDetail');
  });

  it('ignores an unsupported severity filter and shows an empty state', async () => {
    const listRecent = vi.fn().mockResolvedValue([]);
    mocks.getWebRuntime.mockReturnValue({ repositories: { securityLedger: { listRecent } } });

    const html = renderToStaticMarkup(
      await LogsPage({
        params: Promise.resolve({ guildId: '100' }),
        searchParams: Promise.resolve({ severity: 'URGENT' }),
      }),
    );

    expect(listRecent).toHaveBeenCalledWith('100', { limit: 100 });
    expect(html).toContain('No ledger entries match these filters.');
  });
});
