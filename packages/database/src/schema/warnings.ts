import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { guilds } from './guilds.js';
import { staffProfileVersions } from './staff.js';

export const memberWarnings = pgTable(
  'member_warnings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    targetUserId: text('target_user_id').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    reason: text('reason').notNull(),
    actorProfileVersionId: uuid('actor_profile_version_id').references(
      () => staffProfileVersions.id,
      {
        onDelete: 'set null',
      },
    ),
    dmDeliveryStatus: text('dm_delivery_status').notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('member_warnings_guild_target_created_idx').on(
      table.guildId,
      table.targetUserId,
      table.createdAt,
    ),
  ],
);
