import { pathToFileURL } from 'node:url';
import { parseEnv } from '@knight/config';
import {
  BackupRepository,
  createDatabase,
  SecurityLedgerRepository,
  SecurityRepository,
  StaffRepository,
} from '@knight/database';
import { createDiscordRestStructureAdapter } from '@knight/discord';
import { createRedis, LockStore } from '@knight/redis';
import { BackupService } from './backups/backup-service.js';
import { LocalBackupStorage } from './backups/local-backup-storage.js';
import { RestoreService } from './backups/restore-service.js';

type WorkerDatabase = {
  pool: {
    query(sql: string): Promise<unknown>;
    end(): Promise<void>;
  };
};

type WorkerRedis = {
  ping(): Promise<string>;
  quit(): Promise<unknown>;
};
type WorkerBackupService = { runTick(now: Date): Promise<void> };
type ParsedEnv = ReturnType<typeof parseEnv>;

export type WorkerDependencies = Readonly<{
  createDatabase(url: string): WorkerDatabase;
  createRedis(url: string): WorkerRedis;
  createBackupService(input: { database: WorkerDatabase; redis: WorkerRedis; env: ParsedEnv }): WorkerBackupService;
  setInterval(handler: () => void, milliseconds: number): unknown;
  clearInterval(timer: unknown): void;
  onSigterm(handler: () => void): void;
}>;

function createDefaultBackupService(input: {
  database: WorkerDatabase;
  redis: WorkerRedis;
  env: ParsedEnv;
}): WorkerBackupService {
  const database = input.database as ReturnType<typeof createDatabase>;
  const backups = new BackupRepository(database);
  const discord = createDiscordRestStructureAdapter(input.env.DISCORD_TOKEN);
  const staff = new StaffRepository(database);
  const ledger = new SecurityLedgerRepository(database);
  const security = new SecurityRepository(database);
  const storage = new LocalBackupStorage(input.env.KNIGHT_BACKUP_DIR);
  const restore = new RestoreService({
    backups, discord, staff, ledger, security, storage,
    locks: new LockStore(input.redis as ReturnType<typeof createRedis>),
  });
  return new BackupService({
    backups, discord, staff, ledger, security, storage, restore,
    archiveEnabled: input.env.ENABLE_MESSAGE_CONTENT_ARCHIVE,
    now: () => new Date(),
  });
}
const defaultDependencies: WorkerDependencies = {
  createDatabase,
  createRedis,
  createBackupService: createDefaultBackupService,
  setInterval: (handler, milliseconds) => setInterval(handler, milliseconds),
  clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
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
  let timer: unknown | null = null;
  let activeTick: Promise<void> | null = null;

  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (timer !== null) dependencies.clearInterval(timer);
    await activeTick;
    await Promise.allSettled([database.pool.end(), redis.quit()]);
  };

  try {
    await database.pool.query('select 1');
    await redis.ping();
  } catch (error) {
    await shutdown();
    throw error;
  }

  const backupService = dependencies.createBackupService({ database, redis, env });
  const tick = (): void => {
    if (closed || activeTick !== null) return;
    const promise = backupService
      .runTick(new Date())
      .catch(() => {
        console.error('Knight backup worker tick failed safely.');
      })
      .finally(() => {
        if (activeTick === promise) activeTick = null;
      });
    activeTick = promise;
  };
  timer = dependencies.setInterval(tick, 60_000);

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
