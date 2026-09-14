import type { ActionId, PolicyDecision } from '@knight/contracts';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { guilds } from './guilds.js';
import { staffProfileVersions } from './staff.js';

export const guardedCategories = pgTable(
  'guarded_categories',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    migrationId: uuid('migration_id'),
    snapshotRequired: boolean('snapshot_required').notNull().default(false),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.category] })],
);

export const rolePermissionSnapshots = pgTable(
  'role_permission_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    migrationId: uuid('migration_id').notNull(),
    roleId: text('role_id').notNull(),
    permissions: text('permissions').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('role_permission_snapshots_guild_migration_idx').on(table.guildId, table.migrationId),
  ],
);

export const policyDecisions = pgTable(
  'policy_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').notNull(),
    action: text('action').$type<ActionId>().notNull(),
    targetId: text('target_id'),
    decision: text('decision').$type<PolicyDecision>().notNull(),
    code: text('code').notNull(),
    profileVersionId: uuid('profile_version_id').references(() => staffProfileVersions.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('policy_decisions_guild_created_idx').on(table.guildId, table.createdAt),
    index('policy_decisions_actor_action_idx').on(table.guildId, table.actorUserId, table.action),
  ],
);
