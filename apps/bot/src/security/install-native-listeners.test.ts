import { AuditLogEvent, Collection, Events } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { findAuditAttribution, installNativeListeners } from './install-native-listeners.js';

describe('native Discord listeners', () => {
  it('accepts only a recent audit entry for the exact target', async () => {
    const matching = {
      id: 'audit-1',
      targetId: 'role-1',
      executorId: 'staff-1',
      createdTimestamp: 10_000,
    };
    const guild = {
      fetchAuditLogs: vi.fn().mockResolvedValue({
        entries: new Collection([
          ['wrong-target', { ...matching, id: 'wrong-target', targetId: 'role-2' }],
          ['too-old', { ...matching, id: 'too-old', createdTimestamp: -10_000 }],
          ['audit-1', matching],
        ]),
      }),
    };

    await expect(
      findAuditAttribution(guild as never, AuditLogEvent.RoleUpdate, 'role-1', 10_500),
    ).resolves.toEqual({ actorUserId: 'staff-1', auditLogId: 'audit-1' });
  });

  it('returns unknown attribution when audit lookup fails', async () => {
    const guild = { fetchAuditLogs: vi.fn().mockRejectedValue(new Error('missing access')) };
    await expect(
      findAuditAttribution(guild as never, AuditLogEvent.RoleDelete, 'role-1', 10_000),
    ).resolves.toBeNull();
  });

  it('registers only the approved first-pass Gateway events', () => {
    const registered: string[] = [];
    const client = {
      user: { id: 'bot-1' },
      on: vi.fn((event: string) => registered.push(event)),
    };

    installNativeListeners(client as never, { record: vi.fn() });

    expect(registered).toEqual([
      Events.GuildRoleCreate,
      Events.GuildRoleUpdate,
      Events.GuildRoleDelete,
      Events.ChannelCreate,
      Events.ChannelUpdate,
      Events.ChannelDelete,
      Events.GuildBanAdd,
      Events.GuildBanRemove,
      Events.GuildMemberAdd,
      Events.WebhooksUpdate,
    ]);
  });
});
