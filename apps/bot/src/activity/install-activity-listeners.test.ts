import { AuditLogEvent, Events } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { findMessageDeleteAttribution, installActivityListeners } from './install-activity-listeners.js';

describe('activity listeners', () => {
  it('installs separate message deletion and voice listeners', () => {
    const on = vi.fn();
    installActivityListeners({ on, user: { id: 'knight' } } as never, { recordMessageDelete: vi.fn(), recordBulkMessageDelete: vi.fn(), recordVoiceTransition: vi.fn() });
    expect(on.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([Events.MessageDelete, Events.MessageBulkDelete, Events.VoiceStateUpdate]));
  });

  it('accepts only a strict single-delete audit match', async () => {
    const entry = {
      id: 'audit-1', action: AuditLogEvent.MessageDelete, targetId: 'author-1', executorId: 'mod-1',
      createdTimestamp: 10_000, extra: { channel: { id: 'channel-1' }, count: 1 },
    };
    const guild = { fetchAuditLogs: vi.fn().mockResolvedValue({ entries: new Map([['audit-1', entry]]) }) };
    await expect(findMessageDeleteAttribution(guild as never, { channelId: 'channel-1', authorUserId: 'author-1', count: 1, occurredAtMs: 10_500, bulk: false })).resolves.toEqual({ actorUserId: 'mod-1', auditLogId: 'audit-1' });
    await expect(findMessageDeleteAttribution(guild as never, { channelId: 'other', authorUserId: 'author-1', count: 1, occurredAtMs: 10_500, bulk: false })).resolves.toBeNull();
  });

  it('requires exact channel and count for bulk-delete attribution', async () => {
    const entry = {
      id: 'audit-2', action: AuditLogEvent.MessageBulkDelete, targetId: 'channel-1', executorId: 'mod-1',
      createdTimestamp: 10_000, extra: { channel: { id: 'channel-1' }, count: 3 },
    };
    const guild = { fetchAuditLogs: vi.fn().mockResolvedValue({ entries: new Map([['audit-2', entry]]) }) };
    await expect(findMessageDeleteAttribution(guild as never, { channelId: 'channel-1', authorUserId: null, count: 2, occurredAtMs: 10_500, bulk: true })).resolves.toBeNull();
  });
});
