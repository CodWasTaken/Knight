import { formatStaffManagementError } from '../safe-management-error.js';

export type StaffAssignInput = Readonly<{
  guildId: string;
  actorUserId: string;
  userId: string;
  profileReference: string;
}>;

export type StaffAssignService = Readonly<{
  assignByReference(input: StaffAssignInput): Promise<{ syncStatus: string }>;
}>;

export async function executeStaffAssign(
  input: StaffAssignInput,
  service: StaffAssignService,
): Promise<{ content: string }> {
  try {
    const result = await service.assignByReference(input);
    if (result.syncStatus === 'NEEDS_REPAIR') {
      return {
        content: `Knight assignment is active for <@${input.userId}>, but Discord role sync needs repair. Sync status: NEEDS_REPAIR. Knight authority remains based on the database assignment.`,
      };
    }
    return {
      content: `Assigned <@${input.userId}> through Knight. The Knight assignment is active and the mapped Discord role is synced.`,
    };
  } catch (error) {
    return { content: formatStaffManagementError(error) };
  }
}
