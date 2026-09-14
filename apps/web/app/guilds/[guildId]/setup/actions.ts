'use server';

import { GuildMode } from '@knight/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { getWebSetupServices } from '../../../../lib/setup-runtime';
import { FactoryResetError, FactoryResetService } from '../../../../lib/factory-reset-service';

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

async function runSetupMutation(
  formData: FormData,
  operation: (context: Awaited<ReturnType<typeof authorizedSetupServices>>) => Promise<unknown>,
): Promise<void> {
  const context = await authorizedSetupServices(formData);
  try {
    await operation(context);
  } catch {
    redirect(`/guilds/${context.guildId}/setup?notice=blocked`);
    return;
  }
  revalidateSetup(context.guildId);
  redirect(`/guilds/${context.guildId}/setup?notice=success`);
}

export async function advanceSetupAction(formData: FormData): Promise<void> {
  await runSetupMutation(formData, ({ guildId, actorUserId, services }) => services.setup.advanceStep(guildId, actorUserId));
}

export async function enterTestModeAction(formData: FormData): Promise<void> {
  await runSetupMutation(formData, ({ guildId, actorUserId, services }) => services.setup.transitionMode({ guildId, actorUserId, targetMode: GuildMode.Test }));
}
export async function enableGuardedBanAction(formData: FormData): Promise<void> {
  if (formData.get('confirmGuarded') !== 'yes') {
    const guildId = requiredGuildId(formData);
    redirect(`/guilds/${guildId}/setup?notice=invalid-confirmation`);
    return;
  }
  await runSetupMutation(formData, ({ guildId, actorUserId, services }) => services.migrations.enableBanGuard({ guildId, actorUserId }));
}

export async function rollbackGuardedBanAction(formData: FormData): Promise<void> {
  await runSetupMutation(formData, ({ guildId, actorUserId, services }) => services.migrations.rollbackBanGuard({ guildId, actorUserId }));
}

export async function factoryResetAction(
  formData: FormData,
  testing?: { createService: (runtime: ReturnType<typeof getWebRuntime>) => Pick<FactoryResetService, 'requestReset'> },
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const guildId = requiredGuildId(formData);
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  if (formData.get('resetPhrase') !== 'RESET KNIGHT' || formData.get('acknowledgeReset') !== 'yes') {
    redirect(`/guilds/${guildId}/setup?notice=invalid-confirmation`);
    return;
  }
  const service = testing?.createService(runtime) ?? new FactoryResetService(runtime.repositories);
  try {
    await service.requestReset({ guildId, actorUserId: session.user.id });
  } catch (error) {
    redirect(`/guilds/${guildId}/setup?notice=${error instanceof FactoryResetError ? 'reset-blocked' : 'failed'}`);
    return;
  }
  revalidateSetup(guildId);
  redirect(`/guilds/${guildId}/setup?notice=reset-queued`);
}
