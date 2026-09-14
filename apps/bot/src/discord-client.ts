import { Client, GatewayIntentBits, Partials, type ClientOptions } from 'discord.js';

export const KNIGHT_GATEWAY_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
] as const;

export function gatewayIntentsForArchive(enableMessageArchive: boolean): readonly GatewayIntentBits[] {
  return enableMessageArchive
    ? [...KNIGHT_GATEWAY_INTENTS, GatewayIntentBits.MessageContent]
    : KNIGHT_GATEWAY_INTENTS;
}

export function createDiscordClient(enableMessageArchive = false): Client {
  return new Client(discordClientOptions(enableMessageArchive));
}

export function discordClientOptions(enableMessageArchive: boolean): ClientOptions {
  return {
    intents: gatewayIntentsForArchive(enableMessageArchive),
    partials: [Partials.Message],
  };
}
