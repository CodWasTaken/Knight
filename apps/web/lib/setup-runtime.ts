import 'server-only';

import { randomUUID } from 'node:crypto';
import { createDiscordRestSetupAdapter } from '@knight/discord';
import { createWebSetupServices, type WebSetupServices } from './setup-dependencies';
import { getWebRuntime, type WebRuntime } from './server-runtime';

export function getWebSetupServices(
  runtime: WebRuntime = getWebRuntime(),
): WebSetupServices | null {
  const token = runtime.env.DISCORD_TOKEN;
  if (!token) return null;

  return createWebSetupServices({
    repositories: runtime.repositories,
    discord: createDiscordRestSetupAdapter(token),
    createMigrationId: randomUUID,
  });
}
