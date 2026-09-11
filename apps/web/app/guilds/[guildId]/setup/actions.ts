'use server';

import { GuildMode } from '@knight/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { getWebSetupServices } from '../../../../lib/setup-runtime';

function requiredGuildId(formData: FormData): string {
  const value = formData.get('guildId');
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid setup form submission.');
  }
  return value;
}

async function authorizedSetupServices(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const guildId = requiredGuildId(formData);
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  const services = getWebSetupServices(runtime);
  if (services === null) {
    throw new Error(
      'Live Discord setup operations are unavailable because DISCORD_TOKEN is not configured for the web service.',
    );
  }

  return { guildId, actorUserId: session.user.id, services } as const;
}

function revalidateSetup(guildId: string): void {
  revalidatePath(`/guilds/${guildId}`);
  revalidatePath(`/guilds/${guildId}/setup`);
}

export async function advanceSetupAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, services } = await authorizedSetupServices(formData);
  await services.setup.advanceStep(guildId, actorUserId);
  revalidateSetup(guildId);
}

export async function enterTestModeAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, services } = await authorizedSetupServices(formData);
  await services.setup.transitionMode({ guildId, actorUserId, targetMode: GuildMode.Test });
  revalidateSetup(guildId);
}
export async function enableGuardedBanAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, services } = await authorizedSetupServices(formData);
  if (formData.get('confirmGuarded') !== 'yes') {
    throw new Error('Guarded enable requires explicit owner confirmation.');
  }
  await services.migrations.enableBanGuard({ guildId, actorUserId });
  revalidateSetup(guildId);
}

export async function rollbackGuardedBanAction(formData: FormData): Promise<void> {
  const { guildId, actorUserId, services } = await authorizedSetupServices(formData);
  await services.migrations.rollbackBanGuard({ guildId, actorUserId });
  revalidateSetup(guildId);
}
