export type RoleHierarchyHealthInput = Readonly<{
  knightRolePosition: number;
  managedStaffRolePositions: readonly number[];
}>;

export type RoleHierarchyHealth = Readonly<{
  healthy: boolean;
  blockingRolePositions: readonly number[];
}>;

export function evaluateRoleHierarchyHealth(input: RoleHierarchyHealthInput): RoleHierarchyHealth {
  const blockingRolePositions = input.managedStaffRolePositions
    .filter((position) => position >= input.knightRolePosition)
    .sort((left, right) => right - left);

  return {
    healthy: blockingRolePositions.length === 0,
    blockingRolePositions,
  };
}
