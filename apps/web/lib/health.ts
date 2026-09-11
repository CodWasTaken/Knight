export type HealthComponentState = 'ok' | 'error';

export type ReadinessResult = Readonly<{
  status: 200 | 503;
  body: Readonly<{
    status: 'ready' | 'not_ready';
    components: Readonly<{
      postgres: HealthComponentState;
      redis: HealthComponentState;
    }>;
  }>;
}>;

export async function checkReadiness(probes: {
  postgres(): Promise<void>;
  redis(): Promise<void>;
}): Promise<ReadinessResult> {
  const [postgres, redis] = await Promise.allSettled([probes.postgres(), probes.redis()]);
  const components = {
    postgres: postgres.status === 'fulfilled' ? 'ok' : 'error',
    redis: redis.status === 'fulfilled' ? 'ok' : 'error',
  } as const;
  const ready = components.postgres === 'ok' && components.redis === 'ok';

  return {
    status: ready ? 200 : 503,
    body: { status: ready ? 'ready' : 'not_ready', components },
  };
}
