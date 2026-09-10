'use server';

import type { ActionId } from '@knight/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { getWebRuntime, type WebRuntime } from '../../../../lib/server-runtime';
import {
  createStaffProfileFromDashboard,
  updateStaffProfileFromDashboard,
  updateStaffProfilePolicy,
} from '../../../../lib/staff-profile-service';

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid Staff Profile form submission.');
  }
  return value;
}

function parseBanWindows(formData: FormData) {
  return [0, 1, 2].flatMap((index) => {
    const max = formData.get(`banMax${index}`);
    const windowMs = formData.get(`banWindowMs${index}`);
    if (max === '' && windowMs === '') return [];
    return [{ max: Number(max), windowMs: Number(windowMs) }];
  });
}

async function authorizedStaffRuntime(formData: FormData): Promise<{
  guildId: string;
  actorUserId: string;
  runtime: WebRuntime;
}> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const guildId = requiredString(formData, 'guildId');
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  return { guildId, actorUserId: session.user.id, runtime };
}

function dashboardDependencies(runtime: WebRuntime) {
  const discord = getWebDiscordAdapter(runtime);
  if (discord === null) {
    throw new Error(
      'Live Discord Staff Profile operations are unavailable because DISCORD_TOKEN is not configured for the web service.',
    );
  }
  return { ...runtime.repositories, discord };
}

function revalidateStaff(guildId: string, profileId?: string): void {
  revalidatePath(`/guilds/${guildId}/staff`);
  if (profileId !== undefined) revalidatePath(`/guilds/${guildId}/staff/${profileId}`);
}

export async function createStaffProfileAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, runtime } = await authorizedStaffRuntime(formData);
  await createStaffProfileFromDashboard(
    {
      guildId,
      name: requiredString(formData, 'name'),
      discordRoleId: requiredString(formData, 'discordRoleId'),
      rank: Number(requiredString(formData, 'rank')),
    },
    { userId: actorUserId },
    dashboardDependencies(runtime),
  );
  revalidateStaff(guildId);
}

export async function updateStaffProfileMetadataAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, runtime } = await authorizedStaffRuntime(formData);
  const profileId = requiredString(formData, 'profileId');
  await updateStaffProfileFromDashboard(
    {
      guildId,
      profileId,
      name: requiredString(formData, 'name'),
      discordRoleId: requiredString(formData, 'discordRoleId'),
      rank: Number(requiredString(formData, 'rank')),
    },
    { userId: actorUserId },
    dashboardDependencies(runtime),
  );
  revalidateStaff(guildId, profileId);
}

export async function updateStaffProfilePolicyAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, runtime } = await authorizedStaffRuntime(formData);
  const profileId = requiredString(formData, 'profileId');

  const current = await runtime.repositories.staff.getCurrentProfileVersion(guildId, profileId);
  if (current === null) {
    throw new Error('Staff Profile not found.');
  }

  const permissions: ActionId[] = current.permissions.filter((action) => action !== 'member.ban');
  if (formData.get('memberBan') === 'on') permissions.push('member.ban');

  await updateStaffProfilePolicy(
    {
      guildId,
      profileId,
      permissions,
      banWindows: parseBanWindows(formData),
    },
    { userId: actorUserId },
    runtime.repositories,
  );

  revalidateStaff(guildId, profileId);
}
