export type GuildAccessRole = 'OWNER' | 'SECURITY_MANAGER';

export type KnightSession = Readonly<{
  user?: Readonly<{ id?: string | null }> | null;
}> | null;

export interface GuildAuthorizationDependencies {
  guilds: {
    get(guildId: string): Promise<{ ownerId: string } | null>;
  };
  managers: {
    isSecurityManager(guildId: string, userId: string): Promise<boolean>;
  };
}

export class GuildAuthorizationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GuildAuthorizationError';
  }
}

export async function requireGuildAccess(
  guildId: string,
  session: KnightSession,
  dependencies?: GuildAuthorizationDependencies,
): Promise<GuildAccessRole> {
  const userId = session?.user?.id;
  if (!userId) {
    throw new GuildAuthorizationError('UNAUTHENTICATED', 'Discord sign-in is required.');
  }

  const resolvedDependencies =
    dependencies ?? (await import('./server-runtime')).getWebRuntime().repositories;
  const guild = await resolvedDependencies.guilds.get(guildId);
  if (guild === null) {
    throw new GuildAuthorizationError(
      'GUILD_NOT_CONFIGURED',
      'Knight is not configured for this guild.',
    );
  }
  if (guild.ownerId === userId) return 'OWNER';

  if (await resolvedDependencies.managers.isSecurityManager(guildId, userId)) {
    return 'SECURITY_MANAGER';
  }

  throw new GuildAuthorizationError(
    'GUILD_ACCESS_DENIED',
    'This Discord account is not authorized to manage this guild in Knight.',
  );
}
