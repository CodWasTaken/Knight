import { formatSecurityManagerError } from '../safe-management-error.js';
import type { SecurityManagerCommandInput } from './manager-add.js';

export type SecurityManagerRevokeService = Readonly<{
  revoke(input: SecurityManagerCommandInput): Promise<void>;
}>;

export async function executeSecurityManagerRemove(
  input: SecurityManagerCommandInput,
  service: SecurityManagerRevokeService,
): Promise<{ content: string }> {
  try {
    await service.revoke(input);
    return { content: `Knight Security Manager authority revoked from <@${input.userId}>.` };
  } catch (error) {
    return { content: formatSecurityManagerError(error) };
  }
}
