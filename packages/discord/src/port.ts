export type DiscordMemberState = Readonly<{
  userId: string;
  isGuildOwner: boolean;
  roleIds: readonly string[];
  highestRolePosition: number;
  permissions: bigint;
}>;

export type DiscordRoleState = Readonly<{
  roleId: string;
  name: string;
  managed: boolean;
  position: number;
  permissions: bigint;
}>;

export type DiscordTextChannelState = Readonly<{
  channelId: string;
  name: string;
}>;

export type DiscordMessageState = Readonly<{
  messageId: string;
  authorUserId: string;
  createdAtMs: number;
  bulkDeletable: boolean;
}>;

export type DiscordWebhookState = Readonly<{
  webhookId: string;
  channelId: string;
}>;

export type DiscordGuildState = Readonly<{
  guildId: string;
  ownerId: string;
  knightUserId: string;
  knightRolePosition: number;
  knightPermissions: bigint;
  roles: readonly DiscordRoleState[];
}>;

export interface DiscordActionPort {
  banMember(input: { guildId: string; targetUserId: string; reason: string }): Promise<void>;
  kickMember(input: { guildId: string; targetUserId: string; reason: string }): Promise<void>;
  timeoutMember(input: {
    guildId: string;
    targetUserId: string;
    durationMs: number;
    reason: string;
  }): Promise<void>;
  unbanMember(input: { guildId: string; targetUserId: string; reason: string }): Promise<void>;
  sendDirectMessage(input: { userId: string; content: string }): Promise<void>;
  listTextChannels(guildId: string): Promise<readonly DiscordTextChannelState[]>;
  canSendToChannel(guildId: string, channelId: string): Promise<boolean>;
  sendChannelMessage(channelId: string, content: string): Promise<void>;
  listChannelWebhooks(channelId: string): Promise<readonly DiscordWebhookState[]>;
  deleteWebhook(webhookId: string, reason: string): Promise<void>;
  fetchRecentMessages(input: {
    channelId: string;
    limit: number;
  }): Promise<readonly DiscordMessageState[]>;
  deleteMessages(input: { channelId: string; messageIds: readonly string[] }): Promise<number>;
  addRole(input: {
    guildId: string;
    userId: string;
    roleId: string;
    reason: string;
  }): Promise<void>;
  removeRole(input: {
    guildId: string;
    userId: string;
    roleId: string;
    reason: string;
  }): Promise<void>;
  getMemberState(guildId: string, userId: string): Promise<DiscordMemberState | null>;
  getGuildState(guildId: string): Promise<DiscordGuildState>;
  setRolePermissions(input: {
    guildId: string;
    roleId: string;
    permissions: bigint;
    reason: string;
  }): Promise<void>;
}
