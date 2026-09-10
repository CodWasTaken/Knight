export const ACTION_IDS = [
  'member.warn',
  'member.warnings.view',
  'member.timeout',
  'member.kick',
  'member.ban',
  'member.unban',
  'message.purge',
  'security.staff.assign',
  'security.staff.remove',
  'security.staff.manage_profiles',
  'security.security_managers.manage',
  'security.policy.view',
  'security.policy.edit',
  'security.approvals.approve',
  'security.lockdown',
  'security.panic',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];
