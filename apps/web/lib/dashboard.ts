import type {
  AccessibleGuildRecord,
  GuildRepository,
} from '@knight/database/repositories/guild-repository';
import { GuildAuthorizationError, type KnightSession } from './authorization';

export type DashboardDependencies = Readonly<{
  guilds: Pick<GuildRepository, 'listAccessibleToUser'>;
}>;

export async function loadDashboardGuilds(
  session: KnightSession,
  dependencies: DashboardDependencies,
): Promise<AccessibleGuildRecord[]> {
  const userId = session?.user?.id;
  if (!userId) {
    throw new GuildAuthorizationError('UNAUTHENTICATED', 'Discord sign-in is required.');
  }
  return dependencies.guilds.listAccessibleToUser(userId);
}
