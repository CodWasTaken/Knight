import { GuildMode, type SetupStep } from '@knight/contracts';
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const guilds = pgTable(
  'guilds',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    mode: text('mode').$type<GuildMode>().notNull().default(GuildMode.Observe),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('guilds_mode_check', sql`${table.mode} in ('OBSERVE', 'TEST', 'GUARDED')`)],
);

export const setupStates = pgTable('setup_states', {
  guildId: text('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  step: text('step').$type<SetupStep>().notNull().default('WELCOME'),
  completedSteps: jsonb('completed_steps').$type<SetupStep[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
