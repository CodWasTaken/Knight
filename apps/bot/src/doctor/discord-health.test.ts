import { describe, expect, it } from 'vitest';
import { evaluateRoleHierarchyHealth } from './discord-health.js';

describe('evaluateRoleHierarchyHealth', () => {
  it('is unhealthy when a managed staff role outranks Knight', () => {
    expect(
      evaluateRoleHierarchyHealth({
        knightRolePosition: 40,
        managedStaffRolePositions: [20, 50],
      }),
    ).toEqual({
      healthy: false,
      blockingRolePositions: [50],
    });
  });

  it('is healthy when Knight outranks every managed staff role', () => {
    expect(
      evaluateRoleHierarchyHealth({
        knightRolePosition: 40,
        managedStaffRolePositions: [10, 20, 30],
      }),
    ).toEqual({ healthy: true, blockingRolePositions: [] });
  });
});
