'use server';

import type {
  FirewallMode,
  InventoryTrustState,
} from '@knight/database/repositories/security-repository';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebRuntime } from '../../../../lib/server-runtime';

const FIREWALL_MODES = new Set<FirewallMode>(['OBSERVE', 'ALERT', 'ENFORCE']);
const TRUST_STATES = new Set<InventoryTrustState>(['TRUSTED', 'APPROVED', 'UNKNOWN', 'BLOCKED']);

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid security settings submission.');
  }
  return value.trim();
}

async function authorizedRuntime(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const guildId = requiredString(formData, 'guildId');
  const runtime = getWebRuntime();
  await requireGuildAccess(guildId, session, runtime.repositories);
  return { guildId, runtime, actorUserId: session.user.id };
}

export async function saveFirewallSettingsAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorizedRuntime(formData);
  const botMode = requiredString(formData, 'botMode') as FirewallMode;
  const webhookMode = requiredString(formData, 'webhookMode') as FirewallMode;
  if (!FIREWALL_MODES.has(botMode) || !FIREWALL_MODES.has(webhookMode)) {
    throw new Error('Invalid firewall mode.');
  }

  await runtime.repositories.security.saveFirewallSettings({
    guildId,
    botMode,
    webhookMode,
    updatedBy: actorUserId,
  });
  try {
    await runtime.repositories.securityLedger.append({
      guildId,
      severity: 'LOW',
      source: 'CONFIG',
      action: 'firewall.settings.update',
      actorUserId,
      targetId: guildId,
      decisionId: null,
      incidentId: null,
      metadata: { botMode, webhookMode },
    });
  } catch {
    // The settings are already durable.
  }
  revalidatePath(`/guilds/${guildId}/security`);
  revalidatePath(`/guilds/${guildId}/setup`);
}

export async function saveInventoryTrustAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorizedRuntime(formData);
  const inventoryType = requiredString(formData, 'inventoryType');
  const resourceId = requiredString(formData, 'resourceId');
  const trustState = requiredString(formData, 'trustState') as InventoryTrustState;
  if ((inventoryType !== 'BOT' && inventoryType !== 'WEBHOOK') || !TRUST_STATES.has(trustState)) {
    throw new Error('Invalid firewall inventory update.');
  }
  const updated =
    inventoryType === 'BOT'
      ? await runtime.repositories.security.setBotTrustState(guildId, resourceId, trustState)
      : await runtime.repositories.security.setWebhookTrustState(guildId, resourceId, trustState);
  if (updated === null)
    throw new Error('That firewall inventory entry does not belong to this guild.');

  try {
    await runtime.repositories.securityLedger.append({
      guildId,
      severity: trustState === 'BLOCKED' ? 'MEDIUM' : 'LOW',
      source: 'CONFIG',
      action: 'firewall.inventory.update',
      actorUserId,
      targetId: resourceId,
      decisionId: null,
      incidentId: null,
      metadata: { inventoryType, trustState },
    });
  } catch {
    // The inventory state is already durable.
  }
  revalidatePath(`/guilds/${guildId}/security`);
}
