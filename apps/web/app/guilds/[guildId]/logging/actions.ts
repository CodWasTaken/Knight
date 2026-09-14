'use server';

import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { requireEmergencyScopesAvailable } from '../../../../lib/emergency-state';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { runWithActionFeedback } from '../../../../lib/action-feedback';

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
  await runWithActionFeedback(`/guilds/${guildId}/logging`, [
    `/guilds/${guildId}/logging`, `/guilds/${guildId}/setup`, `/guilds/${guildId}`, `/guilds/${guildId}/logs`,
  ], async () => {
  await requireEmergencyScopesAvailable(runtime.repositories.security, guildId, [
    'SECURITY_CONFIG',
  ]);
  const securityChannelId = optionalChannel(formData, 'securityChannelId');
  const moderationChannelId = optionalChannel(formData, 'moderationChannelId');
  const messageChannelId = optionalChannel(formData, 'messageChannelId');
  const voiceChannelId = optionalChannel(formData, 'voiceChannelId');
  const storeDeletedMessageContent = formData.get('storeDeletedMessageContent') === 'yes';
  const destinations = [securityChannelId, moderationChannelId, messageChannelId, voiceChannelId];
  if (destinations.some((channelId) => channelId !== null)) {
    const discord = getWebDiscordAdapter(runtime);
    if (discord === null) {
      throw new Error(
        'Live Discord logging operations are unavailable because DISCORD_TOKEN is not configured for the web service.',
      );
    }

    const channels = await discord.listTextChannels(guildId);
    const channelIds = new Set(channels.map((channel) => channel.channelId));
    for (const channelId of destinations) {
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
    messageChannelId,
    voiceChannelId,
    storeDeletedMessageContent,
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
      metadata: {
        securityChannelId, moderationChannelId, messageChannelId, voiceChannelId,
        storeDeletedMessageContent,
      },
    });
  } catch {
    // Settings are already durable; do not pretend they rolled back if recording fails.
  }
  });
}
