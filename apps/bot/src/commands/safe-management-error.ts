function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

export function formatStaffManagementError(error: unknown): string {
  switch (errorCode(error)) {
    case 'GUILD_NOT_CONFIGURED':
      return 'Knight is not configured for this Discord server yet.';
    case 'STAFF_MANAGEMENT_DENIED':
      return 'Staff change denied: only the guild owner or an explicit Knight Security Manager may manage staff.';
    case 'ACTOR_PROFILE_REQUIRED':
      return 'Staff change denied: this Security Manager needs an active Knight Staff Profile before granting authority.';
    case 'GRANT_CEILING':
      return 'Staff change denied: the requested authority is at or above your Knight grant ceiling.';
    case 'PROFILE_NOT_FOUND':
      return 'Knight could not find that Staff Profile in this server.';
    case 'PROFILE_REFERENCE_AMBIGUOUS':
      return 'Multiple Staff Profiles match that name. Use the exact profile name or profile ID.';
    case 'INVALID_RANK':
      return 'Staff Profile rank must be a non-negative integer.';
    default:
      return 'Knight could not complete that staff-management command safely. Use /staff inspect to confirm the authoritative Knight state before retrying.';
  }
}

export function formatSecurityManagerError(error: unknown): string {
  switch (errorCode(error)) {
    case 'GUILD_NOT_CONFIGURED':
      return 'Knight is not configured for this Discord server yet.';
    case 'OWNER_REQUIRED':
      return 'Only the Discord guild owner may change Knight Security Managers.';
    default:
      return 'Knight could not complete that Security Manager command safely.';
  }
}
