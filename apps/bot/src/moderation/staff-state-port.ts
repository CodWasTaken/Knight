import type { ActionPolicy, StaffProfileSnapshot } from '@knight/contracts';
import { ProtectionLevel } from '@knight/contracts';
import type { StaffProfileVersionRecord, StaffRepository } from '@knight/database';
import type { SecurityRepository } from '@knight/database';
import type { DiscordActionPort } from '@knight/discord';
import type { StaffStatePort } from '@knight/security';
import { PermissionsBitField } from 'discord.js';

const DISABLED_POLICY: ActionPolicy = { enabled: false, unlimited: false, rateWindows: [] };
const OWNER_POLICY: ActionPolicy = { enabled: true, unlimited: true, rateWindows: [] };

const ELEVATED_DISCORD_PERMISSION_MASK = [
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ModerateMembers,
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.ViewAuditLog,
].reduce((mask, permission) => mask | permission, 0n);

export type ModerationStaffStateDependencies = Readonly<{
  staffProfiles: Pick<StaffRepository, 'getEffectiveProfile'>;
  security: Pick<SecurityRepository, 'getProtectionLevel' | 'getSecurityState'>;
  discord: Pick<DiscordActionPort, 'getGuildState' | 'getMemberState'>;
}>;

function toProfileSnapshot(
  guildId: string,
  profile: StaffProfileVersionRecord | null,
): StaffProfileSnapshot | null {
  if (profile === null) return null;
  if (profile.guildId !== guildId) throw new Error('Cross-guild Staff Profile state');
  return {
    guildId,
    profileId: profile.profileId,
    profileVersionId: profile.id,
    discordRoleId: profile.discordRoleId,
    rank: profile.rank,
    permissions: profile.permissions,
    actionPolicies: profile.actionPolicies,
  };
}

export function hasElevatedDiscordAuthority(permissions: bigint): boolean {
  return (permissions & ELEVATED_DISCORD_PERMISSION_MASK) !== 0n;
}

export function createModerationStaffStatePort(
  dependencies: ModerationStaffStateDependencies,
): StaffStatePort {
  return {
    async getContext(request) {
      const [guild, actorProfileRecord, securityState] = await Promise.all([
        dependencies.discord.getGuildState(request.guildId),
        dependencies.staffProfiles.getEffectiveProfile(request.guildId, request.actorUserId),
        dependencies.security.getSecurityState(request.guildId),
      ]);
      const [targetProfileRecord, targetDiscord, targetProtectionLevel] =
        request.targetId === null
          ? [null, null, ProtectionLevel.Normal]
          : await Promise.all([
              dependencies.staffProfiles.getEffectiveProfile(request.guildId, request.targetId),
              dependencies.discord.getMemberState(request.guildId, request.targetId),
              dependencies.security.getProtectionLevel(request.guildId, 'USER', request.targetId),
            ]);

      const actorProfile = toProfileSnapshot(request.guildId, actorProfileRecord);
      const targetProfile = toProfileSnapshot(request.guildId, targetProfileRecord);
      const actorIsOwner = guild.ownerId === request.actorUserId;
      const target =
        request.targetId === null
          ? null
          : {
              userId: request.targetId,
              isGuildOwner: guild.ownerId === request.targetId,
              knightRank: targetProfile?.rank ?? null,
              elevatedUnregistered:
                targetProfile === null &&
                targetDiscord !== null &&
                hasElevatedDiscordAuthority(targetDiscord.permissions),
              protectionLevel: targetProtectionLevel,
            };
      const actionPolicy = actorIsOwner
        ? OWNER_POLICY
        : (actorProfile?.actionPolicies[request.action] ?? DISABLED_POLICY);

      return {
        action: request.action,
        actor: {
          userId: request.actorUserId,
          isGuildOwner: actorIsOwner,
          profile: actorProfile,
          temporaryGrants: [],
          temporaryRestrictions: [],
        },
        target,
        emergency: {
          mode: securityState.mode,
          lockedScopes: securityState.lockedScopes,
        },
        actionPolicy,
      };
    },
  };
}
