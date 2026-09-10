import type { ActionId, ActionPolicies } from '@knight/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { guilds } from './guilds.js';

export const staffProfiles = pgTable(
  'staff_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    discordRoleId: text('discord_role_id').notNull(),
    rank: integer('rank').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    currentVersionId: uuid('current_version_id'),
    syncMode: text('sync_mode').notNull().default('MANAGED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('staff_profiles_guild_name_uq').on(table.guildId, table.name),
    index('staff_profiles_guild_role_idx').on(table.guildId, table.discordRoleId),
    check('staff_profiles_rank_check', sql`${table.rank} >= 0`),
  ],
);

export const staffProfileVersions = pgTable(
  'staff_profile_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => staffProfiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    profileName: text('profile_name').notNull(),
    discordRoleId: text('discord_role_id').notNull(),
    rank: integer('rank').notNull(),
    permissions: jsonb('permissions').$type<ActionId[]>().notNull().default([]),
    actionPolicies: jsonb('action_policies').$type<ActionPolicies>().notNull().default({}),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('staff_profile_versions_profile_version_uq').on(table.profileId, table.version),
    index('staff_profile_versions_guild_profile_idx').on(table.guildId, table.profileId),
    check('staff_profile_versions_version_check', sql`${table.version} > 0`),
    check('staff_profile_versions_rank_check', sql`${table.rank} >= 0`),
  ],
);

export const staffAssignments = pgTable(
  'staff_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => staffProfiles.id, { onDelete: 'restrict' }),
    active: boolean('active').notNull().default(true),
    syncStatus: text('sync_status').notNull().default('PENDING'),
    assignedBy: text('assigned_by').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('staff_assignments_active_user_uq')
      .on(table.guildId, table.userId)
      .where(sql`${table.active} = true`),
    index('staff_assignments_guild_profile_idx').on(table.guildId, table.profileId),
  ],
);

export const securityManagers = pgTable(
  'security_managers',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    grantedBy: text('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const staffOverrides = pgTable(
  'staff_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('staff_overrides_guild_user_idx').on(table.guildId, table.userId)],
);

export const temporaryAccess = pgTable(
  'temporary_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('temporary_access_guild_user_idx').on(table.guildId, table.userId)],
);
