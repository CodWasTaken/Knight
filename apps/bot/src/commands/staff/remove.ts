import { formatStaffManagementError } from '../safe-management-error.js';

export type StaffRemoveInput = Readonly<{
  guildId: string;
  actorUserId: string;
  userId: string;
}>;

export type StaffRemoveService = Readonly<{
  remove(input: StaffRemoveInput): Promise<{ removed: boolean; syncStatus: string | null }>;
}>;

export async function executeStaffRemove(
  input: StaffRemoveInput,
  service: StaffRemoveService,
): Promise<{ content: string }> {
  try {
    const result = await service.remove(input);
    if (!result.removed) {
      return { content: `No active Knight staff assignment exists for <@${input.userId}>.` };
    }
    if (result.syncStatus === 'NEEDS_REPAIR') {
      return {
        content: `Knight authority removed for <@${input.userId}>. Sync status: NEEDS_REPAIR. Discord role cleanup still needs repair; Knight authority remains removed.`,
      };
    }
    return {
      content: `Knight authority removed for <@${input.userId}> and the mapped Discord role was removed.`,
    };
  } catch (error) {
    return { content: formatStaffManagementError(error) };
  }
}
