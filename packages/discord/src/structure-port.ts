import type {
  ArchivedMessageEvidence,
  DiscordStructuralChannel,
  DiscordStructuralPermissionOverwrite,
  DiscordStructuralRole,
  DiscordStructuralSnapshot,
} from '@knight/contracts';

export type DiscordRolePosition = Readonly<{
  id: string;
  position: number;
}>;

export type DiscordChannelPosition = Readonly<{
  id: string;
  position: number;
  parentId: string | null;
}>;

export interface DiscordStructurePort {
  captureGuild(guildId: string): Promise<DiscordStructuralSnapshot>;
  createRole(
    guildId: string,
    role: DiscordStructuralRole,
    reason: string,
  ): Promise<{ id: string }>;
  updateRole(
    guildId: string,
    roleId: string,
    role: DiscordStructuralRole,
    reason: string,
  ): Promise<void>;  setRolePositions(
    guildId: string,
    positions: readonly DiscordRolePosition[],
    reason: string,
  ): Promise<void>;
  createChannel(
    guildId: string,
    channel: DiscordStructuralChannel,
    reason: string,
  ): Promise<{ id: string }>;
  updateChannel(
    channelId: string,
    channel: DiscordStructuralChannel,
    reason: string,
  ): Promise<void>;
  setChannelPositions(
    guildId: string,
    positions: readonly DiscordChannelPosition[],
    reason: string,
  ): Promise<void>;
  setChannelPermissionOverwrites(
    channelId: string,
    overwrites: readonly DiscordStructuralPermissionOverwrite[],
    reason: string,
  ): Promise<void>;
  fetchChannelMessages(channelId: string, limit: number): Promise<readonly ArchivedMessageEvidence[]>;
}
