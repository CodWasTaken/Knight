import type {
  DiscordStructuralChannel,
  DiscordStructuralRole,
  StructuralBackupPayload,
} from '@knight/contracts';
import { describe, expect, it } from 'vitest';
import { planRestore } from './restore-planner.js';

function role(overrides: Partial<DiscordStructuralRole> = {}): DiscordStructuralRole {
  return {
    id: 'role-1', name: 'Staff', managed: false, permissions: '8', position: 2,
    color: 0, hoist: false, mentionable: false, ...overrides,
  };
}

function channel(overrides: Partial<DiscordStructuralChannel> = {}): DiscordStructuralChannel {
  return {
    id: 'channel-1', name: 'general', type: 'TEXT', parentId: null, position: 1,
    permissionOverwrites: [], ...overrides,
  };
}

function snapshot(overrides: Partial<StructuralBackupPayload> = {}): StructuralBackupPayload {
  return {
    version: 1,
    guildId: '100',
    createdAt: '2026-09-12T10:00:00.000Z',
    discord: { guildId: '100', roles: [role()], channels: [channel()] },
    knight: { staffProfiles: [], logging: null, protectedResources: [] },
    messageArchives: [],
    ...overrides,
  };
}

describe('planRestore', () => {
  it('classifies changed surviving roles and channels as REVERT', () => {
    const backup = snapshot();
    const current = {
      guildId: '100',
      roles: [role({ name: 'Changed' })],
      channels: [channel({ name: 'changed-general' })],
    };

    const preview = planRestore(backup, current);

    expect(preview.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ROLE', sourceId: 'role-1', classification: 'REVERT' }),
      expect.objectContaining({ kind: 'CHANNEL', sourceId: 'channel-1', classification: 'REVERT' }),
    ]));
  });

  it('classifies missing non-managed roles and channels as RECREATE', () => {
    const backup = snapshot({
      discord: {
        guildId: '100',
        roles: [role({ id: 'role-missing' })],
        channels: [
          channel({ id: 'category-missing', type: 'CATEGORY', name: 'Staff', position: 0 }),
          channel({ id: 'channel-missing', parentId: 'category-missing' }),
        ],
      },
    });

    const preview = planRestore(backup, { guildId: '100', roles: [], channels: [] });
    expect(preview.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ROLE', sourceId: 'role-missing', classification: 'RECREATE' }),
      expect.objectContaining({ kind: 'CATEGORY', sourceId: 'category-missing', classification: 'RECREATE' }),
      expect.objectContaining({ kind: 'CHANNEL', sourceId: 'channel-missing', classification: 'RECREATE' }),
    ]));
  });

  it('never recreates a missing managed role', () => {
    const backup = snapshot({
      discord: {
        guildId: '100',
        roles: [role({ id: 'managed-role', managed: true })],
        channels: [],
      },
    });

    const preview = planRestore(backup, { guildId: '100', roles: [], channels: [] });
    expect(preview.operations).toContainEqual(expect.objectContaining({
      kind: 'ROLE', sourceId: 'managed-role', classification: 'NOT_RECOVERABLE',
    }));
  });

  it('marks archived messages as evidence-only ARCHIVE_ONLY operations', () => {
    const backup = snapshot({
      messageArchives: [{
        channelId: 'channel-1',
        messages: [{
          id: 'message-1', authorId: 'user-1', timestamp: '2026-09-12T09:00:00.000Z',
          content: 'evidence', attachments: [],
        }],
      }],
    });

    const preview = planRestore(backup, backup.discord);
    expect(preview.operations).toContainEqual(expect.objectContaining({
      kind: 'MESSAGE_ARCHIVE', sourceChannelId: 'channel-1', classification: 'ARCHIVE_ONLY',
    }));
  });

  it('orders dependencies and keeps old IDs available for execution remapping', () => {
    const backup = snapshot({
      discord: {
        guildId: '100',
        roles: [role({ id: 'old-role' })],
        channels: [
          channel({ id: 'old-category', type: 'CATEGORY', name: 'Staff', position: 0 }),
          channel({
            id: 'old-channel', parentId: 'old-category', position: 1,
            permissionOverwrites: [{ id: 'old-role', type: 'ROLE', allow: '8', deny: '0' }],
          }),
        ],
      },
      knight: {
        staffProfiles: [{ profileId: 'profile-1', discordRoleId: 'old-role', profileVersionId: 'v1' }],
        logging: { securityChannelId: 'old-channel', moderationChannelId: null },
        protectedResources: [{ resourceType: 'CHANNEL', resourceId: 'old-channel', level: 'CRITICAL' }],
      },
    });

    const preview = planRestore(backup, { guildId: '100', roles: [], channels: [] });
    const kinds = preview.operations.map((operation) => operation.kind);
    expect(kinds.indexOf('ROLE')).toBeLessThan(kinds.indexOf('ROLE_ORDER'));
    expect(kinds.indexOf('ROLE_ORDER')).toBeLessThan(kinds.indexOf('CATEGORY'));
    expect(kinds.indexOf('CATEGORY')).toBeLessThan(kinds.indexOf('CHANNEL'));
    expect(kinds.indexOf('CHANNEL')).toBeLessThan(kinds.indexOf('CHANNEL_ORDER'));
    expect(kinds.indexOf('CHANNEL_ORDER')).toBeLessThan(kinds.indexOf('OVERWRITES'));
    expect(kinds.indexOf('OVERWRITES')).toBeLessThan(kinds.indexOf('KNIGHT_STAFF_PROFILE'));

    expect(preview.operations).toContainEqual(expect.objectContaining({
      kind: 'CHANNEL', sourceId: 'old-channel', channel: expect.objectContaining({ parentId: 'old-category' }),
    }));
    expect(preview.operations).toContainEqual(expect.objectContaining({
      kind: 'OVERWRITES', sourceChannelId: 'old-channel',
      overwrites: [expect.objectContaining({ id: 'old-role', type: 'ROLE' })],
    }));
  });
});