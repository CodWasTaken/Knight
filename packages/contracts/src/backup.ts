export const BACKUP_POLICY_MODES = ['DISABLED', 'MANUAL', 'DAILY'] as const;
export type BackupPolicyMode = (typeof BACKUP_POLICY_MODES)[number];

export const BACKUP_JOB_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type BackupJobStatus = (typeof BACKUP_JOB_STATUSES)[number];

export const RECOVERY_JOB_PHASES = ['PREVIEW', 'EXECUTION'] as const;
export type RecoveryJobPhase = (typeof RECOVERY_JOB_PHASES)[number];

export const RECOVERY_JOB_STATUSES = [
  'PENDING',
  'RUNNING',
  'PREVIEW_READY',
  'COMPLETED',
  'FAILED',
] as const;
export type RecoveryJobStatus = (typeof RECOVERY_JOB_STATUSES)[number];

export type BackupPolicy = Readonly<{
  mode: BackupPolicyMode;
  archiveChannelIds: readonly string[];
  maxMessagesPerChannel: number;
}>;
