export type DiscordMemberState = Readonly<{
  userId: string;
  isGuildOwner: boolean;
  roleIds: readonly string[];
  highestRolePosition: number;
  permissions: bigint;
}>;

export type DiscordRoleState = Readonly<{
  roleId: string;
  position: number;
  permissions: bigint;
}>;

export type DiscordGuildState = Readonly<{
  guildId: string;
  ownerId: string;
  knightUserId: string;
  knightRolePosition: number;
  roles: readonly DiscordRoleState[];
}>;
export interface DiscordActionPort {
  banMember(input: { guildId: string; targetUserId: string; reason: string }): Promise<void>;
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
