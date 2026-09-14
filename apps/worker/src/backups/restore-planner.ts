import type {
  DiscordStructuralChannel,
  DiscordStructuralPermissionOverwrite,
  DiscordStructuralRole,
  DiscordStructuralSnapshot,
  KnightLoggingRecoveryReference,
  KnightProtectedResourceRecoveryReference,
  KnightStaffProfileRecoveryReference,
  StructuralBackupPayload,
} from '@knight/contracts';

export type RestoreClassification =
  | 'REVERT'
  | 'RECREATE'
  | 'ARCHIVE_ONLY'
  | 'NOT_RECOVERABLE';

type RoleOperation = Readonly<{
  kind: 'ROLE';
  classification: 'REVERT' | 'RECREATE' | 'NOT_RECOVERABLE';
  sourceId: string;
  role: DiscordStructuralRole;
}>;

type RoleOrderOperation = Readonly<{
  kind: 'ROLE_ORDER';
  classification: 'REVERT';
  roles: readonly Readonly<{ sourceId: string; position: number }>[];
}>;

type ChannelOperation = Readonly<{
  kind: 'CATEGORY' | 'CHANNEL';
  classification: 'REVERT' | 'RECREATE';
  sourceId: string;
  channel: DiscordStructuralChannel;
}>;

type ChannelOrderOperation = Readonly<{
  kind: 'CHANNEL_ORDER';
  classification: 'REVERT';
  channels: readonly Readonly<{
    sourceId: string;
    position: number;
    parentId: string | null;
  }>[];
}>;

type OverwriteOperation = Readonly<{
  kind: 'OVERWRITES';
  classification: 'REVERT';
  sourceChannelId: string;
  overwrites: readonly DiscordStructuralPermissionOverwrite[];
}>;

type StaffProfileOperation = Readonly<{
  kind: 'KNIGHT_STAFF_PROFILE';
  classification: 'REVERT';
  reference: KnightStaffProfileRecoveryReference;
}>;

type LoggingOperation = Readonly<{
  kind: 'KNIGHT_LOGGING';
  classification: 'REVERT';
  reference: KnightLoggingRecoveryReference;
}>;

type ProtectedResourceOperation = Readonly<{
  kind: 'KNIGHT_PROTECTED_RESOURCE';
  classification: 'REVERT';
  reference: KnightProtectedResourceRecoveryReference;
}>;

type MessageArchiveOperation = Readonly<{
  kind: 'MESSAGE_ARCHIVE';
  classification: 'ARCHIVE_ONLY';
  sourceChannelId: string;
  messageCount: number;
}>;

export type RestoreOperation =
  | RoleOperation
  | RoleOrderOperation
  | ChannelOperation
  | ChannelOrderOperation
  | OverwriteOperation
  | StaffProfileOperation
  | LoggingOperation
  | ProtectedResourceOperation
  | MessageArchiveOperation;

export type RestorePreview = Readonly<{
  guildId: string;
  backupCreatedAt: string;
  operations: readonly RestoreOperation[];
}>;

function roleNeedsRevert(backup: DiscordStructuralRole, current: DiscordStructuralRole): boolean {
  return (
    backup.name !== current.name ||
    backup.permissions !== current.permissions ||
    backup.color !== current.color ||
    backup.hoist !== current.hoist ||
    backup.mentionable !== current.mentionable
  );
}

function channelNeedsRevert(
  backup: DiscordStructuralChannel,
  current: DiscordStructuralChannel,
): boolean {
  return (
    backup.name !== current.name ||
    backup.type !== current.type ||
    backup.parentId !== current.parentId
  );
}

function overwritesEqual(
  left: readonly DiscordStructuralPermissionOverwrite[],
  right: readonly DiscordStructuralPermissionOverwrite[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function roleOrderNeeded(
  backup: readonly DiscordStructuralRole[],
  current: ReadonlyMap<string, DiscordStructuralRole>,
): boolean {
  return backup.some((role) => {
    if (role.managed) return false;
    const existing = current.get(role.id);
    return existing === undefined || existing.position !== role.position;
  });
}
function channelOrderNeeded(
  backup: readonly DiscordStructuralChannel[],
  current: ReadonlyMap<string, DiscordStructuralChannel>,
): boolean {
  return backup.some((channel) => {
    const existing = current.get(channel.id);
    return (
      existing === undefined ||
      existing.position !== channel.position ||
      existing.parentId !== channel.parentId
    );
  });
}

function mapById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function planRestore(
  snapshot: StructuralBackupPayload,
  current: DiscordStructuralSnapshot,
): RestorePreview {
  if (snapshot.guildId !== current.guildId || snapshot.discord.guildId !== current.guildId) {
    throw new Error('Backup guild does not match current Discord guild');
  }

  const currentRoles = mapById(current.roles);
  const currentChannels = mapById(current.channels);
  const operations: RestoreOperation[] = [];
  const recreatedRoleIds = new Set<string>();
  const unrecoverableManagedRoleIds = new Set<string>();
  const recreatedChannelIds = new Set<string>();
  for (const role of snapshot.discord.roles) {
    const existing = currentRoles.get(role.id);
    if (existing === undefined) {
      const classification = role.managed ? 'NOT_RECOVERABLE' : 'RECREATE';
      operations.push({ kind: 'ROLE', classification, sourceId: role.id, role });
      if (role.managed) unrecoverableManagedRoleIds.add(role.id);
      else recreatedRoleIds.add(role.id);
      continue;
    }
    if (!role.managed && roleNeedsRevert(role, existing)) {
      operations.push({ kind: 'ROLE', classification: 'REVERT', sourceId: role.id, role });
    }
  }

  if (roleOrderNeeded(snapshot.discord.roles, currentRoles)) {
    operations.push({
      kind: 'ROLE_ORDER',
      classification: 'REVERT',
      roles: snapshot.discord.roles
        .filter((role) => !role.managed)
        .map((role) => ({ sourceId: role.id, position: role.position })),
    });
  }

  const categories = snapshot.discord.channels.filter((channel) => channel.type === 'CATEGORY');
  const textChannels = snapshot.discord.channels.filter((channel) => channel.type === 'TEXT');
  const addChannelOperations = (
    channels: readonly DiscordStructuralChannel[],
    kind: 'CATEGORY' | 'CHANNEL',
  ): void => {
    for (const channel of channels) {
      const existing = currentChannels.get(channel.id);
      if (existing === undefined) {
        operations.push({ kind, classification: 'RECREATE', sourceId: channel.id, channel });
        recreatedChannelIds.add(channel.id);
      } else if (channelNeedsRevert(channel, existing)) {
        operations.push({ kind, classification: 'REVERT', sourceId: channel.id, channel });
      }
    }
  };

  addChannelOperations(categories, 'CATEGORY');
  addChannelOperations(textChannels, 'CHANNEL');

  if (channelOrderNeeded(snapshot.discord.channels, currentChannels)) {
    operations.push({
      kind: 'CHANNEL_ORDER',
      classification: 'REVERT',
      channels: snapshot.discord.channels.map((channel) => ({
        sourceId: channel.id,
        position: channel.position,
        parentId: channel.parentId,
      })),
    });
  }
  for (const channel of snapshot.discord.channels) {
    const existing = currentChannels.get(channel.id);
    const recoverableOverwrites = channel.permissionOverwrites.filter(
      (overwrite) =>
        overwrite.type !== 'ROLE' || !unrecoverableManagedRoleIds.has(overwrite.id),
    );
    if (
      existing === undefined ||
      !overwritesEqual(recoverableOverwrites, existing.permissionOverwrites)
    ) {
      operations.push({
        kind: 'OVERWRITES',
        classification: 'REVERT',
        sourceChannelId: channel.id,
        overwrites: recoverableOverwrites,
      });
    }
  }

  for (const reference of snapshot.knight.staffProfiles) {
    if (recreatedRoleIds.has(reference.discordRoleId)) {
      operations.push({ kind: 'KNIGHT_STAFF_PROFILE', classification: 'REVERT', reference });
    }
  }

  if (
    snapshot.knight.logging !== null &&
    [snapshot.knight.logging.securityChannelId, snapshot.knight.logging.moderationChannelId,
      snapshot.knight.logging.messageChannelId ?? null, snapshot.knight.logging.voiceChannelId ?? null]
      .some((channelId) => channelId !== null && recreatedChannelIds.has(channelId))
  ) {
    operations.push({
      kind: 'KNIGHT_LOGGING', classification: 'REVERT',
      reference: {
        ...snapshot.knight.logging,
        messageChannelId: snapshot.knight.logging.messageChannelId ?? null,
        voiceChannelId: snapshot.knight.logging.voiceChannelId ?? null,
      },
    });
  }
  for (const reference of snapshot.knight.protectedResources) {
    const needsRemap =
      (reference.resourceType === 'ROLE' && recreatedRoleIds.has(reference.resourceId)) ||
      (reference.resourceType === 'CHANNEL' && recreatedChannelIds.has(reference.resourceId));
    if (needsRemap) {
      operations.push({ kind: 'KNIGHT_PROTECTED_RESOURCE', classification: 'REVERT', reference });
    }
  }

  for (const archive of snapshot.messageArchives) {
    operations.push({
      kind: 'MESSAGE_ARCHIVE',
      classification: 'ARCHIVE_ONLY',
      sourceChannelId: archive.channelId,
      messageCount: archive.messages.length,
    });
  }

  return {
    guildId: snapshot.guildId,
    backupCreatedAt: snapshot.createdAt,
    operations,
  };
}
