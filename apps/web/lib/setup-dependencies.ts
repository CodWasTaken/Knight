import { GuardedMigrationService, SetupService } from '@knight/bot/setup';
import type { DiscordActionPort } from '@knight/discord';
import type { WebRepositories } from './server-dependencies';

export type WebSetupServices = Readonly<{
  setup: SetupService;
  migrations: GuardedMigrationService;
}>;

export function createWebSetupServices(input: {
  repositories: WebRepositories;
  discord: Pick<DiscordActionPort, 'getGuildState' | 'setRolePermissions'>;
  createMigrationId: () => string;
}): WebSetupServices {
  return {
    setup: new SetupService({
      guilds: input.repositories.guilds,
      managers: input.repositories.managers,
      staff: input.repositories.staff,
      discord: input.discord,
    }),
    migrations: new GuardedMigrationService({
      guilds: input.repositories.guilds,
      staff: input.repositories.staff,
      discord: input.discord,
      createMigrationId: input.createMigrationId,
    }),
  };
}
