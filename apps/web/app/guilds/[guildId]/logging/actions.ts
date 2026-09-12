'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { requireEmergencyScopesAvailable } from '../../../../lib/emergency-state';
import { getWebRuntime } from '../../../../lib/server-runtime';

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid logging settings submission.');
  }
  return value.trim();
}

function optionalChannel(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.trim();
}

export async function saveLoggingSettingsAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const guildId = requiredString(formData, 'guildId');
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  await requireEmergencyScopesAvailable(runtime.repositories.security, guildId, [
    'SECURITY_CONFIG',
  ]);
  const securityChannelId = optionalChannel(formData, 'securityChannelId');
  const moderationChannelId = optionalChannel(formData, 'moderationChannelId');
  if (securityChannelId !== null || moderationChannelId !== null) {
    const discord = getWebDiscordAdapter(runtime);
    if (discord === null) {
      throw new Error(
        'Live Discord logging operations are unavailable because DISCORD_TOKEN is not configured for the web service.',
      );
    }

    const channels = await discord.listTextChannels(guildId);
    const channelIds = new Set(channels.map((channel) => channel.channelId));
    for (const channelId of [securityChannelId, moderationChannelId]) {
      if (channelId === null) continue;
      if (!channelIds.has(channelId)) {
        throw new Error('Selected logging destination is not a valid guild text channel.');
      }
      if (!(await discord.canSendToChannel(guildId, channelId))) {
        throw new Error('Knight cannot send messages to the selected logging channel.');
      }
    }
  }

  await runtime.repositories.securityLedger.saveLoggingSettings({
    guildId,
    securityChannelId,
    moderationChannelId,
    updatedBy: session.user.id,
  });
  try {
    await runtime.repositories.securityLedger.append({
      guildId,
      severity: 'LOW',
      source: 'CONFIG',
      action: 'logging.settings.update',
      actorUserId: session.user.id,
      targetId: guildId,
      decisionId: null,
      incidentId: null,
      metadata: { securityChannelId, moderationChannelId },
    });
  } catch {
    // Settings are already durable; do not pretend they rolled back if recording fails.
  }
  revalidatePath(`/guilds/${guildId}/logging`);
  revalidatePath(`/guilds/${guildId}/setup`);
}
