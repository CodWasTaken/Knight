# 7. Enable Guarded permissions

## What and why

Guarded mode makes Knight the enforced path for the protected action category. The foundation supports **MEMBER_BAN only**: Knight snapshots each affected mapped role's exact permission bigint, then removes only Discord's Ban Members bit. Every unrelated permission bit is preserved.

## How

1. Complete Observe and Test first.
2. Open the guild setup dashboard while Knight is in Test mode.
3. Review the Guarded preview. It shows affected profile IDs, mapped role IDs, active staff count, exact before/after permission bigints, and manageability blockers.
4. Resolve any missing Manage Roles capability, missing role, or role-hierarchy blocker.
5. The Discord guild owner checks the explicit confirmation box and enables Guarded bans.
6. Verify staff use `/member ban` and that policy/rate-limit denials still work.
7. If you need to back out, the guild owner uses the rollback control to restore the latest saved exact permission bigints and return to Test.

## Example

If a mapped role has Ban Members, Kick Members, Moderate Members, and Manage Messages, the preview's after value removes only Ban Members. Kick Members, Moderate Members, Manage Messages, and every other unrelated bit remain unchanged.

## Security implications

Only the guild owner can activate or roll back Guarded `MEMBER_BAN`. All snapshots are persisted before the first Discord permission mutation. If a multi-role migration write fails, Knight attempts compensation from those snapshots before activating Guarded state. PostgreSQL mode/category state changes atomically.

## Common mistakes

Do not enable Guarded just because the preview button is visible: inspect every blocked reason first. Do not manually edit the affected role permissions during a migration/rollback window. A rollback restores the saved bigint, so intentional role changes made after the snapshot may be overwritten.
