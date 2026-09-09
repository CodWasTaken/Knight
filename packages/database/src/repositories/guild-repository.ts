import type { Database } from '../client.js';

export class GuildRepository {
  public constructor(private readonly database: Database) {
    void this.database;
  }

  public async createOrUpdateOwner(_guildId: string, _ownerId: string): Promise<void> {
    throw new Error('GuildRepository not implemented');
  }
}
