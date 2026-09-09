import { formatStaffManagementError } from '../safe-management-error.js';

export type StaffCreateProfileInput = Readonly<{
  guildId: string;
  actorUserId: string;
  name: string;
  discordRoleId: string;
  rank: number;
}>;

export type StaffCreateProfileService = Readonly<{
  createProfile(input: StaffCreateProfileInput): Promise<unknown>;
}>;

export async function executeStaffCreateProfile(
  input: StaffCreateProfileInput,
  service: StaffCreateProfileService,
): Promise<{ content: string }> {
  try {
    await service.createProfile(input);
    return {
      content: `Created Staff Profile **${input.name}** mapped to <@&${input.discordRoleId}> at Knight rank ${input.rank}. It starts with zero permissions and zero action policies.`,
    };
  } catch (error) {
    return { content: formatStaffManagementError(error) };
  }
}
