import { describe, expect, it } from 'vitest';
import { planPurge } from './purge-planner.js';

const messages = [
  { messageId: 'owner', authorUserId: '1', createdAtMs: 1, bulkDeletable: true },
  { messageId: 'higher', authorUserId: '20', createdAtMs: 2, bulkDeletable: true },
  { messageId: 'equal', authorUserId: '21', createdAtMs: 3, bulkDeletable: true },
  { messageId: 'lower', authorUserId: '22', createdAtMs: 4, bulkDeletable: true },
  { messageId: 'ordinary', authorUserId: '23', createdAtMs: 5, bulkDeletable: true },
  { messageId: 'elevated', authorUserId: '24', createdAtMs: 6, bulkDeletable: true },
  { messageId: 'old', authorUserId: '23', createdAtMs: 7, bulkDeletable: false },
] as const;

const authors = new Map([
  ['1', { userId: '1', isGuildOwner: true, knightRank: null, elevatedUnregistered: false }],
  ['20', { userId: '20', isGuildOwner: false, knightRank: 30, elevatedUnregistered: false }],
  ['21', { userId: '21', isGuildOwner: false, knightRank: 20, elevatedUnregistered: false }],
  ['22', { userId: '22', isGuildOwner: false, knightRank: 10, elevatedUnregistered: false }],
  ['23', { userId: '23', isGuildOwner: false, knightRank: null, elevatedUnregistered: false }],
  ['24', { userId: '24', isGuildOwner: false, knightRank: null, elevatedUnregistered: true }],
]);

describe('planPurge', () => {
  it('protects owner, equal/higher staff, and elevated unregistered authors', () => {
    const plan = planPurge({ messages, authors, actorRank: 20, actorIsGuildOwner: false });
    expect(plan.deletableIds).toEqual(['lower', 'ordinary']);    expect(plan.protectedIds).toEqual(['owner', 'higher', 'equal', 'elevated']);
    expect(plan.ineligibleIds).toEqual(['old']);
  });

  it('applies an optional author filter before classification', () => {
    const plan = planPurge({
      messages,
      authors,
      actorRank: 20,
      actorIsGuildOwner: false,
      targetUserId: '23',
    });
    expect(plan.deletableIds).toEqual(['ordinary']);
    expect(plan.protectedIds).toEqual([]);
    expect(plan.ineligibleIds).toEqual(['old']);
  });

  it('lets the guild owner override staff-rank protection but still protects owner-authored messages', () => {
    const plan = planPurge({ messages, authors, actorRank: null, actorIsGuildOwner: true });
    expect(plan.protectedIds).toEqual(['owner']);
    expect(plan.deletableIds).toEqual(['higher', 'equal', 'lower', 'ordinary', 'elevated']);
  });
});
