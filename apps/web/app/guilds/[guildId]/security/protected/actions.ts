'use server';

import { ProtectionLevel } from '@knight/contracts';
import type { SecurityResourceType } from '@knight/database/repositories/security-repository';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '../../../../../auth';
import { requireGuildAccess } from '../../../../../lib/authorization';
import { getWebDiscordAdapter } from '../../../../../lib/discord-runtime';
import { requireEmergencyScopesAvailable } from '../../../../../lib/emergency-state';
import { getWebRuntime } from '../../../../../lib/server-runtime';

const RESOURCE_TYPES = new Set<SecurityResourceType>(['USER', 'ROLE', 'CHANNEL']);
const LEVELS = new Set<ProtectionLevel>([
  ProtectionLevel.Important,
  ProtectionLevel.Critical,
  ProtectionLevel.Immutable,
]);

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid protected resource submission.');
  }
  return value.trim();
}

async function authorized(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const guildId = requiredString(formData, 'guildId');
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  return { guildId, runtime, actorUserId: session.user.id };
}

function resourceInput(formData: FormData) {
  const resourceType = requiredString(formData, 'resourceType') as SecurityResourceType;
  const resourceId = requiredString(formData, 'resourceId');
  if (!RESOURCE_TYPES.has(resourceType)) throw new Error('Invalid protected resource type.');
  if (!/^\d+$/.test(resourceId)) throw new Error('Invalid Discord resource ID.');
  return { resourceType, resourceId };
}

export async function saveProtectedResourceAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorized(formData);
  const { resourceType, resourceId } = resourceInput(formData);
  await requireEmergencyScopesAvailable(runtime.repositories.security, guildId, [
    'SECURITY_CONFIG',
    ...(resourceType === 'ROLE' ? (['ROLES'] as const) : []),
    ...(resourceType === 'CHANNEL' ? (['CHANNELS'] as const) : []),
  ]);
  const level = requiredString(formData, 'level') as ProtectionLevel;
  if (!LEVELS.has(level)) throw new Error('Invalid protection level.');
  const discord = getWebDiscordAdapter(runtime);
  if (discord === null) throw new Error('Live Discord validation is unavailable.');

  if (resourceType === 'USER') {
    if ((await discord.getMemberState(guildId, resourceId)) === null) {
      throw new Error('That member does not belong to this guild.');
    }
  } else if (resourceType === 'ROLE') {
    const role = (await discord.getGuildState(guildId)).roles.find(
      (candidate) => candidate.roleId === resourceId,
    );
    if (role === undefined) throw new Error('That role does not belong to this guild.');
    if (role.managed)
      throw new Error('A Discord-managed role cannot be a managed protected target.');
  } else if ((await discord.getGuildChannelState(guildId, resourceId)) === null) {
    throw new Error('That channel does not belong to this guild.');
  }

  await runtime.repositories.security.saveProtection({
    guildId,
    resourceType,
    resourceId,
    level: level as Exclude<ProtectionLevel, ProtectionLevel.Normal>,
    updatedBy: actorUserId,
  });
  try {
    await runtime.repositories.securityLedger.append({
      guildId,
      severity: level === ProtectionLevel.Immutable ? 'MEDIUM' : 'LOW',
      source: 'CONFIG',
      action: 'protected_resource.update',
      actorUserId,
      targetId: resourceId,
      decisionId: null,
      incidentId: null,
      metadata: { resourceType, level },
    });
  } catch {
    // The protected resource is already durable.
  }
  revalidatePath(`/guilds/${guildId}/security`);
  revalidatePath(`/guilds/${guildId}/security/protected`);
}

export async function removeProtectedResourceAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorized(formData);
  const { resourceType, resourceId } = resourceInput(formData);
  await requireEmergencyScopesAvailable(runtime.repositories.security, guildId, [
    'SECURITY_CONFIG',
    ...(resourceType === 'ROLE' ? (['ROLES'] as const) : []),
    ...(resourceType === 'CHANNEL' ? (['CHANNELS'] as const) : []),
  ]);
  if (
    (await runtime.repositories.security.getProtectionLevel(guildId, resourceType, resourceId)) ===
    ProtectionLevel.Normal
  ) {
    throw new Error('That protected resource does not belong to this guild.');
  }
  await runtime.repositories.security.removeProtection(guildId, resourceType, resourceId);
  try {
    await runtime.repositories.securityLedger.append({
      guildId,
      severity: 'LOW',
      source: 'CONFIG',
      action: 'protected_resource.remove',
      actorUserId,
      targetId: resourceId,
      decisionId: null,
      incidentId: null,
      metadata: { resourceType },
    });
  } catch {
    // The removal is already durable.
  }
  revalidatePath(`/guilds/${guildId}/security`);
  revalidatePath(`/guilds/${guildId}/security/protected`);
}
