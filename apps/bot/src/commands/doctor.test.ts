import { PermissionFlagsBits } from 'discord-api-types/v10';
import { describe, expect, it, vi } from 'vitest';
import { executeDoctorCommand } from './doctor.js';

function makeDependencies() {
  return {
    checkDatabase: vi.fn().mockResolvedValue(undefined),
    checkMigrations: vi.fn().mockResolvedValue(undefined),
    checkRedis: vi.fn().mockResolvedValue(undefined),
    guilds: {
      get: vi.fn().mockResolvedValue({ id: '100', ownerId: 'owner', mode: 'TEST' }),
    },
    staff: {
      listProfiles: vi
        .fn()
        .mockResolvedValue([{ id: 'profile-1', discordRoleId: 'role-1', enabled: true }]),
    },
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100',
        ownerId: 'owner',
        knightUserId: 'knight',
        knightRolePosition: 50,
        knightPermissions:
          PermissionFlagsBits.ViewAuditLog |
          PermissionFlagsBits.BanMembers |
          PermissionFlagsBits.ManageRoles,
        roles: [{ roleId: 'role-1', position: 20, permissions: 0n }],
      }),
    },
    appUrl: 'https://knight.example.com',
  };
}

describe('executeDoctorCommand', () => {
  it('reports live service, capability, hierarchy, setup, and dashboard state', async () => {
    const result = await executeDoctorCommand({ guildId: '100' }, makeDependencies());

    expect(result.content).toContain('Discord: ok');
    expect(result.content).toContain('Database: ok');
    expect(result.content).toContain('Migrations: ok');
    expect(result.content).toContain('Redis: ok');
    expect(result.content).toContain('View Audit Log: yes');
    expect(result.content).toContain('Ban Members: yes');
    expect(result.content).toContain('Manage Roles: yes');
    expect(result.content).toContain('Role hierarchy: healthy');
    expect(result.content).toContain('Setup mode: TEST');
    expect(result.content).toContain('https://knight.example.com/guilds/100');
  });

  it('redacts raw failures and credentialed dashboard URL data', async () => {
    const deps = makeDependencies();
    deps.checkDatabase.mockRejectedValue(new Error('postgres://user:db-secret@db/knight'));
    deps.checkRedis.mockRejectedValue(new Error('redis://:redis-secret@redis:6379'));
    deps.appUrl = 'https://admin:url-secret@knight.example.com/base?token=query-secret';

    const result = await executeDoctorCommand({ guildId: '100' }, deps);
    expect(result.content).toContain('Database: error');
    expect(result.content).toContain('Redis: error');
    expect(result.content).toContain('https://knight.example.com/guilds/100');
    expect(result.content).not.toMatch(
      /db-secret|redis-secret|url-secret|query-secret|postgres:\/\/|redis:\/\//,
    );
  });
});
