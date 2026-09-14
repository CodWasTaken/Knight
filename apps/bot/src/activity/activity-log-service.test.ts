import { describe, expect, it, vi } from 'vitest';
import { ActivityLogService } from './activity-log-service.js';

function makeService(options: { retain?: boolean; capability?: boolean } = {}) {
  const ledger = { getLoggingSettings: vi.fn().mockResolvedValue({ storeDeletedMessageContent: options.retain ?? false }) };
  const recorder = { record: vi.fn().mockResolvedValue({ id: 1 }) };
  return { service: new ActivityLogService({ ledger, recorder, messageContentAvailable: options.capability ?? false }), recorder };
}

const deleted = {
  guildId: 'g1', channelId: 'c1', messageId: 'm1', authorUserId: 'u1',
  content: 'hello', attachments: [{ id: 'a1', name: 'proof.png', size: 42, contentType: 'image/png' }],
  actorUserId: null, auditLogId: null, occurredAt: new Date('2026-09-14T10:00:00Z'),
};

describe('ActivityLogService', () => {
  it('retains at most 4000 UTF-16 code units only when guild and runtime allow it', async () => {
    const made = makeService({ retain: true, capability: true });
    await made.service.recordMessageDelete({ ...deleted, content: 'x'.repeat(5000) });
    expect(made.recorder.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'message.delete', actorUserId: null,
      metadata: expect.objectContaining({ content: 'x'.repeat(4000), contentStatus: 'AVAILABLE', attachmentCount: 1 }),
    }), 'MESSAGES');
  });

  it.each([
    [false, true, 'DISABLED'], [true, false, 'CAPABILITY_UNAVAILABLE'], [true, true, 'UNAVAILABLE'],
  ] as const)('records metadata with explicit unavailable content semantics', async (retain, capability, status) => {
    const made = makeService({ retain, capability });
    await made.service.recordMessageDelete({ ...deleted, content: status === 'UNAVAILABLE' ? null : deleted.content });
    expect(made.recorder.record).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ channelId: 'c1', messageId: 'm1', authorUserId: 'u1', content: null, contentStatus: status }),
    }), 'MESSAGES');
  });

  it('persists detailed bulk entries ledger-only and emits one summary notification', async () => {
    const made = makeService({ retain: true, capability: true });
    await made.service.recordBulkMessageDelete({ guildId: 'g1', channelId: 'c1', actorUserId: null, auditLogId: null, occurredAt: deleted.occurredAt, messages: [deleted, { ...deleted, messageId: 'm2', content: 'second' }] });
    expect(made.recorder.record).toHaveBeenCalledTimes(3);
    expect(made.recorder.record).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'message.delete' }));
    expect(made.recorder.record).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: 'message.delete' }));
    expect(made.recorder.record).toHaveBeenNthCalledWith(3, expect.objectContaining({ action: 'message.bulk_delete' }), 'MESSAGES');
  });

  it.each([
    [{ channelId: null, serverMute: false, serverDeaf: false }, { channelId: 'a', serverMute: false, serverDeaf: false }, 'voice.join'],
    [{ channelId: 'a', serverMute: false, serverDeaf: false }, { channelId: null, serverMute: false, serverDeaf: false }, 'voice.leave'],
    [{ channelId: 'a', serverMute: false, serverDeaf: false }, { channelId: 'b', serverMute: false, serverDeaf: false }, 'voice.move'],
    [{ channelId: 'a', serverMute: false, serverDeaf: false }, { channelId: 'a', serverMute: true, serverDeaf: false }, 'voice.server_mute'],
    [{ channelId: 'a', serverMute: true, serverDeaf: false }, { channelId: 'a', serverMute: false, serverDeaf: false }, 'voice.server_unmute'],
    [{ channelId: 'a', serverMute: false, serverDeaf: false }, { channelId: 'a', serverMute: false, serverDeaf: true }, 'voice.server_deafen'],
    [{ channelId: 'a', serverMute: false, serverDeaf: true }, { channelId: 'a', serverMute: false, serverDeaf: false }, 'voice.server_undeafen'],
  ] as const)('records supported voice transition %s', async (oldState, newState, action) => {
    const made = makeService();
    await made.service.recordVoiceTransition({ guildId: 'g1', memberUserId: 'u1', oldState, newState, occurredAt: deleted.occurredAt });
    expect(made.recorder.record).toHaveBeenCalledWith(expect.objectContaining({ action, targetId: 'u1' }), 'VOICE');
  });

  it('ignores irrelevant voice state churn', async () => {
    const made = makeService();
    await made.service.recordVoiceTransition({ guildId: 'g1', memberUserId: 'u1', oldState: { channelId: 'a', serverMute: false, serverDeaf: false }, newState: { channelId: 'a', serverMute: false, serverDeaf: false }, occurredAt: deleted.occurredAt });
    expect(made.recorder.record).not.toHaveBeenCalled();
  });
});
