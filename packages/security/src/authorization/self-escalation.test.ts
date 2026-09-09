import { describe, expect, it } from 'vitest';
import { type AuthoritySnapshot, wouldIncreaseOwnAuthority } from './self-escalation.js';

const base: AuthoritySnapshot = {
  rank: 20,
  permissions: ['member.ban'],
  actionPolicies: {
    'member.ban': {
      enabled: true,
      unlimited: false,
      rateWindows: [{ max: 2, windowMs: 30 * 60_000 }],
    },
  },
  activeRestrictions: ['message.purge'],
};

function selfChange(before: AuthoritySnapshot, after: AuthoritySnapshot): boolean {
  return wouldIncreaseOwnAuthority({
    actorUserId: '42',
    affectedUserIds: ['42'],
    before,
    after,
  });
}

describe('wouldIncreaseOwnAuthority', () => {
  it('detects self-promotion', () => {
    expect(selfChange(base, { ...base, rank: 30 })).toBe(true);
  });
  it('detects a higher finite action maximum on the same window', () => {
    expect(
      selfChange(base, {
        ...base,
        actionPolicies: {
          'member.ban': {
            enabled: true,
            unlimited: false,
            rateWindows: [{ max: 5, windowMs: 30 * 60_000 }],
          },
        },
      }),
    ).toBe(true);
  });

  it('detects finite to unlimited authority', () => {
    expect(
      selfChange(base, {
        ...base,
        actionPolicies: {
          'member.ban': { enabled: true, unlimited: true, rateWindows: [] },
        },
      }),
    ).toBe(true);
  });

  it('detects removing a finite rate window', () => {
    expect(
      selfChange(base, {
        ...base,
        actionPolicies: {
          'member.ban': { enabled: true, unlimited: false, rateWindows: [] },
        },
      }),
    ).toBe(true);
  });

  it('detects removing a restriction that affects the actor', () => {
    expect(selfChange(base, { ...base, activeRestrictions: [] })).toBe(true);
  });
  it('detects adding a canonical permission', () => {
    expect(
      selfChange(base, {
        ...base,
        permissions: ['member.ban', 'message.purge'],
      }),
    ).toBe(true);
  });

  it('ignores authority increases that do not affect the actor', () => {
    expect(
      wouldIncreaseOwnAuthority({
        actorUserId: '42',
        affectedUserIds: ['77'],
        before: base,
        after: { ...base, rank: 99 },
      }),
    ).toBe(false);
  });
});
