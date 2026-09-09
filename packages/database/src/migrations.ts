import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function applyMigrations(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
