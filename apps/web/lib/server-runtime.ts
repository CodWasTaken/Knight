import 'server-only';

import { parseWebEnv, type WebEnv } from '@knight/config';
import { createDatabase, type Database } from '@knight/database/client';
import { createWebRepositories, type WebRepositories } from './server-dependencies';

let database: Database | undefined;

export type WebRuntime = Readonly<{
  env: WebEnv;
  database: Database;
  repositories: WebRepositories;
}>;

export function getWebRuntime(): WebRuntime {
  const env = parseWebEnv(process.env);
  database ??= createDatabase(env.DATABASE_URL);
  return {
    env,
    database,
    repositories: createWebRepositories(database),
  } as const;
}
