import { REST } from '@discordjs/rest';
import type {
  ArchivedMessageEvidence,
  DiscordStructuralChannel,
  DiscordStructuralPermissionOverwrite,
  DiscordStructuralRole,
  DiscordStructuralSnapshot,
} from '@knight/contracts';
import { ChannelType, Routes } from 'discord-api-types/v10';
import type {
  DiscordChannelPosition,
  DiscordRolePosition,
  DiscordStructurePort,
} from './structure-port.js';

type DiscordRoute = `/${string}`;

export interface DiscordStructureRestClient {
  get(route: DiscordRoute, options?: { query?: URLSearchParams }): Promise<unknown>;
  post(route: DiscordRoute, options: { body: unknown; reason?: string }): Promise<unknown>;
  patch(route: DiscordRoute, options: { body: unknown; reason?: string }): Promise<unknown>;
}

type RolePayload = Readonly<{
  id: string;
  name: string;
  managed: boolean;
  permissions: string;
  position: number;
  color: number;
  hoist: boolean;
  mentionable: boolean;
}>;
type ChannelPayload = Readonly<{
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number;
  permission_overwrites?: readonly Readonly<{
    id: string;
    type: number;
    allow: string;
    deny: string;
  }>[];
}>;

type MessagePayload = Readonly<{
  id: string;
  author: Readonly<{ id: string }>;
  timestamp: string;
  content: string;
  attachments: readonly Readonly<{
    id: string;
    filename: string;
    size: number;
    url: string;
    content_type?: string | null;
  }>[];
}>;

function asRoles(value: unknown): readonly RolePayload[] {
  return value as readonly RolePayload[];
}
function asChannels(value: unknown): readonly ChannelPayload[] {
  return value as readonly ChannelPayload[];
}

function asMessages(value: unknown): readonly MessagePayload[] {
  return value as readonly MessagePayload[];
}

function toChannelType(type: DiscordStructuralChannel['type']): ChannelType.GuildCategory | ChannelType.GuildText {
  return type === 'CATEGORY' ? ChannelType.GuildCategory : ChannelType.GuildText;
}

function normalizeOverwrite(overwrite: NonNullable<ChannelPayload['permission_overwrites']>[number]): DiscordStructuralPermissionOverwrite {
  return {
    id: overwrite.id,
    type: overwrite.type === 1 ? 'MEMBER' : 'ROLE',
    allow: overwrite.allow,
    deny: overwrite.deny,
  };
}

function overwriteBody(overwrite: DiscordStructuralPermissionOverwrite): {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
} {
  return {
    id: overwrite.id,
    type: overwrite.type === 'MEMBER' ? 1 : 0,
    allow: overwrite.allow,
    deny: overwrite.deny,
  };
}
function roleBody(role: DiscordStructuralRole): Record<string, unknown> {
  return {
    name: role.name,
    permissions: role.permissions,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
  };
}

export class DiscordRestStructureAdapter implements DiscordStructurePort {
  public constructor(private readonly rest: DiscordStructureRestClient) {}

  public async captureGuild(guildId: string): Promise<DiscordStructuralSnapshot> {
    const [rolesRaw, channelsRaw] = await Promise.all([
      this.rest.get(Routes.guildRoles(guildId)),
      this.rest.get(Routes.guildChannels(guildId)),
    ]);
    const roles = asRoles(rolesRaw).map((role) => ({
      id: role.id,
      name: role.name,
      managed: role.managed,
      permissions: role.permissions,
      position: role.position,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
    }));
    const channels = asChannels(channelsRaw)
      .filter((channel) =>
        channel.type === ChannelType.GuildCategory || channel.type === ChannelType.GuildText,
      )      .map((channel): DiscordStructuralChannel => ({
        id: channel.id,
        name: channel.name,
        type: channel.type === ChannelType.GuildCategory ? 'CATEGORY' : 'TEXT',
        parentId: channel.parent_id,
        position: channel.position,
        permissionOverwrites: (channel.permission_overwrites ?? []).map(normalizeOverwrite),
      }));
    return { guildId, roles, channels };
  }

  public async createRole(
    guildId: string,
    role: DiscordStructuralRole,
    reason: string,
  ): Promise<{ id: string }> {
    const response = (await this.rest.post(Routes.guildRoles(guildId), {
      body: roleBody(role),
      reason,
    })) as { id: string };
    return { id: response.id };
  }

  public async updateRole(
    guildId: string,
    roleId: string,
    role: DiscordStructuralRole,
    reason: string,
  ): Promise<void> {
    await this.rest.patch(Routes.guildRole(guildId, roleId), { body: roleBody(role), reason });
  }
  public async setRolePositions(
    guildId: string,
    positions: readonly DiscordRolePosition[],
    reason: string,
  ): Promise<void> {
    await this.rest.patch(Routes.guildRoles(guildId), {
      body: positions.map((position) => ({ id: position.id, position: position.position })),
      reason,
    });
  }

  public async createChannel(
    guildId: string,
    channel: DiscordStructuralChannel,
    reason: string,
  ): Promise<{ id: string }> {
    const response = (await this.rest.post(Routes.guildChannels(guildId), {
      body: {
        name: channel.name,
        type: toChannelType(channel.type),
        parent_id: channel.parentId,
      },
      reason,
    })) as { id: string };
    return { id: response.id };
  }

  public async updateChannel(
    channelId: string,
    channel: DiscordStructuralChannel,
    reason: string,
  ): Promise<void> {    await this.rest.patch(Routes.channel(channelId), {
      body: { name: channel.name, parent_id: channel.parentId },
      reason,
    });
  }

  public async setChannelPositions(
    guildId: string,
    positions: readonly DiscordChannelPosition[],
    reason: string,
  ): Promise<void> {
    await this.rest.patch(Routes.guildChannels(guildId), {
      body: positions.map((position) => ({
        id: position.id,
        position: position.position,
        parent_id: position.parentId,
      })),
      reason,
    });
  }

  public async setChannelPermissionOverwrites(
    channelId: string,
    overwrites: readonly DiscordStructuralPermissionOverwrite[],
    reason: string,
  ): Promise<void> {
    await this.rest.patch(Routes.channel(channelId), {
      body: { permission_overwrites: overwrites.map(overwriteBody) },
      reason,
    });
  }
  public async fetchChannelMessages(
    channelId: string,
    limit: number,
  ): Promise<readonly ArchivedMessageEvidence[]> {
    const messages: ArchivedMessageEvidence[] = [];
    let remaining = Math.max(0, Math.floor(limit));
    let before: string | undefined;

    while (remaining > 0) {
      const pageLimit = Math.min(100, remaining);
      const query = new URLSearchParams({ limit: String(pageLimit) });
      if (before !== undefined) query.set('before', before);
      const page = asMessages(
        await this.rest.get(Routes.channelMessages(channelId), { query }),
      );
      if (page.length === 0) break;

      for (const message of page.slice(0, remaining)) {
        messages.push({
          id: message.id,
          authorId: message.author.id,
          timestamp: message.timestamp,
          content: message.content,
          attachments: message.attachments.map((attachment) => ({
            id: attachment.id,
            filename: attachment.filename,
            size: attachment.size,
            url: attachment.url,
            contentType: attachment.content_type ?? null,
          })),
        });
      }
      remaining -= Math.min(page.length, remaining);
      if (page.length < pageLimit) break;
      before = page.at(-1)?.id;
      if (before === undefined) break;
    }

    return messages;
  }
}

export function createDiscordRestStructureAdapter(token: string): DiscordRestStructureAdapter {
  const rest = new REST({ version: '10' }).setToken(token);
  return new DiscordRestStructureAdapter({
    get: (route, options) => rest.get(route, options),
    post: (route, options) => rest.post(route, options),
    patch: (route, options) => rest.patch(route, options),
  });
}
