import { PolicyDecision, type SecurityDecision } from '@knight/contracts';
import { MessageFlags, type Interaction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { MemberBanCommandDependencies } from './member/ban.js';
import { routeInteraction } from './router.js';

const denied: SecurityDecision = {
  decision: PolicyDecision.Deny,
  code: 'PERMISSION_MISSING',
  reason: 'Missing permission.',
  policyVersionId: null,
  metadata: {},
};

function makeBanDependencies(): MemberBanCommandDependencies {
  return {
    authorize: vi.fn().mockResolvedValue(denied),
    staffProfiles: { getEffectiveProfile: vi.fn().mockResolvedValue(null) },
    rateLimits: { consume: vi.fn() },
    decisions: { record: vi.fn() },
    correlations: { create: vi.fn() },
    discord: {
      getGuildState: vi.fn(),
      getMemberState: vi.fn(),
      banMember: vi.fn(),
    },
    createCorrelationId: vi.fn(() => 'corr-1'),
  };
}

function fakeMemberBanInteraction() {
  const reply = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'member',
    guildId: '100',
    user: { id: '42' },
    client: { user: { id: '999' } },
    options: {
      getSubcommand: () => 'ban',
      getUser: () => ({ id: '77' }),
      getString: () => 'Scam links',
    },
    reply,
  } as unknown as Interaction;
  return { interaction, reply };
}

describe('routeInteraction', () => {
  it('routes /member ban into the guarded command and replies ephemerally', async () => {
    const memberBan = makeBanDependencies();
    const { interaction, reply } = fakeMemberBanInteraction();

    await routeInteraction(interaction, { memberBan, now: () => 12_345 });
    expect(memberBan.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: '100',
        actorUserId: '42',
        targetId: '77',
        action: 'member.ban',
        nowMs: 12_345,
      }),
      expect.any(Object),
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('member.ban'),
        flags: MessageFlags.Ephemeral,
      }),
    );
  });

  it('ignores non-chat-input interactions', async () => {
    const memberBan = makeBanDependencies();
    const interaction = { isChatInputCommand: () => false } as unknown as Interaction;

    await routeInteraction(interaction, { memberBan, now: () => 12_345 });

    expect(memberBan.authorize).not.toHaveBeenCalled();
  });
});
