import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { guilds } from './guilds.js';

export const guildLoggingSettings = pgTable('guild_logging_settings', {
  guildId: text('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  securityChannelId: text('security_channel_id'),
  moderationChannelId: text('moderation_channel_id'),
  messageChannelId: text('message_channel_id'),
  voiceChannelId: text('voice_channel_id'),
  storeDeletedMessageContent: boolean('store_deleted_message_content').notNull().default(false),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const securityLedger = pgTable(
  'security_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    severity: text('severity').notNull(),
    source: text('source').notNull(),
    action: text('action').notNull(),
    actorUserId: text('actor_user_id'),
    targetId: text('target_id'),
    decisionId: text('decision_id'),
    incidentId: text('incident_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    previousHash: text('previous_hash'),
    entryHash: text('entry_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('security_ledger_guild_created_idx').on(table.guildId, table.createdAt, table.id),
    index('security_ledger_guild_action_idx').on(table.guildId, table.action),
    check(
      'security_ledger_severity_check',
      sql`${table.severity} in ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')`,
    ),
  ],
);
