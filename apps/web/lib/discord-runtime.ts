import 'server-only';

import { createDiscordRestSetupAdapter } from '@knight/discord';
import type { DiscordActionPort } from '@knight/discord';
import { getWebRuntime, type WebRuntime } from './server-runtime';

export type WebDiscordAdapter = Pick<
  DiscordActionPort,
  'getGuildState' | 'setRolePermissions' | 'addRole' | 'removeRole'
>;

export function getWebDiscordAdapter(
  runtime: WebRuntime = getWebRuntime(),
): WebDiscordAdapter | null {
  const token = runtime.env.DISCORD_TOKEN;
  if (!token) return null;
  return createDiscordRestSetupAdapter(token);
}
