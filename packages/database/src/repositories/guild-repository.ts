import type { GuildMode } from '@knight/contracts';
import { and, asc, eq, or } from 'drizzle-orm';
import type { Database } from '../client.js';
import { guilds, securityManagers, setupStates } from '../schema/index.js';

export type GuildRecord = typeof guilds.$inferSelect;
export type SetupStateRecord = typeof setupStates.$inferSelect;

export type AccessibleGuildRecord = Readonly<{
  id: string;
  ownerId: string;
  mode: GuildMode;
  setupStep: SetupStateRecord['step'];
  completedSetupSteps: SetupStateRecord['completedSteps'];
}>;

export class GuildRepository {
  public constructor(private readonly database: Database) {}

  public async get(guildId: string): Promise<GuildRecord | null> {
    const [guild] = await this.database.db
      .select()
      .from(guilds)
      .where(eq(guilds.id, guildId))
      .limit(1);
    return guild ?? null;
  }

  public async listAccessibleToUser(userId: string): Promise<AccessibleGuildRecord[]> {
    return this.database.db
      .select({
        id: guilds.id,
        ownerId: guilds.ownerId,
        mode: guilds.mode,
        setupStep: setupStates.step,
        completedSetupSteps: setupStates.completedSteps,
      })
      .from(guilds)
      .innerJoin(setupStates, eq(setupStates.guildId, guilds.id))
      .leftJoin(
        securityManagers,
        and(eq(securityManagers.guildId, guilds.id), eq(securityManagers.userId, userId)),
      )
      .where(or(eq(guilds.ownerId, userId), eq(securityManagers.userId, userId)))
      .orderBy(asc(guilds.id));
  }

  public async createOrUpdateOwner(guildId: string, ownerId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx
        .insert(guilds)
        .values({ id: guildId, ownerId })
        .onConflictDoUpdate({
          target: guilds.id,
          set: { ownerId, updatedAt: new Date() },
        });
      await tx.insert(setupStates).values({ guildId }).onConflictDoNothing();
    });
  }

  public async setMode(guildId: string, mode: GuildMode): Promise<void> {
    await this.database.db
      .update(guilds)
      .set({ mode, updatedAt: new Date() })
      .where(eq(guilds.id, guildId));
  }

  public async getSetupState(guildId: string): Promise<SetupStateRecord | null> {
    const [state] = await this.database.db
      .select()
      .from(setupStates)
      .where(eq(setupStates.guildId, guildId))
      .limit(1);
    return state ?? null;
  }
}
