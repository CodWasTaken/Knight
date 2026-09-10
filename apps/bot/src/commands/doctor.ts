import { PermissionFlagsBits } from 'discord-api-types/v10';
import { evaluateRoleHierarchyHealth } from '../doctor/discord-health.js';

export type DoctorCommandDependencies = Readonly<{
  checkDatabase(): Promise<void>;
  checkMigrations(): Promise<void>;
  checkRedis(): Promise<void>;
  guilds: {
    get(guildId: string): Promise<{ id: string; ownerId: string; mode: string } | null>;
  };
  staff: {
    listProfiles(
      guildId: string,
    ): Promise<readonly { id: string; discordRoleId: string; enabled: boolean }[]>;
  };
  discord: {
    getGuildState(guildId: string): Promise<{
      knightRolePosition: number;
      knightPermissions: bigint;
      roles: readonly { roleId: string; position: number; permissions: bigint }[];
    }>;
  };
  appUrl: string;
}>;

function hasPermission(value: bigint, permission: bigint): boolean {
  return (value & permission) === permission;
}

function safeDashboardUrl(appUrl: string, guildId: string): string {
  try {
    const base = new URL(appUrl);
    base.username = '';
    base.password = '';
    base.search = '';
    base.hash = '';
    const url = new URL(`/guilds/${guildId}`, base);
    return url.toString().replace(/\/$/, '');
  } catch {
    return 'unavailable';
  }
}

async function status(probe: () => Promise<void>): Promise<'ok' | 'error'> {
  try {
    await probe();
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function executeDoctorCommand(
  input: Readonly<{ guildId: string }>,
  dependencies: DoctorCommandDependencies,
): Promise<Readonly<{ content: string }>> {
  const [database, migrations, redis, guildResult, profilesResult, discordResult] =
    await Promise.all([
      status(dependencies.checkDatabase),
      status(dependencies.checkMigrations),
      status(dependencies.checkRedis),
      dependencies.guilds.get(input.guildId).catch(() => null),
      dependencies.staff.listProfiles(input.guildId).catch(() => null),
      dependencies.discord.getGuildState(input.guildId).catch(() => null),
    ]);

  const enabledProfiles = profilesResult?.filter((profile) => profile.enabled) ?? [];
  const mappedRoles = enabledProfiles
    .map((profile) => discordResult?.roles.find((role) => role.roleId === profile.discordRoleId))
    .filter((role): role is NonNullable<typeof role> => role !== undefined);
  const mappedRolesComplete = mappedRoles.length === enabledProfiles.length;
  const hierarchy = discordResult
    ? evaluateRoleHierarchyHealth({
        knightRolePosition: discordResult.knightRolePosition,
        managedStaffRolePositions: mappedRoles.map((role) => role.position),
      })
    : null;
  const hierarchyHealthy = hierarchy !== null && mappedRolesComplete && hierarchy.healthy;

  const permission = (flag: bigint): string =>
    discordResult !== null && hasPermission(discordResult.knightPermissions, flag) ? 'yes' : 'no';

  const lines = [
    'Knight doctor',
    `Discord: ${discordResult === null ? 'error' : 'ok'}`,
    `Database: ${database}`,
    `Migrations: ${migrations}`,
    `Redis: ${redis}`,
    `Guild: ${guildResult === null ? 'unavailable' : 'configured'}`,
    `View Audit Log: ${permission(PermissionFlagsBits.ViewAuditLog)}`,
    `Ban Members: ${permission(PermissionFlagsBits.BanMembers)}`,
    `Manage Roles: ${permission(PermissionFlagsBits.ManageRoles)}`,
    `Role hierarchy: ${hierarchyHealthy ? 'healthy' : 'needs attention'}`,
    `Mapped staff roles: ${enabledProfiles.length}; found in Discord: ${mappedRoles.length}`,
    `Setup mode: ${guildResult?.mode ?? 'unavailable'}`,
    `Dashboard: ${safeDashboardUrl(dependencies.appUrl, input.guildId)}`,
  ];

  return { content: lines.join('\n') };
}
