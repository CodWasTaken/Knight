import { ChannelType, PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import type {
  DiscordActionPort,
  DiscordGuildState,
  DiscordMemberState,
  DiscordMessageState,
  DiscordTextChannelState,
  DiscordWebhookState,
} from './port.js';

const UNKNOWN_MEMBER_ERROR_CODE = 10_007;

function hasDiscordApiCode(error: unknown, code: number): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return (error as { code?: unknown }).code === code;
}

export class DiscordJsAdapter implements DiscordActionPort {
  public constructor(private readonly client: Client) {}

  private async fetchGuild(guildId: string): Promise<Guild> {
    return this.client.guilds.fetch(guildId);
  }

  public async banMember(input: {
    guildId: string;
    targetUserId: string;
    reason: string;
  }): Promise<void> {
    const guild = await this.fetchGuild(input.guildId);
    await guild.members.ban(input.targetUserId, { reason: input.reason });
  }

  public async kickMember(input: {
    guildId: string;
    targetUserId: string;
    reason: string;
  }): Promise<void> {
    const guild = await this.fetchGuild(input.guildId);
    await guild.members.kick(input.targetUserId, input.reason);
  }

  public async timeoutMember(input: {
    guildId: string;
    targetUserId: string;
    durationMs: number;
    reason: string;
  }): Promise<void> {
    const guild = await this.fetchGuild(input.guildId);
    const member = await guild.members.fetch(input.targetUserId);
    await member.timeout(input.durationMs, input.reason);
  }

  public async unbanMember(input: {
    guildId: string;
    targetUserId: string;
    reason: string;
  }): Promise<void> {
    const guild = await this.fetchGuild(input.guildId);
    await guild.members.unban(input.targetUserId, input.reason);
  }

  public async sendDirectMessage(input: { userId: string; content: string }): Promise<void> {
    const user = await this.client.users.fetch(input.userId);
    await user.send(input.content);
  }

  public async listTextChannels(guildId: string): Promise<readonly DiscordTextChannelState[]> {
    const guild = await this.fetchGuild(guildId);
    const channels = await guild.channels.fetch();
    return [...channels.values()]
      .filter(
        (channel) =>
          channel !== null &&
          (channel.type === ChannelType.GuildText ||
            channel.type === ChannelType.GuildAnnouncement),
      )
      .map((channel) => ({ channelId: channel.id, name: channel.name }));
  }

  public async canSendToChannel(guildId: string, channelId: string): Promise<boolean> {
    const guild = await this.fetchGuild(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (
      channel === null ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return false;
    }
    const knight = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(knight);
    return (
      permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]) ?? false
    );
  }

  public async sendChannelMessage(channelId: string, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (channel === null || !channel.isTextBased() || !('send' in channel)) {
      throw new Error(`Discord channel ${channelId} cannot receive text notifications`);
    }
    await channel.send(content);
  }

  public async listChannelWebhooks(channelId: string): Promise<readonly DiscordWebhookState[]> {
    const channel = await this.client.channels.fetch(channelId);
    if (channel === null || !('fetchWebhooks' in channel)) {
      throw new Error(`Discord channel ${channelId} does not support webhooks`);
    }
    const webhooks = await channel.fetchWebhooks();
    return [...webhooks.values()].map((webhook) => ({
      webhookId: webhook.id,
      channelId: webhook.channelId ?? channelId,
    }));
  }

  public async deleteWebhook(webhookId: string, reason: string): Promise<void> {
    const webhook = await this.client.fetchWebhook(webhookId);
    await webhook.delete(reason);
  }

  public async fetchRecentMessages(input: {
    channelId: string;
    limit: number;
  }): Promise<readonly DiscordMessageState[]> {
    const channel = await this.client.channels.fetch(input.channelId);
    if (channel === null || !channel.isTextBased() || !('messages' in channel)) {
      throw new Error(`Discord channel ${input.channelId} is not text-capable`);
    }
    const messages = await channel.messages.fetch({ limit: input.limit });
    return [...messages.values()].map((message) => ({
      messageId: message.id,
      authorUserId: message.author.id,
      createdAtMs: message.createdTimestamp,
      bulkDeletable: message.bulkDeletable,
    }));
  }

  public async deleteMessages(input: {
    channelId: string;
    messageIds: readonly string[];
  }): Promise<number> {
    const channel = await this.client.channels.fetch(input.channelId);
    if (channel === null || !channel.isTextBased() || !('bulkDelete' in channel)) {
      throw new Error(`Discord channel ${input.channelId} does not support bulk deletion`);
    }
    const deleted = await channel.bulkDelete([...input.messageIds], true);
    return deleted.size;
  }

  public async addRole(input: {
    guildId: string;
    userId: string;
    roleId: string;
    reason: string;
  }): Promise<void> {
    const guild = await this.fetchGuild(input.guildId);
    const member = await guild.members.fetch(input.userId);
    await member.roles.add(input.roleId, input.reason);
  }

  public async removeRole(input: {
    guildId: string;
    userId: string;
    roleId: string;
    reason: string;
  }): Promise<void> {
    const guild = await this.fetchGuild(input.guildId);
    const member = await guild.members.fetch(input.userId);
    await member.roles.remove(input.roleId, input.reason);
  }

  public async getMemberState(guildId: string, userId: string): Promise<DiscordMemberState | null> {
    const guild = await this.fetchGuild(guildId);
    try {
      const member = await guild.members.fetch(userId);
      return {
        userId: member.id,
        isGuildOwner: guild.ownerId === member.id,
        roleIds: [...member.roles.cache.keys()],
        highestRolePosition: member.roles.highest.position,
        permissions: member.permissions.bitfield,
      };
    } catch (error) {
      if (hasDiscordApiCode(error, UNKNOWN_MEMBER_ERROR_CODE)) return null;
      throw error;
    }
  }

  public async getGuildState(guildId: string): Promise<DiscordGuildState> {
    const guild = await this.fetchGuild(guildId);
    const [knightMember, roles] = await Promise.all([guild.members.fetchMe(), guild.roles.fetch()]);

    return {
      guildId: guild.id,
      ownerId: guild.ownerId,
      knightUserId: knightMember.id,
      knightRolePosition: knightMember.roles.highest.position,
      knightPermissions: knightMember.permissions.bitfield,
      roles: [...roles.values()].map((role) => ({
        roleId: role.id,
        name: role.name,
        managed: role.managed,
        position: role.position,
        permissions: role.permissions.bitfield,
      })),
    };
  }

  public async setRolePermissions(input: {
    guildId: string;
    roleId: string;
    permissions: bigint;
    reason: string;
  }): Promise<void> {
    const guild = await this.fetchGuild(input.guildId);
    const role = await guild.roles.fetch(input.roleId);
    if (role === null) {
      throw new Error(`Discord role ${input.roleId} does not exist in guild ${input.guildId}`);
    }
    await role.setPermissions(input.permissions, input.reason);
  }
}
