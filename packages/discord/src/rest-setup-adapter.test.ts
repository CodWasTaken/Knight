import { PermissionFlagsBits, Routes } from 'discord-api-types/v10';
import { describe, expect, it, vi } from 'vitest';

const ALL_KNOWN_PERMISSIONS = Object.values(PermissionFlagsBits).reduce(
  (combined, permission) => combined | permission,
  0n,
);
import { DiscordRestSetupAdapter } from './rest-setup-adapter.js';

describe('DiscordRestSetupAdapter', () => {
  it('reads live guild role state and expands Administrator into effective permissions', async () => {
    const get = vi.fn().mockImplementation(async (route: string) => {
      if (route === Routes.user()) return { id: 'knight' };
      if (route === Routes.guild('100')) return { id: '100', owner_id: 'owner' };
      if (route === Routes.guildMember('100', 'knight')) return { roles: ['role-knight'] };
      if (route === Routes.guildRoles('100')) {
        return [
          { id: '100', name: '@everyone', managed: false, position: 0, permissions: '0' },
          {
            id: 'role-knight',
            name: 'Knight',
            managed: true,
            position: 50,
            permissions: PermissionFlagsBits.Administrator.toString(),
          },
          {
            id: 'role-staff',
            name: 'Moderator',
            managed: false,
            position: 20,
            permissions: PermissionFlagsBits.BanMembers.toString(),
          },
        ];
      }
      throw new Error(`unexpected route ${route}`);
    });
    const adapter = new DiscordRestSetupAdapter({ get, patch: vi.fn() });
    const state = await adapter.getGuildState('100');

    expect(state.ownerId).toBe('owner');
    expect(state.knightRolePosition).toBe(50);
    expect(state.knightPermissions).toBe(ALL_KNOWN_PERMISSIONS);
    expect(state.roles).toContainEqual({
      roleId: 'role-staff',
      name: 'Moderator',
      managed: false,
      position: 20,
      permissions: PermissionFlagsBits.BanMembers,
    });
  });

  it('writes exact permission bigint strings with an audit reason', async () => {
    const patch = vi.fn().mockResolvedValue({});
    const adapter = new DiscordRestSetupAdapter({ get: vi.fn(), patch });

    await adapter.setRolePermissions({
      guildId: '100',
      roleId: 'role-staff',
      permissions: 900719925474099312345n,
      reason: 'Knight Guarded migration',
    });

    expect(patch).toHaveBeenCalledWith(Routes.guildRole('100', 'role-staff'), {
      body: { permissions: '900719925474099312345' },
      reason: 'Knight Guarded migration',
    });
  });

  it('adds and removes mapped Discord roles through exact REST routes', async () => {
    const put = vi.fn().mockResolvedValue({});
    const del = vi.fn().mockResolvedValue({});
    const adapter = new DiscordRestSetupAdapter({
      get: vi.fn(),
      patch: vi.fn(),
      put,
      delete: del,
    });

    await adapter.addRole({ guildId: '100', userId: '42', roleId: 'staff', reason: 'sync' });
    await adapter.removeRole({ guildId: '100', userId: '42', roleId: 'staff', reason: 'sync' });

    expect(put).toHaveBeenCalledWith(Routes.guildMemberRole('100', '42', 'staff'), {
      reason: 'sync',
    });
    expect(del).toHaveBeenCalledWith(Routes.guildMemberRole('100', '42', 'staff'), {
      reason: 'sync',
    });
  });

  it('lists text notification channels and validates Knight send permissions', async () => {
    const base = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
    const get = vi.fn().mockImplementation(async (route: string) => {
      if (route === Routes.guildChannels('100'))
        return [
          { id: 'log', guild_id: '100', name: 'security-log', type: 0, permission_overwrites: [] },
          {
            id: 'news',
            guild_id: '100',
            name: 'announcements',
            type: 5,
            permission_overwrites: [],
          },
          { id: 'voice', guild_id: '100', name: 'voice', type: 2, permission_overwrites: [] },
        ];
      if (route === Routes.channel('log'))
        return { id: 'log', guild_id: '100', type: 0, permission_overwrites: [] };
      if (route === Routes.channel('blocked'))
        return {
          id: 'blocked',
          guild_id: '100',
          type: 0,
          permission_overwrites: [
            { id: '100', type: 0, allow: '0', deny: PermissionFlagsBits.SendMessages.toString() },
          ],
        };
      if (route === Routes.user()) return { id: 'knight' };
      if (route === Routes.guildMember('100', 'knight')) return { roles: ['role-knight'] };
      if (route === Routes.guildRoles('100'))
        return [
          { id: '100', name: '@everyone', managed: false, position: 0, permissions: '0' },
          {
            id: 'role-knight',
            name: 'Knight',
            managed: true,
            position: 50,
            permissions: base.toString(),
          },
        ];
      throw new Error(`unexpected route ${route}`);
    });
    const adapter = new DiscordRestSetupAdapter({ get, patch: vi.fn() });

    expect(await adapter.listTextChannels('100')).toEqual([
      { channelId: 'log', name: 'security-log' },
      { channelId: 'news', name: 'announcements' },
    ]);
    expect(await adapter.canSendToChannel('100', 'log')).toBe(true);
    expect(await adapter.canSendToChannel('100', 'blocked')).toBe(false);
  });

  it('validates guild members and guild channels for protected resources', async () => {
    const get = vi.fn().mockImplementation(async (route: string) => {
      if (route === Routes.guild('100')) return { id: '100', owner_id: 'owner' };
      if (route === Routes.guildMember('100', '555')) return { roles: ['staff'] };
      if (route === Routes.guildRoles('100'))
        return [
          { id: '100', name: '@everyone', managed: false, position: 0, permissions: '1' },
          { id: 'staff', name: 'Staff', managed: false, position: 20, permissions: '4' },
        ];
      if (route === Routes.channel('666'))
        return { id: '666', guild_id: '100', name: 'Category', type: 4 };
      if (route === Routes.channel('777'))
        return { id: '777', guild_id: '200', name: 'Elsewhere', type: 0 };
      throw new Error(`unexpected route ${route}`);
    });
    const adapter = new DiscordRestSetupAdapter({ get, patch: vi.fn() });

    await expect(adapter.getMemberState('100', '555')).resolves.toMatchObject({
      userId: '555',
      roleIds: ['staff'],
      highestRolePosition: 20,
      permissions: 5n,
    });
    await expect(adapter.getGuildChannelState('100', '666')).resolves.toEqual({
      channelId: '666',
      name: 'Category',
    });
    await expect(adapter.getGuildChannelState('100', '777')).resolves.toBeNull();
  });

  it('sends channel notifications through the REST API', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const adapter = new DiscordRestSetupAdapter({
      get: vi.fn(),
      patch: vi.fn(),
      post,
    } as never);

    await adapter.sendChannelMessage('security', 'Knight security event');

    expect(post).toHaveBeenCalledWith(Routes.channelMessages('security'), {
      body: { content: 'Knight security event' },
    });
  });
});
