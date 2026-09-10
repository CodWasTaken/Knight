import { describe, expect, it, vi } from 'vitest';
import { createReadyResponse } from '../../../lib/health-response';
import { GET as getLive } from './live/route';
import * as readyRoute from './ready/route';

describe('health routes', () => {
  it('exports only supported Next route fields from the readiness route', () => {
    expect(Object.keys(readyRoute).sort()).toEqual(['GET']);
  });

  it('returns a minimal live process response', async () => {
    const response = await getLive();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'live' });
  });

  it('returns 503 with only component state when readiness fails', async () => {
    const response = await createReadyResponse({
      postgres: vi.fn().mockRejectedValue(new Error('postgres://secret')),
      redis: vi.fn().mockResolvedValue(undefined),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'not_ready',
      components: { postgres: 'error', redis: 'ok' },
    });
  });
});
