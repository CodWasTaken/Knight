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

export type DiscordStructuralRole = Readonly<{
  id: string;
  name: string;
  managed: boolean;
  permissions: string;
  position: number;
  color: number;
  hoist: boolean;
  mentionable: boolean;
}>;

export type DiscordStructuralPermissionOverwrite = Readonly<{
  id: string;
  type: 'ROLE' | 'MEMBER';
  allow: string;
  deny: string;
}>;

export type DiscordStructuralChannel = Readonly<{
  id: string;
  name: string;
  type: 'CATEGORY' | 'TEXT';
  parentId: string | null;
  position: number;
  permissionOverwrites: readonly DiscordStructuralPermissionOverwrite[];
}>;
export type DiscordStructuralSnapshot = Readonly<{
  guildId: string;
  roles: readonly DiscordStructuralRole[];
  channels: readonly DiscordStructuralChannel[];
}>;

export type ArchivedMessageAttachment = Readonly<{
  id: string;
  filename: string;
  size: number;
  url: string;
  contentType: string | null;
}>;

export type ArchivedMessageEvidence = Readonly<{
  id: string;
  authorId: string;
  timestamp: string;
  content: string;
  attachments: readonly ArchivedMessageAttachment[];
}>;