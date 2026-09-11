import type { ActionId } from './actions.js';

export const MODERATION_ACTIONS = [
  'member.warn',
  'member.timeout',
  'member.kick',
  'member.ban',
  'member.unban',
  'message.purge',
] as const satisfies readonly ActionId[];

export const RATE_LIMITED_MODERATION_ACTIONS = MODERATION_ACTIONS;

export const READ_ONLY_ACTIONS = ['member.warnings.view'] as const satisfies readonly ActionId[];

export type NativeModerationPermission =
  | 'BanMembers'
  | 'KickMembers'
  | 'ModerateMembers'
  | 'ManageMessages';
export type ModerationActionMetadata = Readonly<{
  label: string;
  readOnly?: boolean;
  nativePermission?: NativeModerationPermission;
}>;

export const MODERATION_ACTION_METADATA = {
  'member.warn': { label: 'Warn member' },
  'member.warnings.view': { label: 'View warning history', readOnly: true },
  'member.timeout': { label: 'Timeout member', nativePermission: 'ModerateMembers' },
  'member.kick': { label: 'Kick member', nativePermission: 'KickMembers' },
  'member.ban': { label: 'Ban member', nativePermission: 'BanMembers' },
  'member.unban': { label: 'Unban member', nativePermission: 'BanMembers' },
  'message.purge': { label: 'Purge messages', nativePermission: 'ManageMessages' },
} as const satisfies Readonly<
  Record<(typeof MODERATION_ACTIONS)[number] | (typeof READ_ONLY_ACTIONS)[number], ModerationActionMetadata>
>;
