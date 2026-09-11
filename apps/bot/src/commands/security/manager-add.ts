import { formatSecurityManagerError } from '../safe-management-error.js';

export type SecurityManagerCommandInput = Readonly<{
  guildId: string;
  actorUserId: string;
  userId: string;
}>;

export type SecurityManagerGrantService = Readonly<{
  grant(input: SecurityManagerCommandInput): Promise<void>;
}>;

export async function executeSecurityManagerAdd(
  input: SecurityManagerCommandInput,
  service: SecurityManagerGrantService,
): Promise<{ content: string }> {
  try {
    await service.grant(input);
    return { content: `Granted Knight Security Manager authority to <@${input.userId}>.` };
  } catch (error) {
    return { content: formatSecurityManagerError(error) };
  }
}
