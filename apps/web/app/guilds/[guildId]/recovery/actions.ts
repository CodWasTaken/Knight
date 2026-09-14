'use server';

import { BACKUP_POLICY_MODES, type BackupPolicyMode } from '@knight/contracts';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { runWithActionFeedback } from '../../../../lib/action-feedback';

const POLICY_MODES = new Set<string>(BACKUP_POLICY_MODES);

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid backup policy submission.');
  }
  return value.trim();
}

function messageCap(formData: FormData): number {
  const raw = requiredString(formData, 'maxMessagesPerChannel');
  if (!/^\d+$/.test(raw)) throw new Error('Invalid backup message cap.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error('Invalid backup message cap.');
  }
  return value;
}
function archiveChannelIds(formData: FormData): string[] {
  const ids = formData
    .getAll('archiveChannelId')
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(ids)];
}

export async function requestRestorePreviewAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const guildId = requiredString(formData, 'guildId');
  const backupId = requiredString(formData, 'backupId');
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  await runWithActionFeedback(`/guilds/${guildId}/recovery`, [`/guilds/${guildId}/recovery`], async () => {

  const backup = await runtime.repositories.backups.getBackup(guildId, backupId);
  if (
    backup === null || backup.status !== 'COMPLETED' ||
    backup.relativePath === null || backup.sha256 === null
  ) {
    throw new Error('Restore preview requires a completed backup with integrity metadata.');
  }
  await runtime.repositories.backups.enqueueRestorePreview({
    guildId, backupId, requestedBy: session.user.id,
  });
  });
}

export async function confirmRestoreAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const guildId = requiredString(formData, 'guildId');
  const jobId = requiredString(formData, 'jobId');
  const runtime = getWebRuntime();
  const role = await requireGuildAccess(guildId, session, runtime.repositories);
  await runWithActionFeedback(`/guilds/${guildId}/recovery`, [`/guilds/${guildId}/recovery`], async () => {
  if (role !== 'OWNER') throw new Error('Recovery execution requires the Discord guild owner.');
  if (formData.get('confirmRestore') !== 'CONFIRM') {
    throw new Error('Recovery execution requires explicit confirmation.');
  }
  await runtime.repositories.backups.confirmRestore({
    guildId, jobId, confirmedBy: session.user.id,
  });
  });
}

export async function retryRestoreAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const guildId = requiredString(formData, 'guildId');
  const jobId = requiredString(formData, 'jobId');
  const runtime = getWebRuntime();
  const role = await requireGuildAccess(guildId, session, runtime.repositories);
  await runWithActionFeedback(`/guilds/${guildId}/recovery`, [`/guilds/${guildId}/recovery`], async () => {
  if (role !== 'OWNER') throw new Error('Recovery retry requires the Discord guild owner.');
  await runtime.repositories.backups.retryRestore({ guildId, jobId });
  });
}

export async function queueBackupNowAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const guildId = requiredString(formData, 'guildId');
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  await runWithActionFeedback(`/guilds/${guildId}/recovery`, [`/guilds/${guildId}/recovery`], async () => {
  await runtime.repositories.backups.enqueueBackup({
    guildId,
    requestedBy: session.user.id,
  });
  });
}

export async function saveBackupPolicyAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const guildId = requiredString(formData, 'guildId');
  const mode = requiredString(formData, 'mode');
  if (!POLICY_MODES.has(mode)) throw new Error('Invalid backup policy mode.');
  const maxMessagesPerChannel = messageCap(formData);
  const selectedChannelIds = archiveChannelIds(formData);

  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  await runWithActionFeedback(`/guilds/${guildId}/recovery`, [`/guilds/${guildId}/recovery`, `/guilds/${guildId}/setup`], async () => {

  if (selectedChannelIds.length > 0 && !runtime.env.ENABLE_MESSAGE_CONTENT_ARCHIVE) {
    throw new Error(
      'Selected-channel message archives require ENABLE_MESSAGE_CONTENT_ARCHIVE=true.',
    );
  }
  if (selectedChannelIds.length > 0) {
    const discord = getWebDiscordAdapter(runtime);
    if (discord === null) {
      throw new Error('Live Discord backup-channel validation requires DISCORD_TOKEN.');
    }
    const validChannelIds = new Set(
      (await discord.listTextChannels(guildId)).map((channel) => channel.channelId),
    );
    if (selectedChannelIds.some((channelId) => !validChannelIds.has(channelId))) {
      throw new Error('Selected backup archive channel is not a valid guild text channel.');
    }
  }

  await runtime.repositories.backups.savePolicy({
    guildId,
    mode: mode as BackupPolicyMode,
    archiveChannelIds: selectedChannelIds,
    maxMessagesPerChannel,
    updatedBy: session.user.id,
  });
  });
}
