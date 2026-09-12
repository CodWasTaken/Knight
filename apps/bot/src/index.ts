import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseEnv } from '@knight/config';
import {
  closeDatabase,
  createDatabase,
  GuildRepository,
  PolicyDecisionRepository,
  SecurityLedgerRepository,
  SecurityRepository,
  SecurityManagerRepository,
  StaffRepository,
  WarningRepository,
} from '@knight/database';
import { DiscordJsAdapter, type DiscordActionPort } from '@knight/discord';
import { closeRedis, createRedis, ExecutionCorrelationStore, RateLimitStore } from '@knight/redis';
import { authorizeGuardedAction } from '@knight/security';
import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import { routeInteraction, type CommandRouterDependencies } from './commands/router.js';
import { createDiscordClient } from './discord-client.js';
import { registerCommands } from './register-commands.js';
import { FirewallService } from './security/firewall-service.js';
import { EmergencyService } from './security/emergency-service.js';
import { installNativeListeners } from './security/install-native-listeners.js';
import { NativeEventService } from './security/native-event-service.js';
import { SecurityManagerService } from './security/security-manager-service.js';
import { SecurityRecorder } from './security/security-recorder.js';
import { GuardedMigrationService } from './setup/guarded-migration-service.js';
import { SetupService } from './setup/setup-service.js';
import { RoleSyncService } from './staff/role-sync-service.js';
export async function syncConnectedGuildOwners(
  client: Client<true>,
  guilds: Pick<GuildRepository, 'createOrUpdateOwner'>,
): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    await guilds.createOrUpdateOwner(guild.id, guild.ownerId);
  }
}

export function installGuildOwnerSync(
  client: Pick<Client, 'on'>,
  guilds: Pick<GuildRepository, 'createOrUpdateOwner'>,
): void {
  client.on(Events.GuildCreate, (guild) => {
    void guilds.createOrUpdateOwner(guild.id, guild.ownerId).catch(() => {
      console.error('Knight could not persist a newly connected guild.');
    });
  });
}

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

export function createCommandRouterDependencies(input: {
  database: ReturnType<typeof createDatabase>;
  redis: ReturnType<typeof createRedis>;
  discord: DiscordActionPort;
  appUrl: string;
  createCorrelationId: () => string;
}): CommandRouterDependencies {
  const guilds = new GuildRepository(input.database);
  const staffProfiles = new StaffRepository(input.database);
  const managers = new SecurityManagerRepository(input.database);
  const warnings = new WarningRepository(input.database);
  const securityLedger = new SecurityLedgerRepository(input.database);
  const security = new SecurityRepository(input.database);
  const securityRecorder = new SecurityRecorder({ ledger: securityLedger, discord: input.discord });
  const moderation = {
    authorize: authorizeGuardedAction,
    staffProfiles,
    security,
    rateLimits: new RateLimitStore(input.redis),
    decisions: new PolicyDecisionRepository(input.database),
    securityRecorder,
    correlations: new ExecutionCorrelationStore(input.redis),
    discord: input.discord,
    createCorrelationId: input.createCorrelationId,
  };

  return {
    now: Date.now,
    roleSync: new RoleSyncService({
      guilds,
      managers,
      staff: staffProfiles,
      discord: input.discord,
      securityRecorder,
    }),
    securityManagers: new SecurityManagerService({ guilds, managers, securityRecorder }),
    emergency: new EmergencyService({
      guilds,
      managers,
      security,
      securityRecorder,
      now: () => new Date(),
    }),
    doctor: {
      checkDatabase: async () => {
        await input.database.pool.query('select 1');
      },
      checkMigrations: async () => {
        await input.database.pool.query('select 1 from drizzle.__drizzle_migrations limit 1');
      },
      checkRedis: async () => {
        await input.redis.ping();
      },
      guilds,
      staff: staffProfiles,
      discord: input.discord,
      appUrl: input.appUrl,
    },
    setup: {
      setup: new SetupService({
        guilds,
        managers,
        staff: staffProfiles,
        securityLedger,
        security,
        discord: input.discord,
      }),
      migrations: new GuardedMigrationService({
        guilds,
        staff: staffProfiles,
        discord: input.discord,
        securityRecorder,
        createMigrationId: input.createCorrelationId,
      }),
    },
    memberBan: moderation,
    memberWarn: { ...moderation, warnings },
    memberWarnings: { staffProfiles, security, discord: input.discord, warnings },
    memberTimeout: moderation,
    memberKick: moderation,
    memberUnban: moderation,
    messagePurge: moderation,
  };
}

export async function startBot(
  envInput: Record<string, string | undefined> = process.env,
): Promise<Client> {
  const env = parseEnv(envInput);
  const client = createDiscordClient();
  const database = createDatabase(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const discord = new DiscordJsAdapter(client);
  const guildRepository = new GuildRepository(database);
  installGuildOwnerSync(client, guildRepository);
  const nativeSecurity = new SecurityRepository(database);
  const nativeRecorder = new SecurityRecorder({
    ledger: new SecurityLedgerRepository(database),
    discord,
  });
  installNativeListeners(
    client,
    new NativeEventService({
      security: nativeSecurity,
      correlations: new ExecutionCorrelationStore(redis),
      recorder: nativeRecorder,
      firewall: new FirewallService({
        security: nativeSecurity,
        discord,
        recorder: nativeRecorder,
        now: () => new Date(),
      }),
    }),
  );
  const dependencies = createCommandRouterDependencies({
    database,
    redis,
    discord,
    appUrl: env.APP_URL,
    createCorrelationId: randomUUID,
  });

  installCommandRouter(client, dependencies);
  const ready = new Promise<Client<true>>((resolve) => {
    client.once(Events.ClientReady, resolve);
  });
  try {
    await client.login(env.DISCORD_TOKEN);
    const readyClient = await ready;
    await syncConnectedGuildOwners(readyClient, guildRepository);
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
