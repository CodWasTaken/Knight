# 6. First run

## What and why

Knight starts in Observe so you can confirm service health, hierarchy, staff mappings, and policy behavior before Discord-native permissions are reduced. Setup progress is persisted in PostgreSQL across restarts.

## How

1. Run `/doctor` in the target server and resolve any database, migration, Redis, Discord capability, or hierarchy warning.
2. Run `/setup` and work through the persistent setup state.
3. Create Staff Profiles and assign staff. A mapped Discord role represents the assignment; the Knight database assignment is authority.
4. Optionally add explicit Knight Security Managers. Discord Administrator alone does not grant this authority.
5. In the dashboard, edit the relevant profile to enable `member.ban` and configure limits.
6. Move from Observe to Test.
7. In Test, exercise `/member ban` with a private test account or other safe test target.

## Example

A Moderator profile can grant `member.ban` with a policy limit of 2 actions per 30 minutes. In Test mode, the moderator uses Knight's command path while the native Discord Ban Members bit remains unchanged. Two permitted test actions should be followed by a rate-limit denial on the third within the same window.

## Security implications

Do not skip Test mode. Observe and Test are the evidence-gathering stages before Guarded changes a mapped Discord role. Test with controlled accounts and reversible conditions rather than real production incidents.

## Common mistakes

Do not infer authority from a Discord role, and do not promote arbitrary Discord Administrators to the dashboard. If `/doctor` reports a hierarchy problem, fix role ordering before Guarded migration.
