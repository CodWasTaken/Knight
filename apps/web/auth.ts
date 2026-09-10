import NextAuth, { type NextAuthResult } from 'next-auth';
import { configureAuthEnvironment, createAuthConfig } from './lib/auth-config';
import { getWebRuntime } from './lib/server-runtime';

const nextAuth: NextAuthResult = NextAuth(() => {
  const { database, env } = getWebRuntime();
  configureAuthEnvironment(env);
  return createAuthConfig(database, env);
});

export const handlers: NextAuthResult['handlers'] = nextAuth.handlers;
export const auth: NextAuthResult['auth'] = nextAuth.auth;
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn;
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut;
