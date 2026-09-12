import { Client, GatewayIntentBits } from 'discord.js';

export const KNIGHT_GATEWAY_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildWebhooks,
] as const;

export function gatewayIntentsForArchive(enableMessageArchive: boolean): readonly GatewayIntentBits[] {
  return enableMessageArchive
    ? [...KNIGHT_GATEWAY_INTENTS, GatewayIntentBits.MessageContent]
    : KNIGHT_GATEWAY_INTENTS;
}

export function createDiscordClient(enableMessageArchive = false): Client {
  return new Client({ intents: gatewayIntentsForArchive(enableMessageArchive) });
}
