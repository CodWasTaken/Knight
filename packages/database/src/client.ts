export type Database = Readonly<{ state: 'NOT_IMPLEMENTED' }>;

export function createDatabase(_databaseUrl: string): Database {
  return { state: 'NOT_IMPLEMENTED' };
}

export async function closeDatabase(_database: Database): Promise<void> {
  return Promise.resolve();
}
