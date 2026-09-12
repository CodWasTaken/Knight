import { PolicyDecision, ProtectionLevel, type StaffProfileSnapshot } from '@knight/contracts';
import { describe, expect, it } from 'vitest';
import type { AuthorizationContext } from './types.js';
import { evaluatePolicy } from './evaluate-policy.js';

const moderator: StaffProfileSnapshot = {
  guildId: '100',
  profileId: 'mod',
  profileVersionId: 'mod-v1',
  discordRoleId: '900',
  rank: 20,
  permissions: ['member.ban'],
  actionPolicies: {},
};

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    action: 'member.ban',
    actor: {
      userId: '42',
      isGuildOwner: false,
      profile: moderator,
      temporaryGrants: [],
      temporaryRestrictions: [],
    },
    target: {
      userId: '77',
      isGuildOwner: false,
      knightRank: 0,
      elevatedUnregistered: false,
      protectionLevel: ProtectionLevel.Normal,
    },
    emergency: { memberModerationLocked: false },
    ...overrides,
  };
}

function expectDecision(input: AuthorizationContext, decision: PolicyDecision, code: string): void {
  expect(evaluatePolicy(input)).toMatchObject({ decision, code });
}

describe('evaluatePolicy', () => {
  const hierarchyActions = [
    'member.warn',
    'member.timeout',
    'member.kick',
    'member.ban',
    'member.unban',
    'message.purge',
  ] as const;

  it.each(hierarchyActions)('denies %s against an equal-ranked Knight target', (action) => {
    const actorProfile = { ...moderator, permissions: [action] };
    expectDecision(
      context({
        action,
        actor: { ...context().actor, profile: actorProfile },
        target: { ...context().target!, knightRank: 20 },
      }),
      PolicyDecision.Deny,
      'TARGET_OUTRANKS_ACTOR',
    );
  });

  it('allows resource-scoped purge authorization without a member target', () => {
    expectDecision(
      context({
        action: 'message.purge',
        actor: {
          ...context().actor,
          profile: { ...moderator, permissions: ['message.purge'] },
        },
        target: null as never,
      }),
      PolicyDecision.Allow,
      'ALLOWED',
    );
  });

  it('allows a moderator to ban a lower-ranked member', () => {
    expectDecision(context(), PolicyDecision.Allow, 'ALLOWED');
  });

  it('denies a target with an equal or higher Knight rank', () => {
    expectDecision(
      context({ target: { ...context().target!, knightRank: 20 } }),
      PolicyDecision.Deny,
      'TARGET_OUTRANKS_ACTOR',
    );
  });
  it('denies a non-owner without an active Staff Profile', () => {
    expectDecision(
      context({ actor: { ...context().actor, profile: null } }),
      PolicyDecision.Deny,
      'NO_ACTIVE_STAFF_ASSIGNMENT',
    );
  });

  it('treats the guild owner as authority without a Staff Profile', () => {
    expectDecision(
      context({
        actor: { ...context().actor, isGuildOwner: true, profile: null },
        target: { ...context().target!, knightRank: 999 },
      }),
      PolicyDecision.Allow,
      'ALLOWED',
    );
  });

  it('denies when the effective permission is missing', () => {
    expectDecision(
      context({ actor: { ...context().actor, profile: { ...moderator, permissions: [] } } }),
      PolicyDecision.Deny,
      'PERMISSION_MISSING',
    );
  });

  it('denies resource-scoped purge while the emergency member lock is active', () => {
    expectDecision(
      context({
        action: 'message.purge',
        actor: {
          ...context().actor,
          profile: { ...moderator, permissions: ['message.purge'] },
        },
        target: null,
        emergency: { memberModerationLocked: true },
      }),
      PolicyDecision.Deny,
      'LOCKDOWN_ACTIVE',
    );
  });

  it('denies member moderation while the emergency member lock is active', () => {
    expectDecision(
      context({ emergency: { memberModerationLocked: true } }),
      PolicyDecision.Deny,
      'LOCKDOWN_ACTIVE',
    );
  });

  it('lets a temporary restriction override a temporary grant', () => {
    expectDecision(
      context({
        actor: {
          ...context().actor,
          profile: { ...moderator, permissions: [] },
          temporaryGrants: ['member.ban'],
          temporaryRestrictions: ['member.ban'],
        },
      }),
      PolicyDecision.Deny,
      'TEMPORARILY_RESTRICTED',
    );
  });
  it('hard-denies actions targeting the guild owner', () => {
    expectDecision(
      context({ target: { ...context().target!, isGuildOwner: true } }),
      PolicyDecision.Deny,
      'OWNER_TARGET_PROTECTED',
    );
  });

  it('does not treat an elevated unregistered Discord target as rank zero', () => {
    expectDecision(
      context({
        target: {
          ...context().target!,
          knightRank: null,
          elevatedUnregistered: true,
        },
      }),
      PolicyDecision.Deny,
      'TARGET_OUTRANKS_ACTOR',
    );
  });

  it('requires approval for a critical protected target', () => {
    expectDecision(
      context({ target: { ...context().target!, protectionLevel: ProtectionLevel.Critical } }),
      PolicyDecision.RequireApproval,
      'APPROVAL_REQUIRED',
    );
  });

  it('hard-denies a non-owner action against an immutable protected target', () => {
    expectDecision(
      context({ target: { ...context().target!, protectionLevel: ProtectionLevel.Immutable } }),
      PolicyDecision.Deny,
      'PROTECTED_TARGET',
    );
  });
});
