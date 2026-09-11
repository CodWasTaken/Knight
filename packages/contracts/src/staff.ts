import type { ActionId } from './actions.js';
import type { ActionPolicies } from './policy.js';

export type StaffProfileSnapshot = Readonly<{
  guildId: string;
  profileId: string;
  profileVersionId: string;
  discordRoleId: string;
  rank: number;
  permissions: readonly ActionId[];
  actionPolicies: ActionPolicies;
}>;
