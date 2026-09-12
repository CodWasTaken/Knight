export const SECURITY_STATE_MODES = ['NORMAL', 'LOCKDOWN', 'PANIC'] as const;
export type SecurityStateMode = (typeof SECURITY_STATE_MODES)[number];

export const SECURITY_LOCKDOWN_SCOPES = [
  'MEMBER_MODERATION',
  'ROLES',
  'CHANNELS',
  'BOTS_WEBHOOKS',
  'SECURITY_CONFIG',
  'FULL',
] as const;
export type SecurityLockdownScope = (typeof SECURITY_LOCKDOWN_SCOPES)[number];
