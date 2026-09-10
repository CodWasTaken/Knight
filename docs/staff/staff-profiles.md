# Staff Profiles

## What and why

A Staff Profile is Knight's reusable security policy for a Discord staff role. It has a rank, a mapped Discord role, an immutable current policy version, permissions such as `member.ban`, and action policies such as limits.

The critical rule is: **the active Knight database assignment grants authority; the mapped Discord role represents that assignment.** A manually added mapped role never creates Knight authority.

## How

Create a profile with `/staff create-profile`, choosing a name, mapped Discord role, and rank. New profiles begin with zero Knight permissions and zero action policies. Configure the profile in the dashboard, then assign it with `/staff assign`.

## Example

```text
/staff create-profile name:Moderator role:@Moderator rank:20
/staff assign user:@Alice profile:Moderator
/staff inspect user:@Alice
```

`/staff inspect` reports the authoritative database assignment separately from Discord role representation and highlights `NEEDS_REPAIR` if synchronization requires attention.

## Security implications

Security Managers cannot grant a profile above their own effective rank. Creating a higher profile for yourself is not a bypass. Removing an assignment deactivates database authority before attempting Discord role cleanup, so a Discord cleanup failure cannot retain Knight authority.

## Common mistakes

Do not treat a Discord role as a source of Knight permissions. Do not reuse one role across unrelated trust levels without understanding the profile/rank effect. If synchronization reports `NEEDS_REPAIR`, inspect the authoritative state before retrying or manually changing roles.
