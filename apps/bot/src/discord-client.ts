import { Client, GatewayIntentBits } from 'discord.js';

export const KNIGHT_GATEWAY_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
] as const;

export function createDiscordClient(): Client {
  return new Client({ intents: KNIGHT_GATEWAY_INTENTS });
}
