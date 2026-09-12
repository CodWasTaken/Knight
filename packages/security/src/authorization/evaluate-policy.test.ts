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
    emergency: { mode: 'NORMAL', lockedScopes: [] },
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

  it('denies resource-scoped purge while member moderation is locked down', () => {
    expectDecision(
      context({
        action: 'message.purge',
        actor: {
          ...context().actor,
          profile: { ...moderator, permissions: ['message.purge'] },
        },
        target: null,
        emergency: { mode: 'LOCKDOWN', lockedScopes: ['MEMBER_MODERATION'] },
      }),
      PolicyDecision.Deny,
      'LOCKDOWN_ACTIVE',
    );
  });

  it('denies member moderation while member moderation is locked down', () => {
    expectDecision(
      context({ emergency: { mode: 'LOCKDOWN', lockedScopes: ['MEMBER_MODERATION'] } }),
      PolicyDecision.Deny,
      'LOCKDOWN_ACTIVE',
    );
  });

  it.each([
    'security.staff.assign',
    'security.staff.remove',
    'security.staff.manage_profiles',
    'security.security_managers.manage',
    'security.policy.edit',
  ] as const)('denies %s while security configuration is locked down', (action) => {
    expectDecision(
      context({
        action,
        actor: {
          ...context().actor,
          profile: { ...moderator, permissions: [action] },
        },
        target: null,
        emergency: { mode: 'LOCKDOWN', lockedScopes: ['SECURITY_CONFIG'] },
      }),
      PolicyDecision.Deny,
      'LOCKDOWN_ACTIVE',
    );
  });

  it('denies privileged actions when the full scope is locked down', () => {
    expectDecision(
      context({ emergency: { mode: 'LOCKDOWN', lockedScopes: ['FULL'] } }),
      PolicyDecision.Deny,
      'LOCKDOWN_ACTIVE',
    );
  });

  it.each([
    'member.warn',
    'member.timeout',
    'member.kick',
    'member.ban',
    'member.unban',
    'message.purge',
    'security.staff.assign',
    'security.staff.remove',
    'security.staff.manage_profiles',
    'security.security_managers.manage',
    'security.policy.edit',
    'security.approvals.approve',
  ] as const)('denies mutating action %s during panic', (action) => {
    expectDecision(
      context({
        action,
        actor: {
          ...context().actor,
          profile: { ...moderator, permissions: [action] },
        },
        target: action.startsWith('member.') ? context().target : null,
        emergency: { mode: 'PANIC', lockedScopes: [] },
      }),
      PolicyDecision.Deny,
      'PANIC_ACTIVE',
    );
  });

  it('keeps read-only policy access available during panic', () => {
    expectDecision(
      context({
        action: 'security.policy.view',
        actor: {
          ...context().actor,
          profile: { ...moderator, permissions: ['security.policy.view'] },
        },
        target: null,
        emergency: { mode: 'PANIC', lockedScopes: [] },
      }),
      PolicyDecision.Allow,
      'ALLOWED',
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
