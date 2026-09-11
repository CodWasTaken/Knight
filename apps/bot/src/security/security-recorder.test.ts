import { describe, expect, it, vi } from 'vitest';
import { SecurityRecorder } from './security-recorder.js';

const input = {
  guildId: 'g1',
  severity: 'LOW' as const,
  source: 'KNIGHT',
  action: 'member.warn',
  actorUserId: 'u1',
  targetId: 'u2',
  decisionId: null,
  incidentId: null,
  metadata: {},
};

function makeRecorder(sendRejects = false) {
  const order: string[] = [];
  const record = {
    id: 1,
    guildId: 'g1',
    previousHash: null,
    entryHash: 'hash',
  };
  const ledger = {
    append: vi.fn(async () => {
      order.push('append');
      return record;
    }),
    getLoggingSettings: vi.fn().mockResolvedValue({
      guildId: 'g1',
      securityChannelId: 'security-log',
      moderationChannelId: 'moderation-log',
    }),
  };
  const sendChannelMessage = vi.fn(async () => {
    order.push('send');
    if (sendRejects) throw new Error('Discord unavailable');
  });
  const discord = { sendChannelMessage };
  return {
    recorder: new SecurityRecorder({ ledger: ledger as never, discord: discord as never }),
    ledger,
    sendChannelMessage,
    order,
  };
}

describe('SecurityRecorder', () => {
  it('persists before sending the configured notification', async () => {
    const { recorder, sendChannelMessage, order } = makeRecorder();

    const result = await recorder.record(input, 'SECURITY');

    expect(result.entryHash).toBe('hash');
    expect(order).toEqual(['append', 'send']);
    expect(sendChannelMessage).toHaveBeenCalledWith(
      'security-log',
      expect.stringContaining('member.warn'),
    );
  });
  it('keeps the durable record when Discord notification delivery fails', async () => {
    const { recorder, ledger, sendChannelMessage } = makeRecorder(true);

    await expect(recorder.record(input, 'MODERATION')).resolves.toMatchObject({ entryHash: 'hash' });

    expect(ledger.append).toHaveBeenCalledTimes(1);
    expect(sendChannelMessage).toHaveBeenCalledWith(
      'moderation-log',
      expect.stringContaining('member.warn'),
    );
  });

  it('writes ledger-only entries without reading notification settings', async () => {
    const { recorder, ledger, sendChannelMessage } = makeRecorder();

    await recorder.record(input);

    expect(ledger.append).toHaveBeenCalledTimes(1);
    expect(ledger.getLoggingSettings).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });
});
