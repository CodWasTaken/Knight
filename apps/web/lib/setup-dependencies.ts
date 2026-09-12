import { GuardedMigrationService, SetupService } from '@knight/bot/setup';
import { SecurityRecorder } from '@knight/bot/security';
import type { DiscordActionPort } from '@knight/discord/port';
import type { WebRepositories } from './server-dependencies';

export type WebSetupServices = Readonly<{
  setup: SetupService;
  migrations: GuardedMigrationService;
}>;

export function createWebSetupServices(input: {
  repositories: WebRepositories;
  discord: Pick<DiscordActionPort, 'getGuildState' | 'setRolePermissions' | 'sendChannelMessage'>;
  createMigrationId: () => string;
}): WebSetupServices {
  const securityRecorder = new SecurityRecorder({
    ledger: input.repositories.securityLedger,
    discord: input.discord,
  });
  return {
    setup: new SetupService({
      guilds: input.repositories.guilds,
      managers: input.repositories.managers,
      staff: input.repositories.staff,
      securityLedger: input.repositories.securityLedger,
      security: input.repositories.security,
      discord: input.discord,
    }),
    migrations: new GuardedMigrationService({
      guilds: input.repositories.guilds,
      staff: input.repositories.staff,
      security: input.repositories.security,
      discord: input.discord,
      securityRecorder,
      createMigrationId: input.createMigrationId,
    }),
  };
}
