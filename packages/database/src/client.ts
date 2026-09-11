import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export type Database = Readonly<{
  pool: Pool;
  db: NodePgDatabase<typeof schema>;
}>;

export function createDatabase(databaseUrl: string): Database {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
  });

  return {
    pool,
    db: drizzle(pool, { schema }),
  };
}

export async function closeDatabase(database: Database): Promise<void> {
  await database.pool.end();
}
