'use server';

import {
  SECURITY_LOCKDOWN_SCOPES,
  type SecurityLockdownScope,
} from '@knight/contracts';
import { SecurityRecorder } from '@knight/bot/security';
import type {
  FirewallMode,
  InventoryTrustState,
} from '@knight/database/repositories/security-repository';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { getWebRuntime } from '../../../../lib/server-runtime';

const FIREWALL_MODES = new Set<FirewallMode>(['OBSERVE', 'ALERT', 'ENFORCE']);
const TRUST_STATES = new Set<InventoryTrustState>(['TRUSTED', 'APPROVED', 'UNKNOWN', 'BLOCKED']);
const LOCKDOWN_SCOPES = new Set<string>(SECURITY_LOCKDOWN_SCOPES);

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

async function requireFirewallConfigurationAvailable(
  runtime: ReturnType<typeof getWebRuntime>,
  guildId: string,
): Promise<void> {
  const state = await runtime.repositories.security.getSecurityState(guildId);
  const locked = state.lockedScopes.some((scope) =>
    ['BOTS_WEBHOOKS', 'SECURITY_CONFIG', 'FULL'].includes(scope),
  );
  if (state.mode === 'PANIC' || (state.mode === 'LOCKDOWN' && locked)) {
    throw new Error('The current emergency state blocks bot and webhook configuration changes.');
  }
}

async function recordEmergencyTransition(input: {
  runtime: ReturnType<typeof getWebRuntime>;
  guildId: string;
  actorUserId: string;
  action: string;
  severity: 'HIGH' | 'CRITICAL';
  mode: 'NORMAL' | 'LOCKDOWN' | 'PANIC';
  lockedScopes: readonly SecurityLockdownScope[];
  reason: string;
  incidentId?: string | null;
}): Promise<void> {
  const entry = {
    guildId: input.guildId,
    severity: input.severity,
    source: 'SECURITY',
    action: input.action,
    actorUserId: input.actorUserId,
    targetId: input.guildId,
    decisionId: null,
    incidentId: input.incidentId ?? null,
    metadata: {
      mode: input.mode,
      lockedScopes: input.lockedScopes,
      reason: input.reason,
    },
  } as const;
  const discord = getWebDiscordAdapter(input.runtime);
  if (discord === null) {
    await input.runtime.repositories.securityLedger.append(entry);
  } else {
    await new SecurityRecorder({
      ledger: input.runtime.repositories.securityLedger,
      discord,
    }).record(entry, 'SECURITY');
  }
  revalidatePath(`/guilds/${input.guildId}/security`);
}

export async function activateLockdownAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorizedRuntime(formData);
  const scope = requiredString(formData, 'scope') as SecurityLockdownScope;
  const reason = requiredString(formData, 'reason');
  if (!LOCKDOWN_SCOPES.has(scope)) throw new Error('Invalid Lockdown scope.');
  const state = await runtime.repositories.security.transitionSecurityState({
    guildId,
    expectedModes: ['NORMAL', 'LOCKDOWN'],
    mode: 'LOCKDOWN',
    lockedScopes: [scope],
    reason,
    updatedBy: actorUserId,
  });
  if (state === null) throw new Error('The emergency state changed before Lockdown was applied.');
  await recordEmergencyTransition({
    runtime,
    guildId,
    actorUserId,
    action: 'security.lockdown.enabled',
    severity: 'HIGH',
    mode: 'LOCKDOWN',
    lockedScopes: [scope],
    reason,
  });
}

export async function clearLockdownAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorizedRuntime(formData);
  const reason = requiredString(formData, 'reason');
  const state = await runtime.repositories.security.transitionSecurityState({
    guildId,
    expectedModes: ['LOCKDOWN'],
    mode: 'NORMAL',
    lockedScopes: [],
    reason,
    updatedBy: actorUserId,
  });
  if (state === null) throw new Error('Lockdown is not active.');
  await recordEmergencyTransition({
    runtime,
    guildId,
    actorUserId,
    action: 'security.lockdown.cleared',
    severity: 'HIGH',
    mode: 'NORMAL',
    lockedScopes: [],
    reason,
  });
}

export async function activatePanicAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorizedRuntime(formData);
  const reason = requiredString(formData, 'reason');
  if (formData.get('confirm') !== 'on') throw new Error('Panic confirmation is required.');

  const state = await runtime.repositories.security.transitionSecurityState({
    guildId,
    expectedModes: ['NORMAL', 'LOCKDOWN', 'PANIC'],
    mode: 'PANIC',
    lockedScopes: [],
    reason,
    updatedBy: actorUserId,
  });
  if (state === null) throw new Error('The emergency state changed before Panic was applied.');
  const incident = await runtime.repositories.security.findOrCreateIncident({
    guildId,
    actorKey: 'emergency:panic',
    severity: 'CRITICAL',
    summary: `Panic activated: ${reason}`,
    occurredAt: new Date(),
  });
  await recordEmergencyTransition({
    runtime,
    guildId,
    actorUserId,
    action: 'security.panic.enabled',
    severity: 'CRITICAL',
    mode: 'PANIC',
    lockedScopes: [],
    reason,
    incidentId: incident.id,
  });
}

export async function clearPanicAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorizedRuntime(formData);
  const reason = requiredString(formData, 'reason');
  const state = await runtime.repositories.security.transitionSecurityState({
    guildId,
    expectedModes: ['PANIC'],
    mode: 'NORMAL',
    lockedScopes: [],
    reason,
    updatedBy: actorUserId,
  });
  if (state === null) throw new Error('Panic is not active.');
  await recordEmergencyTransition({
    runtime,
    guildId,
    actorUserId,
    action: 'security.panic.cleared',
    severity: 'CRITICAL',
    mode: 'NORMAL',
    lockedScopes: [],
    reason,
  });
}

export async function saveFirewallSettingsAction(formData: FormData): Promise<void> {
  const { guildId, runtime, actorUserId } = await authorizedRuntime(formData);
  const botMode = requiredString(formData, 'botMode') as FirewallMode;
  const webhookMode = requiredString(formData, 'webhookMode') as FirewallMode;
  if (!FIREWALL_MODES.has(botMode) || !FIREWALL_MODES.has(webhookMode)) {
    throw new Error('Invalid firewall mode.');
  }
  await requireFirewallConfigurationAvailable(runtime, guildId);

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
  await requireFirewallConfigurationAvailable(runtime, guildId);
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
