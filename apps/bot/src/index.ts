import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseEnv } from '@knight/config';
import {
  closeDatabase,
  createDatabase,
  PolicyDecisionRepository,
  StaffRepository,
} from '@knight/database';
import { DiscordJsAdapter } from '@knight/discord';
import { closeRedis, createRedis, ExecutionCorrelationStore, RateLimitStore } from '@knight/redis';
import { authorizeGuardedAction } from '@knight/security';
import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import { routeInteraction, type CommandRouterDependencies } from './commands/router.js';
import { createDiscordClient } from './discord-client.js';
import { registerCommands } from './register-commands.js';
async function replyWithSafeCommandError(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;
  const payload = {
    content: 'Knight could not complete that command safely. No destructive action was performed.',
    flags: MessageFlags.Ephemeral,
  } as const;

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    // The interaction may already be expired; there is nothing safe left to send.
  }
}

function installCommandRouter(client: Client, dependencies: CommandRouterDependencies): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction, dependencies).catch(async () => {
      console.error('Knight command failed safely.');
      await replyWithSafeCommandError(interaction);
    });
  });
}
export async function startBot(
  envInput: Record<string, string | undefined> = process.env,
): Promise<Client> {
  const env = parseEnv(envInput);
  const client = createDiscordClient();
  const database = createDatabase(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const discord = new DiscordJsAdapter(client);
  const dependencies: CommandRouterDependencies = {
    now: Date.now,
    memberBan: {
      authorize: authorizeGuardedAction,
      staffProfiles: new StaffRepository(database),
      rateLimits: new RateLimitStore(redis),
      decisions: new PolicyDecisionRepository(database),
      correlations: new ExecutionCorrelationStore(redis),
      discord,
      createCorrelationId: randomUUID,
    },
  };

  installCommandRouter(client, dependencies);
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
    await Promise.allSettled([closeRedis(redis), closeDatabase(database)]);
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
