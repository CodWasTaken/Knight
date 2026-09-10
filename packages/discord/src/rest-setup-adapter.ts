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
}

type GuildPayload = Readonly<{ id: string; owner_id: string }>;
type UserPayload = Readonly<{ id: string }>;
type MemberPayload = Readonly<{ roles: readonly string[] }>;
type RolePayload = Readonly<{ id: string; position: number; permissions: string }>;

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
    const [userRaw, guildRaw, memberRaw, rolesRaw] = await Promise.all([
      this.rest.get(Routes.user()),
      this.rest.get(Routes.guild(guildId)),
      this.rest.get(Routes.guildMember(guildId)),
      this.rest.get(Routes.guildRoles(guildId)),
    ]);
    const user = asUser(userRaw);
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
        position: role.position,
        permissions: BigInt(role.permissions),
      })),
    };
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
  });
}
