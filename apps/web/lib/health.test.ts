import { describe, expect, it, vi } from 'vitest';
import { checkReadiness } from './health';

describe('checkReadiness', () => {
  it('reports PostgreSQL and Redis ready only when both probes succeed', async () => {
    const result = await checkReadiness({
      postgres: vi.fn().mockResolvedValue(undefined),
      redis: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toEqual({
      status: 200,
      body: {
        status: 'ready',
        components: { postgres: 'ok', redis: 'ok' },
      },
    });
  });

  it('returns non-secret component state with 503 when a probe fails', async () => {
    const result = await checkReadiness({
      postgres: vi.fn().mockRejectedValue(new Error('postgres://user:password@db/knight')),
      redis: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      status: 'not_ready',
      components: { postgres: 'error', redis: 'ok' },
    });

    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('postgres://');
  });
});
