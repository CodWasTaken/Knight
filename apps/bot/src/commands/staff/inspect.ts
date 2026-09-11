import { formatStaffManagementError } from '../safe-management-error.js';

export type StaffInspectInput = Readonly<{ guildId: string; userId: string }>;

type StaffInspectionView = Readonly<{
  assignment: Readonly<{
    profileId: string;
    profileName: string;
    discordRoleId: string;
    profileRank: number;
    syncStatus: string;
  }> | null;
  authoritative: boolean;
  mappedRoleIds: readonly string[];
}>;

export type StaffInspectService = Readonly<{
  inspect(guildId: string, userId: string): Promise<StaffInspectionView>;
}>;

export async function executeStaffInspect(
  input: StaffInspectInput,
  service: StaffInspectService,
): Promise<{ content: string }> {
  try {
    const inspection = await service.inspect(input.guildId, input.userId);
    if (inspection.assignment === null || !inspection.authoritative) {
      const mapped =
        inspection.mappedRoleIds.length > 0
          ? ` Mapped Discord role(s) present: ${inspection.mappedRoleIds.map((id) => `<@&${id}>`).join(', ')}; this does not grant Knight authority.`
          : '';
      return {
        content: `Knight staff inspection for <@${input.userId}>\nActive Knight assignment: no\nKnight authority: no.${mapped}`,
      };
    }

    const assignment = inspection.assignment;
    const repair =
      assignment.syncStatus === 'NEEDS_REPAIR'
        ? '\nWARNING: NEEDS_REPAIR — the mapped Discord role representation needs repair.'
        : '';
    return {
      content: [
        `Knight staff inspection for <@${input.userId}>`,
        `Staff Profile: ${assignment.profileName} (ID: ${assignment.profileId})`,
        `Rank: ${assignment.profileRank}`,
        `Mapped Discord role: <@&${assignment.discordRoleId}>`,
        'Active Knight assignment: yes',
        `Sync status: ${assignment.syncStatus}${repair}`,
      ].join('\n'),
    };
  } catch (error) {
    return { content: formatStaffManagementError(error) };
  }
}
