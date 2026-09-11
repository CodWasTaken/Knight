# 7. Enable Guarded permissions

## What Guarded changes

Guarded mode makes Knight the enforced path for the native moderation capabilities it replaces. Knight snapshots each affected mapped role's exact permission bigint before mutation, then removes these Discord permissions in one computed mask:

- Ban Members
- Kick Members
- Moderate Members
- Manage Messages

Every unrelated Discord permission bit is preserved. Knight warnings are not a native-permission replacement and are not part of this mask.

## Enable Guarded

1. Complete Observe and Test first.
2. Open the guild **Setup** page while mode is `TEST`.
3. Review every role in the Guarded preview. It shows affected profile IDs, mapped role IDs, active staff count, exact before/after permission bigints, and manageability blockers.
4. Resolve missing Manage Roles permission, deleted roles, or hierarchy blockers before continuing.
5. The Discord guild owner checks the explicit confirmation and enables Guarded moderation.
6. Verify staff use Knight's `/member warn`, `/member timeout`, `/member kick`, `/member ban`, `/member unban`, and `/message purge` paths as configured by their Staff Profile.
7. Verify lower-ranked staff cannot mutate equal/higher Knight staff and that rate-limit denials remain effective.

Profile creation and mapped-role changes are blocked while `GUARDED` is active. Roll back to `TEST` before remapping Staff Profiles.

## Rollback

Only the guild owner can roll Guarded moderation back to Test. Knight restores the latest saved exact role permission bigints before changing mode. If a multi-role enable operation fails partway through, Knight attempts compensation from the snapshots rather than silently leaving partially migrated authority.

A rollback restores the saved bigint exactly. Intentional manual role-permission edits made after that snapshot may therefore be overwritten; avoid manual edits during a migration/rollback window.

## Example

If a mapped role has Ban Members, Kick Members, Moderate Members, Manage Messages, View Audit Log, and unrelated channel permissions, the Guarded preview removes only the first four bits. View Audit Log and all unrelated bits remain unchanged.

## Security implications

The guild owner is the only actor allowed to activate or roll back Guarded moderation. Snapshots are persisted before the first Discord permission write. Knight computes one `after = before & ~guardedMask` value per affected role so overlapping guarded permissions are removed atomically for that role.

Do not enable Guarded merely because the button is available. Review every blocker and the exact before/after values first, and keep a tested rollback path.
