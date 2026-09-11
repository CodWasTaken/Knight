export const SETUP_STEPS = [
  'WELCOME',
  'HEALTH',
  'STAFF',
  'POLICIES',
  'LOGGING',
  'PROTECTION',
  'BACKUPS',
  'OBSERVE',
  'COMPLETE',
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];
