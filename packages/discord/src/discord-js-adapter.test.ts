import { ChannelType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { DiscordJsAdapter } from './discord-js-adapter.js';

function makeAdapter() {
  const timeout = vi.fn().mockResolvedValue(undefined);
  const member = { timeout };
  const members = {
    kick: vi.fn().mockResolvedValue(undefined),
    unban: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(member),
    fetchMe: vi.fn().mockResolvedValue({
      id: 'knight',
      roles: { highest: { position: 50 } },
      permissions: { bitfield: 8n },
    }),
  };
  const roles = new Map([
    [
      '100',
      { id: '100', name: '@everyone', managed: false, position: 0, permissions: { bitfield: 0n } },
    ],
    [
      'staff',
      {
        id: 'staff',
        name: 'Moderator',
        managed: false,
        position: 20,
        permissions: { bitfield: 4n },
      },
    ],
  ]);
  const logSend = vi.fn().mockResolvedValue(undefined);
  const logChannel = {
    id: 'log-1', name: 'security-log', type: ChannelType.GuildText,
    isTextBased: () => true, send: logSend,
    permissionsFor: vi.fn().mockReturnValue({ has: vi.fn().mockReturnValue(true) }),
  };
  const blockedChannel = {
    id: 'blocked-1', name: 'blocked-log', type: ChannelType.GuildText,
    isTextBased: () => true, send: vi.fn(),
    permissionsFor: vi.fn().mockReturnValue({ has: vi.fn().mockReturnValue(false) }),
  };
  const voiceChannel = { id: 'voice-1', name: 'voice', type: ChannelType.GuildVoice };
  const guildChannels = new Map([[logChannel.id, logChannel], [blockedChannel.id, blockedChannel], [voiceChannel.id, voiceChannel]]);
  const guild = {
    id: '100', ownerId: 'owner', members, roles: { fetch: vi.fn().mockResolvedValue(roles) },
    channels: { fetch: vi.fn().mockImplementation(async (id?: string) => id ? guildChannels.get(id) ?? null : guildChannels) },
  };
  const send = vi.fn().mockResolvedValue(undefined);
  const messages = new Map([
    ['m1', { id: 'm1', author: { id: 'u1' }, createdTimestamp: 1_000, bulkDeletable: true }],
    ['m2', { id: 'm2', author: { id: 'u2' }, createdTimestamp: 2_000, bulkDeletable: false }],
  ]);
  const channel = {
    isTextBased: () => true,
    messages: { fetch: vi.fn().mockResolvedValue(messages) },
    bulkDelete: vi.fn().mockResolvedValue(new Map([['m1', {}]])),
  };
  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    users: { fetch: vi.fn().mockResolvedValue({ send }) },
    channels: { fetch: vi.fn().mockImplementation(async (id: string) => id === 'log-1' ? logChannel : channel) },
  };
  return { adapter: new DiscordJsAdapter(client as never), members, member, send, channel, logChannel, logSend };
}

describe('DiscordJsAdapter moderation operations', () => {
  it('uses narrow Discord APIs for kick, timeout, unban, and direct messages', async () => {
    const { adapter, members, member, send } = makeAdapter();

    await adapter.kickMember({ guildId: '100', targetUserId: '77', reason: 'reason' });
    await adapter.timeoutMember({
      guildId: '100',
      targetUserId: '77',
      durationMs: 60_000,
      reason: 'reason',
    });
    await adapter.unbanMember({ guildId: '100', targetUserId: '77', reason: 'reason' });
    await adapter.sendDirectMessage({ userId: '77', content: 'Knight warning' });

    expect(members.kick).toHaveBeenCalledWith('77', 'reason');
    expect(member.timeout).toHaveBeenCalledWith(60_000, 'reason');
    expect(members.unban).toHaveBeenCalledWith('77', 'reason');
    expect(send).toHaveBeenCalledWith('Knight warning');
  });

  it('returns purge-safe message metadata and the deleted count', async () => {
    const { adapter, channel } = makeAdapter();

    expect(await adapter.fetchRecentMessages({ channelId: 'channel-1', limit: 5 })).toEqual([
      { messageId: 'm1', authorUserId: 'u1', createdAtMs: 1_000, bulkDeletable: true },
      { messageId: 'm2', authorUserId: 'u2', createdAtMs: 2_000, bulkDeletable: false },
    ]);
    expect(channel.messages.fetch).toHaveBeenCalledWith({ limit: 5 });
    expect(await adapter.deleteMessages({ channelId: 'channel-1', messageIds: ['m1'] })).toBe(1);
    expect(channel.bulkDelete).toHaveBeenCalledWith(['m1'], true);
  });


  it('lists only supported guild notification channels and checks send permissions', async () => {
    const { adapter } = makeAdapter();

    expect(await adapter.listTextChannels('100')).toEqual([
      { channelId: 'log-1', name: 'security-log' },
      { channelId: 'blocked-1', name: 'blocked-log' },
    ]);
    expect(await adapter.canSendToChannel('100', 'log-1')).toBe(true);
    expect(await adapter.canSendToChannel('100', 'blocked-1')).toBe(false);
    expect(await adapter.canSendToChannel('100', 'missing')).toBe(false);
  });

  it('sends notification text through an existing text channel', async () => {
    const { adapter, logSend } = makeAdapter();
    await adapter.sendChannelMessage('log-1', 'Knight security event');
    expect(logSend).toHaveBeenCalledWith('Knight security event');
  });

  it('exposes Discord role names and managed state', async () => {
    const { adapter } = makeAdapter();
    const guild = await adapter.getGuildState('100');
    expect(guild.roles).toContainEqual({
      roleId: 'staff',
      name: 'Moderator',
      managed: false,
      position: 20,
      permissions: 4n,
    });
  });
});
