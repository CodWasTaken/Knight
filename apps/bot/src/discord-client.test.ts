import { GatewayIntentBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { KNIGHT_GATEWAY_INTENTS } from './discord-client.js';

describe('Knight gateway intents', () => {
  it('uses only the core anti-nuke intents and excludes Message Content', () => {
    expect(KNIGHT_GATEWAY_INTENTS).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
    ]);
    expect(KNIGHT_GATEWAY_INTENTS).not.toContain(GatewayIntentBits.MessageContent);
  });
});
