import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { guilds } from './guilds.js';

export type FactoryResetJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export const guildFactoryResetJobs = pgTable(
  'guild_factory_reset_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull().references(() => guilds.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by').notNull(),
    status: text('status').$type<FactoryResetJobStatus>().notNull().default('PENDING'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('guild_factory_reset_jobs_status_created_idx').on(table.status, table.createdAt),
    index('guild_factory_reset_jobs_guild_created_idx').on(table.guildId, table.createdAt),
    uniqueIndex('guild_factory_reset_jobs_one_active_uq')
      .on(table.guildId)
      .where(sql`${table.status} in ('PENDING', 'RUNNING')`),
    check('guild_factory_reset_jobs_status_check', sql`${table.status} in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')`),
  ],
);
