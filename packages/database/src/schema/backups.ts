import type {
  BackupJobStatus,
  BackupPolicyMode,
  RecoveryJobPhase,
  RecoveryJobStatus,
} from '@knight/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { guilds } from './guilds.js';

export const backupPolicies = pgTable(
  'backup_policies',
  {
    guildId: text('guild_id')
      .primaryKey()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<BackupPolicyMode>().notNull(),
    archiveChannelIds: jsonb('archive_channel_ids').$type<string[]>().notNull().default([]),
    maxMessagesPerChannel: integer('max_messages_per_channel').notNull().default(1000),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('backup_policies_mode_check', sql`${table.mode} in ('DISABLED', 'MANUAL', 'DAILY')`),
    check(
      'backup_policies_message_cap_check',
      sql`${table.maxMessagesPerChannel} between 1 and 10000`,
    ),
  ],
);

export const backups = pgTable(
  'backups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by').notNull(),
    status: text('status').$type<BackupJobStatus>().notNull().default('PENDING'),
    relativePath: text('relative_path'),
    sha256: text('sha256'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('backups_status_created_idx').on(table.status, table.createdAt),
    index('backups_guild_created_idx').on(table.guildId, table.createdAt),
    check(
      'backups_status_check',
      sql`${table.status} in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')`,
    ),
  ],
);

export const recoveryJobs = pgTable(
  'recovery_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    backupId: uuid('backup_id')
      .notNull()
      .references(() => backups.id, { onDelete: 'restrict' }),
    requestedBy: text('requested_by').notNull(),
    phase: text('phase').$type<RecoveryJobPhase>().notNull().default('PREVIEW'),
    status: text('status').$type<RecoveryJobStatus>().notNull().default('PENDING'),
    preview: jsonb('preview').$type<Record<string, unknown> | null>(),
    checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>().notNull().default({}),
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('recovery_jobs_status_created_idx').on(table.status, table.createdAt),
    index('recovery_jobs_guild_created_idx').on(table.guildId, table.createdAt),
    check('recovery_jobs_phase_check', sql`${table.phase} in ('PREVIEW', 'EXECUTION')`),
    check(
      'recovery_jobs_status_check',
      sql`${table.status} in ('PENDING', 'RUNNING', 'PREVIEW_READY', 'COMPLETED', 'FAILED')`,
    ),
  ],
);
