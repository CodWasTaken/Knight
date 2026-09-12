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
  | 'getMemberState'
>;

export type WebDiscordAdapterWithProtection = WebDiscordAdapter &
  Readonly<{
    getGuildChannelState(
      guildId: string,
      channelId: string,
    ): Promise<{ channelId: string; name: string } | null>;
  }>;

export function getWebDiscordAdapter(
  runtime: WebRuntime = getWebRuntime(),
): WebDiscordAdapterWithProtection | null {
  const token = runtime.env.DISCORD_TOKEN;
  if (!token) return null;
  return createDiscordRestSetupAdapter(token);
}
