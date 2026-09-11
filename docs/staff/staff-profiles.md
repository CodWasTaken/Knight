# Staff Profiles

## What and why

A Staff Profile is Knight's reusable security policy for Discord staff. Each profile has a name, Knight rank, one mapped Discord role, an immutable current version, explicit Knight permissions, and per-action policy where applicable.

The critical rule is: **the active Knight database assignment grants authority; the mapped Discord role represents that assignment.** Manually adding a mapped Discord role never creates Knight authority.

## Create and edit profiles

Use the dashboard's **Staff Profiles** page to create a profile. Knight only allows selecting an existing Discord role from the same guild that is below Knight's highest role and is not managed by Discord or an integration. Knight never creates, renames, reorders, or arbitrarily edits Discord roles from this screen.

New profiles start with no Knight permissions and no finite action limits. The profile detail page lets you version its name, mapped role, rank, and moderation policy. Every successful metadata or policy save creates a new immutable profile version.

Role remapping is blocked while the guild is in `GUARDED`. Roll back to `TEST` before changing a profile's mapped Discord role.

## Moderation capabilities

The dashboard exposes these capabilities:

- `member.warn`
- `member.warnings.view` — read-only warning-history lookup
- `member.timeout`
- `member.kick`
- `member.ban`
- `member.unban`
- `message.purge`

`member.warnings.view` is intentionally different from the mutating actions: it requires owner authority or the explicit permission, ignores the target's Knight rank, and has no rate-limit policy.

## Rank and management ceilings

Higher Knight rank means higher staff authority for protected mutations. A non-owner cannot warn, timeout, kick, ban, or otherwise mutate an equal- or higher-ranked Knight staff target. The guild owner is always protected, and the guild owner remains Knight's ultimate authority.

Security Managers may create and edit profiles only below their own effective Knight rank and grant ceiling. They cannot raise a profile that governs themselves to increase their own authority. Discord Administrator by itself does not provide Knight management authority.

## Assignments and role synchronization

Use `/staff assign` and `/staff remove` for authoritative assignment changes. When a mapped role changes, Knight keeps the persisted profile version and attempts to resync each active assignment from the old role to the new role.

If Discord role synchronization fails after persistence, Knight does not ambiguously roll back database authority. The affected assignment is marked `NEEDS_REPAIR`; successful assignments remain `SYNCED`. Use `/staff inspect user:<member>` to compare the authoritative Knight assignment with current Discord role representation.

## Common mistakes

Do not infer Knight authority from native Discord roles or Discord Administrator. Do not map a role above Knight in the hierarchy. Do not remap roles while Guarded is active. If an assignment reports `NEEDS_REPAIR`, inspect the authoritative state first instead of repeatedly adding/removing roles by hand.
