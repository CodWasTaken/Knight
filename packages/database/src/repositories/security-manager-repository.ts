import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { securityManagers } from '../schema/index.js';

export class SecurityManagerRepository {
  public constructor(private readonly database: Database) {}

  public async grant(input: { guildId: string; userId: string; grantedBy: string }): Promise<void> {
    await this.database.db
      .insert(securityManagers)
      .values(input)
      .onConflictDoUpdate({
        target: [securityManagers.guildId, securityManagers.userId],
        set: { grantedBy: input.grantedBy, grantedAt: new Date() },
      });
  }

  public async revoke(guildId: string, userId: string): Promise<void> {
    await this.database.db
      .delete(securityManagers)
      .where(and(eq(securityManagers.guildId, guildId), eq(securityManagers.userId, userId)));
  }

  public async isSecurityManager(guildId: string, userId: string): Promise<boolean> {
    const [manager] = await this.database.db
      .select({ userId: securityManagers.userId })
      .from(securityManagers)
      .where(and(eq(securityManagers.guildId, guildId), eq(securityManagers.userId, userId)))
      .limit(1);

    return manager !== undefined;
  }
}
