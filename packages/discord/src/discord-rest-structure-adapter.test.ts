import { ChannelType, Routes } from 'discord-api-types/v10';
import { describe, expect, it, vi } from 'vitest';
import { DiscordRestStructureAdapter } from './discord-rest-structure-adapter.js';

describe('DiscordRestStructureAdapter', () => {
  it('captures structural roles plus category/text channels with normalized overwrites', async () => {
    const get = vi.fn().mockImplementation(async (route: string) => {
      if (route === Routes.guildRoles('100')) {
        return [
          { id: '100', name: '@everyone', managed: false, permissions: '1', position: 0, color: 0, hoist: false, mentionable: false },
          { id: 'staff', name: 'Staff', managed: false, permissions: '8', position: 4, color: 123, hoist: true, mentionable: true },
          { id: 'managed', name: 'Integration', managed: true, permissions: '16', position: 3, color: 0, hoist: false, mentionable: false },
        ];
      }
      if (route === Routes.guildChannels('100')) {
        return [
          { id: 'cat', name: 'Ops', type: ChannelType.GuildCategory, parent_id: null, position: 1, permission_overwrites: [] },
          {
            id: 'text', name: 'security', type: ChannelType.GuildText, parent_id: 'cat', position: 2,
            permission_overwrites: [
              { id: 'staff', type: 0, allow: '1024', deny: '0' },
              { id: 'user', type: 1, allow: '0', deny: '2048' },
            ],
          },
          { id: 'voice', name: 'voice', type: ChannelType.GuildVoice, parent_id: null, position: 3, permission_overwrites: [] },
          { id: 'news', name: 'news', type: ChannelType.GuildAnnouncement, parent_id: null, position: 4, permission_overwrites: [] },
        ];
      }
      throw new Error(`unexpected route ${route}`);
    });
    const adapter = new DiscordRestStructureAdapter({ get, post: vi.fn(), patch: vi.fn() });

    await expect(adapter.captureGuild('100')).resolves.toEqual({
      guildId: '100',
      roles: [
        { id: '100', name: '@everyone', managed: false, permissions: '1', position: 0, color: 0, hoist: false, mentionable: false },
        { id: 'staff', name: 'Staff', managed: false, permissions: '8', position: 4, color: 123, hoist: true, mentionable: true },
        { id: 'managed', name: 'Integration', managed: true, permissions: '16', position: 3, color: 0, hoist: false, mentionable: false },
      ],
      channels: [
        { id: 'cat', name: 'Ops', type: 'CATEGORY', parentId: null, position: 1, permissionOverwrites: [] },
        {
          id: 'text', name: 'security', type: 'TEXT', parentId: 'cat', position: 2,
          permissionOverwrites: [
            { id: 'staff', type: 'ROLE', allow: '1024', deny: '0' },
            { id: 'user', type: 'MEMBER', allow: '0', deny: '2048' },
          ],
        },
      ],
    });
  });

  it('writes roles and role ordering through only the required REST routes', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'new-role' });
    const patch = vi.fn().mockResolvedValue({});
    const adapter = new DiscordRestStructureAdapter({ get: vi.fn(), post, patch });
    const role = { id: 'old-role', name: 'Moderator', managed: false, permissions: '64', position: 5, color: 42, hoist: true, mentionable: false } as const;

    await expect(adapter.createRole('100', role, 'recovery job r1')).resolves.toEqual({ id: 'new-role' });
    await adapter.updateRole('100', 'survivor', role, 'recovery job r1');
    await adapter.setRolePositions('100', [{ id: 'survivor', position: 5 }], 'recovery job r1');

    expect(post).toHaveBeenCalledWith(Routes.guildRoles('100'), {
      body: { name: 'Moderator', permissions: '64', color: 42, hoist: true, mentionable: false },
      reason: 'recovery job r1',
    });
    expect(patch).toHaveBeenNthCalledWith(1, Routes.guildRole('100', 'survivor'), {
      body: { name: 'Moderator', permissions: '64', color: 42, hoist: true, mentionable: false },
      reason: 'recovery job r1',
    });
    expect(patch).toHaveBeenNthCalledWith(2, Routes.guildRoles('100'), {
      body: [{ id: 'survivor', position: 5 }],
      reason: 'recovery job r1',
    });
  });

  it('writes channels, ordering, and normalized permission overwrites with reasons', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'new-channel' });
    const patch = vi.fn().mockResolvedValue({});
    const adapter = new DiscordRestStructureAdapter({ get: vi.fn(), post, patch });
    const channel = { id: 'old-channel', name: 'security', type: 'TEXT', parentId: 'cat', position: 7, permissionOverwrites: [] } as const;

    await expect(adapter.createChannel('100', channel, 'recovery job r2')).resolves.toEqual({ id: 'new-channel' });
    await adapter.updateChannel('survivor', channel, 'recovery job r2');
    await adapter.setChannelPositions('100', [{ id: 'survivor', position: 7, parentId: 'cat' }], 'recovery job r2');
    await adapter.setChannelPermissionOverwrites(
      'survivor',
      [{ id: 'role', type: 'ROLE', allow: '1024', deny: '2048' }],
      'recovery job r2',
    );

    expect(post).toHaveBeenCalledWith(Routes.guildChannels('100'), {
      body: { name: 'security', type: ChannelType.GuildText, parent_id: 'cat' },
      reason: 'recovery job r2',
    });
    expect(patch).toHaveBeenNthCalledWith(1, Routes.channel('survivor'), {
      body: { name: 'security', parent_id: 'cat' },
      reason: 'recovery job r2',
    });
    expect(patch).toHaveBeenNthCalledWith(2, Routes.guildChannels('100'), {
      body: [{ id: 'survivor', position: 7, parent_id: 'cat' }],
      reason: 'recovery job r2',
    });
    expect(patch).toHaveBeenNthCalledWith(3, Routes.channel('survivor'), {
      body: { permission_overwrites: [{ id: 'role', type: 0, allow: '1024', deny: '2048' }] },
      reason: 'recovery job r2',
    });
  });

  it('fetches selected-channel message evidence newest-first with bounded pagination', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: String(200 - index), author: { id: `u-${index}` }, timestamp: '2026-09-12T10:00:00.000Z', content: `m-${index}`,
      attachments: [{ id: `a-${index}`, filename: 'evidence.txt', size: 12, url: 'https://cdn.example/evidence.txt', content_type: 'text/plain' }],
    }));
    const secondPage = [{ id: '100', author: { id: 'u-100' }, timestamp: '2026-09-12T09:00:00.000Z', content: 'older', attachments: [] }];
    const get = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
    const adapter = new DiscordRestStructureAdapter({ get, post: vi.fn(), patch: vi.fn() });

    const messages = await adapter.fetchChannelMessages('selected', 101);

    expect(messages).toHaveLength(101);
    expect(messages[0]).toEqual({
      id: '200', authorId: 'u-0', timestamp: '2026-09-12T10:00:00.000Z', content: 'm-0',
      attachments: [{ id: 'a-0', filename: 'evidence.txt', size: 12, url: 'https://cdn.example/evidence.txt', contentType: 'text/plain' }],
    });
    expect(get).toHaveBeenNthCalledWith(1, Routes.channelMessages('selected'), {
      query: new URLSearchParams({ limit: '100' }),
    });
    expect(get).toHaveBeenNthCalledWith(2, Routes.channelMessages('selected'), {
      query: new URLSearchParams({ limit: '1', before: '101' }),
    });
  });
});
