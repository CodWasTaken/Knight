import { pathToFileURL } from 'node:url';
import { parseEnv } from '@knight/config';
import { Events, type Client } from 'discord.js';
import { createDiscordClient } from './discord-client.js';
import { registerCommands } from './register-commands.js';

export async function startBot(
  envInput: Record<string, string | undefined> = process.env,
): Promise<Client> {
  const env = parseEnv(envInput);
  const client = createDiscordClient();
  const ready = new Promise<Client<true>>((resolve) => {
    client.once(Events.ClientReady, resolve);
  });

  try {
    await client.login(env.DISCORD_TOKEN);
    const readyClient = await ready;
    await registerCommands(readyClient);
    console.info(`Knight connected as ${readyClient.user.tag}.`);
    return readyClient;
  } catch (error) {
    client.destroy();
    throw error;
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void startBot().catch(() => {
    console.error('Knight failed to start. Check configuration and service health.');
    process.exitCode = 1;
  });
}
