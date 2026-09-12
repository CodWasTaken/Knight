import type { SecurityLockdownScope, SecurityStateMode } from '@knight/contracts';

type EmergencyState = Readonly<{
  mode: SecurityStateMode;
  lockedScopes: readonly SecurityLockdownScope[];
  reason: string | null;
  updatedBy: string | null;
}>;

export type EmergencyCommandService = Readonly<{
  status(guildId: string): Promise<EmergencyState>;
  lockdown(input: {
    guildId: string;
    actorUserId: string;
    scopes: readonly SecurityLockdownScope[];
    reason: string;
  }): Promise<unknown>;
  unlock(input: { guildId: string; actorUserId: string; reason: string }): Promise<unknown>;
  panic(input: {
    guildId: string;
    actorUserId: string;
    reason: string;
    confirmed: boolean;
  }): Promise<unknown>;
  clearPanic(input: { guildId: string; actorUserId: string; reason: string }): Promise<unknown>;
}>;

export type EmergencyCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
  reason: string;
}>;

function safeError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  if (code === 'EMERGENCY_AUTHORITY_REQUIRED') {
    return 'Only the guild owner or a Knight Security Manager may change emergency state.';
  }
  if (code === 'PANIC_CONFIRMATION_REQUIRED') {
    return 'Panic was not activated because explicit confirmation is required.';
  }
  if (code === 'INVALID_LOCKDOWN_SCOPE' || code === 'REASON_REQUIRED') {
    return 'Emergency state was not changed. Check the selected scope and reason.';
  }
  return 'Knight could not change emergency state safely.';
}

export async function executeEmergencyStatus(
  guildId: string,
  service: Pick<EmergencyCommandService, 'status'>,
): Promise<{ content: string }> {
  try {
    const state = await service.status(guildId);
    const scopes = state.lockedScopes.length === 0 ? 'none' : state.lockedScopes.join(', ');
    const reason = state.reason ?? 'No emergency state has been set.';
    return {
      content: `Knight security state: ${state.mode}\nScopes: ${scopes}\nReason: ${reason}`,
    };
  } catch {
    return { content: 'Knight could not read the current emergency state safely.' };
  }
}

export async function executeEmergencyLockdown(
  input: EmergencyCommandInput & { scope: SecurityLockdownScope },
  service: Pick<EmergencyCommandService, 'lockdown'>,
): Promise<{ content: string }> {
  try {
    const { scope, ...request } = input;
    await service.lockdown({ ...request, scopes: [scope] });
    return { content: `Lockdown enabled for ${input.scope}.` };
  } catch (error) {
    return { content: safeError(error) };
  }
}

export async function executeEmergencyUnlock(
  input: EmergencyCommandInput,
  service: Pick<EmergencyCommandService, 'unlock'>,
): Promise<{ content: string }> {
  try {
    await service.unlock(input);
    return { content: 'Lockdown cleared. Knight security state is NORMAL.' };
  } catch (error) {
    return { content: safeError(error) };
  }
}

export async function executeEmergencyPanic(
  input: EmergencyCommandInput & { confirmed: boolean },
  service: Pick<EmergencyCommandService, 'panic'>,
): Promise<{ content: string }> {
  try {
    await service.panic(input);
    return { content: 'Panic activated. Privileged Knight mutations are frozen.' };
  } catch (error) {
    return { content: safeError(error) };
  }
}

export async function executeEmergencyPanicClear(
  input: EmergencyCommandInput,
  service: Pick<EmergencyCommandService, 'clearPanic'>,
): Promise<{ content: string }> {
  try {
    await service.clearPanic(input);
    return { content: 'Panic cleared. Knight security state is NORMAL.' };
  } catch (error) {
    return { content: safeError(error) };
  }
}
