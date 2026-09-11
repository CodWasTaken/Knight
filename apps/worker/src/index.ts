import { pathToFileURL } from 'node:url';
import { parseEnv } from '@knight/config';
import { createDatabase } from '@knight/database/client';
import { createRedis } from '@knight/redis';

export type WorkerDependencies = Readonly<{
  createDatabase(url: string): {
    pool: {
      query(sql: string): Promise<unknown>;
      end(): Promise<void>;
    };
  };
  createRedis(url: string): {
    ping(): Promise<string>;
    quit(): Promise<unknown>;
  };
  onSigterm(handler: () => void): void;
}>;

const defaultDependencies: WorkerDependencies = {
  createDatabase,
  createRedis,
  onSigterm: (handler) => process.once('SIGTERM', handler),
};

export async function startWorker(
  inputEnv: Record<string, string | undefined>,
  dependencies: WorkerDependencies = defaultDependencies,
) {
  const env = parseEnv(inputEnv);
  const database = dependencies.createDatabase(env.DATABASE_URL);
  const redis = dependencies.createRedis(env.REDIS_URL);
  let closed = false;

  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([database.pool.end(), redis.quit()]);
  };

  try {
    await database.pool.query('select 1');
    await redis.ping();
  } catch (error) {
    await shutdown();
    throw error;
  }

  dependencies.onSigterm(() => {
    void shutdown();
  });

  return { shutdown } as const;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  startWorker(process.env).catch(() => {
    process.exitCode = 1;
  });
}
