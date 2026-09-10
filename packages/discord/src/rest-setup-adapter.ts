import { REST } from '@discordjs/rest';
import { PermissionFlagsBits, Routes } from 'discord-api-types/v10';
import type { DiscordGuildState } from './port.js';

const ALL_KNOWN_PERMISSIONS = Object.values(PermissionFlagsBits).reduce(
  (combined, permission) => combined | permission,
  0n,
);

type DiscordRoute = `/${string}`;

export interface DiscordRestClient {
  get(route: DiscordRoute): Promise<unknown>;
  patch(route: DiscordRoute, options: { body: unknown; reason?: string }): Promise<unknown>;
  put?(route: DiscordRoute, options?: { reason?: string }): Promise<unknown>;
  delete?(route: DiscordRoute, options?: { reason?: string }): Promise<unknown>;
}

type GuildPayload = Readonly<{ id: string; owner_id: string }>;
type UserPayload = Readonly<{ id: string }>;
type MemberPayload = Readonly<{ roles: readonly string[] }>;
type RolePayload = Readonly<{
  id: string;
  name: string;
  managed: boolean;
  position: number;
  permissions: string;
}>;

function asGuild(value: unknown): GuildPayload {
  return value as GuildPayload;
}
function asUser(value: unknown): UserPayload {
  return value as UserPayload;
}
function asMember(value: unknown): MemberPayload {
  return value as MemberPayload;
}
function asRoles(value: unknown): readonly RolePayload[] {
  return value as readonly RolePayload[];
}
export class DiscordRestSetupAdapter {
  public constructor(private readonly rest: DiscordRestClient) {}

  public async getGuildState(guildId: string): Promise<DiscordGuildState> {
    const user = asUser(await this.rest.get(Routes.user()));
    const [guildRaw, memberRaw, rolesRaw] = await Promise.all([
      this.rest.get(Routes.guild(guildId)),
      this.rest.get(Routes.guildMember(guildId, user.id)),
      this.rest.get(Routes.guildRoles(guildId)),
    ]);
    const guild = asGuild(guildRaw);
    const member = asMember(memberRaw);
    const roles = asRoles(rolesRaw);
    const memberRoleIds = new Set(member.roles);

    let combinedPermissions = 0n;
    let knightRolePosition = 0;
    for (const role of roles) {
      if (role.id !== guildId && !memberRoleIds.has(role.id)) continue;
      combinedPermissions |= BigInt(role.permissions);
      knightRolePosition = Math.max(knightRolePosition, role.position);
    }
    const knightPermissions =
      (combinedPermissions & PermissionFlagsBits.Administrator) ===
      PermissionFlagsBits.Administrator
        ? ALL_KNOWN_PERMISSIONS
        : combinedPermissions;

    return {
      guildId: guild.id,
      ownerId: guild.owner_id,
      knightUserId: user.id,
      knightRolePosition,
      knightPermissions,
      roles: roles.map((role) => ({
        roleId: role.id,
        name: role.name,
        managed: role.managed,
        position: role.position,
        permissions: BigInt(role.permissions),
      })),
    };
  }

  public async addRole(input: {
    guildId: string;
    userId: string;
    roleId: string;
    reason: string;
  }): Promise<void> {
    if (this.rest.put === undefined) throw new Error('Discord REST client does not support PUT');
    await this.rest.put(Routes.guildMemberRole(input.guildId, input.userId, input.roleId), {
      reason: input.reason,
    });
  }

  public async removeRole(input: {
    guildId: string;
    userId: string;
    roleId: string;
    reason: string;
  }): Promise<void> {
    if (this.rest.delete === undefined) throw new Error('Discord REST client does not support DELETE');
    await this.rest.delete(Routes.guildMemberRole(input.guildId, input.userId, input.roleId), {
      reason: input.reason,
    });
  }

  public async setRolePermissions(input: {
    guildId: string;
    roleId: string;
    permissions: bigint;
    reason: string;
  }): Promise<void> {
    await this.rest.patch(Routes.guildRole(input.guildId, input.roleId), {
      body: { permissions: input.permissions.toString() },
      reason: input.reason,
    });
  }
}
export function createDiscordRestSetupAdapter(token: string): DiscordRestSetupAdapter {
  const rest = new REST({ version: '10' }).setToken(token);
  return new DiscordRestSetupAdapter({
    get: (route) => rest.get(route),
    patch: (route, options) => rest.patch(route, options),
    put: (route, options) => rest.put(route, options),
    delete: (route, options) => rest.delete(route, options),
  });
}
