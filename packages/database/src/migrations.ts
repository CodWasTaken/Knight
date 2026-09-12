import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

export function resolveMigrationsFolder(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '../migrations');
}

const MIGRATIONS_FOLDER = resolveMigrationsFolder(import.meta.url);

export async function applyMigrations(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
