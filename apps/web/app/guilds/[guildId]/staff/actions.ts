'use server';

import type { ActionId } from '@knight/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { updateStaffProfilePolicy } from '../../../../lib/staff-profile-service';

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
export async function updateStaffProfilePolicyAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const guildId = requiredString(formData, 'guildId');
  const profileId = requiredString(formData, 'profileId');
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);

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
    { userId: session.user.id },
    runtime.repositories,
  );

  revalidatePath(`/guilds/${guildId}/staff`);
  revalidatePath(`/guilds/${guildId}/staff/${profileId}`);
}
