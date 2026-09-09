import type { Database } from '@knight/database/client';
import { GuildRepository } from '@knight/database/repositories/guild-repository';
import { SecurityManagerRepository } from '@knight/database/repositories/security-manager-repository';

export type WebRepositories = Readonly<{
  guilds: GuildRepository;
  managers: SecurityManagerRepository;
}>;

export function createWebRepositories(database: Database): WebRepositories {
  return {
    guilds: new GuildRepository(database),
    managers: new SecurityManagerRepository(database),
  } as const;
}
