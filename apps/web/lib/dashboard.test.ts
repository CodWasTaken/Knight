import { GuildMode } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { loadDashboardGuilds } from './dashboard';

function makeDependencies() {
  return {
    guilds: {
      listAccessibleToUser: vi.fn().mockResolvedValue([
        {
          id: '100',
          ownerId: '1',
          mode: GuildMode.Test,
          setupStep: 'STAFF',
          completedSetupSteps: ['WELCOME', 'HEALTH'],
        },
      ]),
    },
  };
}

describe('loadDashboardGuilds', () => {
  it('uses the authenticated Discord user id to load only Knight-authorized guilds', async () => {
    const deps = makeDependencies();

    const guilds = await loadDashboardGuilds({ user: { id: '42' } }, deps);

    expect(deps.guilds.listAccessibleToUser).toHaveBeenCalledWith('42');
    expect(guilds).toEqual([expect.objectContaining({ id: '100', mode: GuildMode.Test })]);
  });

  it('does not query guild state without an authenticated Discord identity', async () => {
    const deps = makeDependencies();

    await expect(loadDashboardGuilds(null, deps)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(deps.guilds.listAccessibleToUser).not.toHaveBeenCalled();
  });
});
