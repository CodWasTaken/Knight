import type { ProtectionLevel } from '@knight/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { guilds } from './guilds.js';

export const securityIncidents = pgTable(
  'security_incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    actorKey: text('actor_key').notNull(),
    severity: text('severity').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    summary: text('summary').notNull(),
    eventCount: integer('event_count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('security_incidents_guild_actor_idx').on(table.guildId, table.actorKey, table.lastSeenAt),
    check(
      'security_incidents_status_check',
      sql`${table.status} in ('ACTIVE', 'CONTAINED', 'RESOLVED')`,
    ),
    check('security_incidents_event_count_check', sql`${table.eventCount} > 0`),
  ],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    action: text('action').notNull(),
    actorUserId: text('actor_user_id'),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    auditLogId: text('audit_log_id'),
    executionId: text('execution_id'),
    incidentId: uuid('incident_id').references(() => securityIncidents.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('security_events_guild_occurred_idx').on(table.guildId, table.occurredAt),
    index('security_events_incident_idx').on(table.incidentId),
  ],
);

export const protectedResources = pgTable(
  'protected_resources',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    level: text('level').$type<ProtectionLevel>().notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.resourceType, table.resourceId] }),
    check(
      'protected_resources_type_check',
      sql`${table.resourceType} in ('USER', 'ROLE', 'CHANNEL')`,
    ),
    check(
      'protected_resources_level_check',
      sql`${table.level} in ('IMPORTANT', 'CRITICAL', 'IMMUTABLE')`,
    ),
  ],
);

export const guildFirewallSettings = pgTable(
  'guild_firewall_settings',
  {
    guildId: text('guild_id')
      .primaryKey()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    botMode: text('bot_mode').notNull().default('OBSERVE'),
    webhookMode: text('webhook_mode').notNull().default('OBSERVE'),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'guild_firewall_bot_mode_check',
      sql`${table.botMode} in ('OBSERVE', 'ALERT', 'ENFORCE')`,
    ),
    check(
      'guild_firewall_webhook_mode_check',
      sql`${table.webhookMode} in ('OBSERVE', 'ALERT', 'ENFORCE')`,
    ),
  ],
);

export const knownBots = pgTable(
  'known_bots',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    botUserId: text('bot_user_id').notNull(),
    trustState: text('trust_state').notNull().default('UNKNOWN'),
    invitedByUserId: text('invited_by_user_id'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.botUserId] }),
    check(
      'known_bots_trust_check',
      sql`${table.trustState} in ('TRUSTED', 'APPROVED', 'UNKNOWN', 'BLOCKED')`,
    ),
  ],
);

export const knownWebhooks = pgTable(
  'known_webhooks',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    webhookId: text('webhook_id').notNull(),
    channelId: text('channel_id').notNull(),
    trustState: text('trust_state').notNull().default('UNKNOWN'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.webhookId] }),
    check(
      'known_webhooks_trust_check',
      sql`${table.trustState} in ('TRUSTED', 'APPROVED', 'UNKNOWN', 'BLOCKED')`,
    ),
  ],
);
