import type { SecurityLockdownScope } from '@knight/contracts';

export async function requireEmergencyScopesAvailable(
  security: {
    getSecurityState(guildId: string): Promise<{
      mode: 'NORMAL' | 'LOCKDOWN' | 'PANIC';
      lockedScopes: readonly SecurityLockdownScope[];
    }>;
  },
  guildId: string,
  scopes: readonly SecurityLockdownScope[],
): Promise<void> {
  const state = await security.getSecurityState(guildId);
  const blocked = state.lockedScopes.includes('FULL') ||
    scopes.some((scope) => state.lockedScopes.includes(scope));
  if (state.mode === 'PANIC' || (state.mode === 'LOCKDOWN' && blocked)) {
    throw new Error('The current emergency state blocks this configuration change.');
  }
}
