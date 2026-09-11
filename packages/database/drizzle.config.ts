import { defineConfig } from 'drizzle-kit';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://knight:knight@localhost:5432/knight_test';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
