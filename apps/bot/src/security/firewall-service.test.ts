import { describe, expect, it, vi } from 'vitest';
import { FirewallService } from './firewall-service.js';

function dependencies(
  input: {
    botMode?: 'OBSERVE' | 'ALERT' | 'ENFORCE';
    webhookMode?: 'OBSERVE' | 'ALERT' | 'ENFORCE';
    botTrust?: 'UNKNOWN' | 'BLOCKED' | null;
    webhookTrust?: Record<string, 'UNKNOWN' | 'BLOCKED'>;
  } = {},
) {
  const security = {
    getFirewallSettings: vi.fn().mockResolvedValue({
      guildId: 'g1',
      botMode: input.botMode ?? 'OBSERVE',
      webhookMode: input.webhookMode ?? 'OBSERVE',
      configured: true,
    }),
    getBotInventory: vi
      .fn()
      .mockResolvedValue(
        input.botTrust === null || input.botTrust === undefined
          ? null
          : { trustState: input.botTrust },
      ),
    upsertBotInventory: vi.fn().mockResolvedValue({}),
    getWebhookInventory: vi.fn().mockImplementation(async (_guildId, webhookId) => {
      const trustState = input.webhookTrust?.[webhookId];
      return trustState === undefined ? null : { trustState };
    }),
    upsertWebhookInventory: vi.fn().mockResolvedValue({}),
    recordEvent: vi.fn().mockResolvedValue({}),
  };
  return {
    security,
    discord: {
      kickMember: vi.fn().mockResolvedValue(undefined),
      listChannelWebhooks: vi.fn().mockResolvedValue([
        { webhookId: 'blocked-hook', channelId: 'channel-1' },
        { webhookId: 'unknown-hook', channelId: 'channel-1' },
      ]),
      deleteWebhook: vi.fn().mockResolvedValue(undefined),
    },
    recorder: { record: vi.fn().mockResolvedValue({}) },
    now: () => new Date('2026-09-12T10:00:00.000Z'),
  };
}

describe('FirewallService', () => {
  it('observes a new bot without alerting or removing it', async () => {
    const deps = dependencies({ botMode: 'OBSERVE' });

    await expect(new FirewallService(deps).handleBotJoin('g1', 'bot-1')).resolves.toEqual({
      observed: 1,
      removed: 0,
    });

    expect(deps.security.upsertBotInventory).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: 'g1', botUserId: 'bot-1', trustState: 'UNKNOWN' }),
    );
    expect(deps.discord.kickMember).not.toHaveBeenCalled();
    expect(deps.recorder.record).not.toHaveBeenCalled();
  });

  it('alerts for a bot in ALERT mode without removing it', async () => {
    const deps = dependencies({ botMode: 'ALERT' });

    const result = await new FirewallService(deps).handleBotJoin('g1', 'bot-1');

    expect(result).toEqual({ observed: 1, removed: 0 });
    expect(deps.discord.kickMember).not.toHaveBeenCalled();
    expect(deps.recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'firewall.bot.alert', targetId: 'bot-1' }),
      'SECURITY',
    );
  });

  it('removes only an explicitly blocked bot in ENFORCE mode', async () => {
    const blocked = dependencies({ botMode: 'ENFORCE', botTrust: 'BLOCKED' });
    const unknown = dependencies({ botMode: 'ENFORCE', botTrust: 'UNKNOWN' });

    expect(await new FirewallService(blocked).handleBotJoin('g1', 'blocked-bot')).toEqual({
      observed: 1,
      removed: 1,
    });
    expect(await new FirewallService(unknown).handleBotJoin('g1', 'unknown-bot')).toEqual({
      observed: 1,
      removed: 0,
    });

    expect(blocked.security.upsertBotInventory.mock.invocationCallOrder[0]).toBeLessThan(
      blocked.discord.kickMember.mock.invocationCallOrder[0]!,
    );
    expect(blocked.discord.kickMember).toHaveBeenCalledTimes(1);
    expect(unknown.discord.kickMember).not.toHaveBeenCalled();
  });

  it('removes only blocked webhooks and preserves unknown webhooks in ENFORCE mode', async () => {
    const deps = dependencies({
      webhookMode: 'ENFORCE',
      webhookTrust: { 'blocked-hook': 'BLOCKED', 'unknown-hook': 'UNKNOWN' },
    });

    await expect(new FirewallService(deps).handleWebhookUpdate('g1', 'channel-1')).resolves.toEqual(
      {
        observed: 2,
        removed: 1,
      },
    );

    expect(deps.discord.deleteWebhook).toHaveBeenCalledWith(
      'blocked-hook',
      'Explicitly blocked by Knight webhook firewall',
    );
    expect(deps.discord.deleteWebhook).not.toHaveBeenCalledWith('unknown-hook', expect.anything());
    expect(deps.security.upsertWebhookInventory).toHaveBeenCalledTimes(2);
  });

  it('records a failed blocked removal without retrying or throwing', async () => {
    const deps = dependencies({ botMode: 'ENFORCE', botTrust: 'BLOCKED' });
    deps.discord.kickMember.mockRejectedValueOnce(new Error('Discord rejected removal'));

    await expect(new FirewallService(deps).handleBotJoin('g1', 'blocked-bot')).resolves.toEqual({
      observed: 1,
      removed: 0,
    });

    expect(deps.discord.kickMember).toHaveBeenCalledTimes(1);
    expect(deps.recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'firewall.bot.removal_failed', severity: 'HIGH' }),
      'SECURITY',
    );
    expect(deps.security.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'firewall.bot.removal_failed' }),
    );
  });
});
