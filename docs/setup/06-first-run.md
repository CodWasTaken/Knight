# 6. First run

## What and why

Knight starts in Observe so you can confirm service health, Discord hierarchy, Staff Profile mappings, and policy behavior before Guarded removes selected native moderation permissions. Setup progress is persisted in PostgreSQL across restarts.

## Recommended sequence

1. Run `/doctor` in the target server and resolve database, migration, Redis, Discord capability, or hierarchy warnings.
2. Run `/setup` and work through the persistent setup state.
3. Open the dashboard and create Staff Profiles by mapping existing manageable Discord roles and assigning a Knight rank.
4. Configure only the moderation capabilities each profile needs and set independent per-action limits.
5. Open **Logging** and explicitly save the Security and Moderation notification destinations. Either destination may be **Disabled**; PostgreSQL remains the authoritative Security Ledger.
6. Open **Security**, choose the bot and webhook firewall modes, and save them once. Observe is the safe default. Enforce removes only inventory entries you explicitly mark Blocked.
7. Add existing users, roles, or channels under **Protected** only where a stronger target rule is useful.
8. Assign staff with `/staff assign user:<member> profile:<profile>` and confirm state with `/staff inspect user:<member>`.
9. Add explicit Knight Security Managers only where needed. Discord Administrator alone does not grant Knight management authority.
10. Move from Observe to Test.
11. Exercise Knight's moderation commands with controlled test targets/messages before Guarded.

The setup wizard will not advance past `LOGGING` until logging settings have been saved once. Saving both destinations as **Disabled** satisfies this gate and does not require Knight to create or access a Discord notification channel.

The wizard will not advance past `PROTECTION` until the firewall modes have been saved once. Explicitly saving Observe for both firewalls satisfies this gate; protected resources are optional.

## Moderation command surface

```text
/member warn user:<member> reason:<text>
/member warnings user:<member>
/member timeout user:<member> duration:<10m|1h|1d> reason:<text>
/member kick user:<member> reason:<text>
/member ban user:<member> reason:<text>
/member unban user_id:<discord-user-id> reason:<text>
/message purge count:<1-100> [user:<member>] [reason:<text>]
```

Timeout accepts one unit and is capped at 28 days. Warning persistence happens before DM delivery; a failed DM leaves the warning recorded with failed delivery status. Warning-history lookup requires owner authority or `member.warnings.view`, but intentionally ignores the target's Knight rank because it is read-only.

For mutating moderation, a non-owner is denied against equal- or higher-ranked Knight staff. The guild owner is always protected. Purge applies the same protection per message author and skips protected or otherwise ineligible messages instead of deleting them.

## Safe Test-mode example

Give a disposable Moderator profile `member.warn`, `member.timeout`, and `message.purge`, with small custom budgets. Use a disposable member and disposable messages to verify allowed actions, rate denials, warning history, protected-author skips, and safe error responses.

Do not use real production members for kick/timeout/ban verification when a disposable account is unavailable. In that case, rely on the automated adapter/handler tests and record that the final destructive Discord mutation was simulated rather than exercised live.

## Before Guarded

Confirm Staff Profiles are mapped correctly, assignments are `SYNCED`, Knight is above mapped staff roles, Manage Roles is available, and the owner has reviewed the Guarded preview. Then continue with [Enable Guarded permissions](07-enable-guarded-permissions.md).
