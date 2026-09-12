import { PolicyDecision, type StaffProfileSnapshot } from '@knight/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateCapability } from './evaluate-capability.js';
import type { AuthorizationContext } from './types.js';

const profile: StaffProfileSnapshot = {
  guildId: '100',
  profileId: 'mod',
  profileVersionId: 'mod-v1',
  discordRoleId: '900',
  rank: 10,
  permissions: ['member.warnings.view'],
  actionPolicies: {},
};

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    action: 'member.warnings.view',
    actor: {
      userId: '42',
      isGuildOwner: false,
      profile,
      temporaryGrants: [],
      temporaryRestrictions: [],
    },
    target: null,
    emergency: { mode: 'NORMAL', lockedScopes: [] },
    ...overrides,
  };
}
describe('evaluateCapability', () => {
  it('allows warning-history access regardless of target rank', () => {
    expect(evaluateCapability(context())).toMatchObject({
      decision: PolicyDecision.Allow,
      code: 'ALLOWED',
    });
  });

  it('denies staff without the explicit warning-history permission', () => {
    expect(
      evaluateCapability(
        context({ actor: { ...context().actor, profile: { ...profile, permissions: [] } } }),
      ),
    ).toMatchObject({ decision: PolicyDecision.Deny, code: 'PERMISSION_MISSING' });
  });

  it('allows the guild owner without a Staff Profile', () => {
    expect(
      evaluateCapability(
        context({ actor: { ...context().actor, isGuildOwner: true, profile: null } }),
      ),
    ).toMatchObject({ decision: PolicyDecision.Allow, code: 'ALLOWED' });
  });

  it('lets a temporary restriction block the capability', () => {
    expect(
      evaluateCapability(
        context({
          actor: { ...context().actor, temporaryRestrictions: ['member.warnings.view'] },
        }),
      ),
    ).toMatchObject({ decision: PolicyDecision.Deny, code: 'TEMPORARILY_RESTRICTED' });
  });
});
