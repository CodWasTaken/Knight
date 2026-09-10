import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { WebEnv } from '@knight/config';
import type { Database } from '@knight/database/client';
import { accounts, sessions, users, verificationTokens } from '@knight/database/schema/auth';
import type { NextAuthConfig } from 'next-auth';
import Discord from 'next-auth/providers/discord';

export type WebAuthEnv = Pick<
  WebEnv,
  'DISCORD_CLIENT_ID' | 'DISCORD_CLIENT_SECRET' | 'AUTH_SECRET'
>;

export function configureAuthEnvironment(
  env: Pick<WebEnv, 'APP_URL'>,
  target: Record<string, string | undefined> = process.env,
): void {
  target.AUTH_URL = env.APP_URL;
}

export function createAuthConfig(database: Database, env: WebAuthEnv): NextAuthConfig {
  return {
    adapter: DrizzleAdapter(database.db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: 'database' },
    secret: env.AUTH_SECRET,
    providers: [
      Discord({
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        authorization: { params: { scope: 'identify guilds' } },
      }),
    ],
    callbacks: {
      async session({ session, user }) {
        const result = await database.pool.query<{ provider_account_id: string }>(
          'SELECT provider_account_id FROM accounts WHERE user_id = $1 AND provider = $2 LIMIT 1',
          [user.id, 'discord'],
        );
        const discordUserId = result.rows[0]?.provider_account_id;
        if (!discordUserId) {
          throw new Error('Authenticated user is missing a linked Discord account.');
        }

        return {
          ...session,
          user: {
            ...session.user,
            id: discordUserId,
          },
        };
      },
    },
  };
}
