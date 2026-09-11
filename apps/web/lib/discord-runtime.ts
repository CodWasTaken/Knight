import 'server-only';

import type { DiscordActionPort } from '@knight/discord/port';
import { createDiscordRestSetupAdapter } from '@knight/discord/rest-setup-adapter';
import { getWebRuntime, type WebRuntime } from './server-runtime';

export type WebDiscordAdapter = Pick<
  DiscordActionPort,
  | 'getGuildState'
  | 'setRolePermissions'
  | 'addRole'
  | 'removeRole'
  | 'listTextChannels'
  | 'canSendToChannel'
  | 'sendChannelMessage'
>;

export function getWebDiscordAdapter(
  runtime: WebRuntime = getWebRuntime(),
): WebDiscordAdapter | null {
  const token = runtime.env.DISCORD_TOKEN;
  if (!token) return null;
  return createDiscordRestSetupAdapter(token);
}
