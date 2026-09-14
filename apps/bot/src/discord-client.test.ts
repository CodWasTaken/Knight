import { GatewayIntentBits, Partials } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { discordClientOptions, gatewayIntentsForArchive, KNIGHT_GATEWAY_INTENTS } from './discord-client.js';

describe('Knight gateway intents', () => {
  it('uses only the core anti-nuke intents and excludes Message Content by default', () => {
    expect(KNIGHT_GATEWAY_INTENTS).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ]);
    expect(gatewayIntentsForArchive(false)).toEqual(KNIGHT_GATEWAY_INTENTS);
    expect(gatewayIntentsForArchive(false)).not.toContain(GatewayIntentBits.MessageContent);
  });

  it('configures Message partials for metadata-only uncached deletes', () => {
    expect(discordClientOptions(false).partials).toContain(Partials.Message);
  });

  it('adds Message Content only when selected-channel archival is explicitly enabled', () => {
    expect(gatewayIntentsForArchive(true)).toEqual([
      ...KNIGHT_GATEWAY_INTENTS,
      GatewayIntentBits.MessageContent,
    ]);
  });
});
