import 'server-only';

import { randomUUID } from 'node:crypto';
import { getWebDiscordAdapter } from './discord-runtime';
import { createWebSetupServices, type WebSetupServices } from './setup-dependencies';
import { getWebRuntime, type WebRuntime } from './server-runtime';

export function getWebSetupServices(
  runtime: WebRuntime = getWebRuntime(),
): WebSetupServices | null {
  const discord = getWebDiscordAdapter(runtime);
  if (discord === null) return null;

  return createWebSetupServices({
    repositories: runtime.repositories,
    discord,
    createMigrationId: randomUUID,
  });
}
