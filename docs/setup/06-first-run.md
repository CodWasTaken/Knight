# 6. First run

## What and why

Knight starts in Observe so you can confirm service health, Discord hierarchy, Staff Profile mappings, and policy behavior before Guarded removes selected native moderation permissions. Setup progress is persisted in PostgreSQL across restarts.

## Recommended sequence

1. Run `/doctor` in the target server and resolve database, migration, Redis, Discord capability, or hierarchy warnings.
2. Run `/setup` and work through the persistent setup state. The command and dashboard show the current readiness blockers.
3. Open the dashboard and create at least one enabled Staff Profile by mapping an existing manageable Discord role and assigning a Knight rank.
4. Save the current Staff Profile versions/action policies, including intentionally disabled actions and independent per-action limits.
5. Open **Logging** and explicitly save the Security and Moderation notification destinations. Either destination may be **Disabled**; PostgreSQL remains the authoritative Security Ledger.
6. Open **Security**, choose the bot and webhook firewall modes, and save them once. Observe is the safe explicit default. Enforce removes only inventory entries you explicitly mark Blocked.
7. Add existing users, roles, or channels under **Protected** only where a stronger target rule is useful. Protected resources are optional.
8. Open **Recovery** and save one exact backup mode: `DISABLED`, `MANUAL`, or `DAILY`. Disabled is a valid explicit choice; it is different from never configuring backups.
9. If backups are enabled, queue **Take Backup Now**, wait for a completed SHA-256-backed snapshot, and review a restore preview before relying on recovery.
10. Review the **Emergency state** panel. Keep it Normal during routine setup; Lockdown and Panic are incident controls.
11. Assign staff with `/staff assign user:<member> profile:<profile>` and confirm state with `/staff inspect user:<member>`.
12. Add explicit Knight Security Managers only where needed. Discord Administrator alone does not grant Knight management authority.
13. Advance `OBSERVE → COMPLETE` only after the readiness summary has no blocking configuration errors. Setup completion does not change the guild's Observe/Test/Guarded operating mode.
14. Move from Observe to Test explicitly, then exercise Knight's moderation commands with controlled test targets/messages before Guarded.

## Enforced setup gates

Knight does not blindly advance setup. The current step is persisted in PostgreSQL, re-evaluated against live/persisted state, and blocked with concrete reasons when prerequisites are missing.

- `HEALTH`: Knight has Manage Roles, at least one enabled Staff Profile maps to a live Discord role, and Knight is above mapped Staff Profile roles.
- `STAFF`: at least one enabled Staff Profile maps to a live Discord role.
- `POLICIES`: every enabled Staff Profile has a current saved immutable version/action-policy record. An empty action-policy map is a valid explicit all-disabled configuration.
- `LOGGING`: a logging-settings row has been saved. Both notification destinations may be Disabled.
- `PROTECTION`: firewall settings have been saved. Observe for both bot and webhook firewalls is valid; protected resources are optional.
- `BACKUPS`: a backup policy row has been saved. `DISABLED` is valid.
- `OBSERVE`: all prior readiness checks are re-evaluated and must have no blockers.
- `COMPLETE`: setup progress is complete only. Knight never changes Observe/Test/Guarded mode as a side effect of completion.

The dashboard disables **Advance setup step** while blocked and links to Staff, Logging, Security, or Recovery where appropriate. `/setup` reports the same readiness and blocker text.

For details on logging/protection see [Logging and protection](../security/logging-and-protection.md). For local snapshots and restore behavior see [Local backups and recovery](../backups/local-backups-and-recovery.md).

## Emergency controls

The guild owner and explicit Knight Security Managers can inspect or change emergency state from the Security dashboard or with these ephemeral commands:

```text
/security status
/security lockdown scope:<scope> reason:<text>
/security unlock reason:<text>
/security panic reason:<text> confirm:<true>
/security panic-clear reason:<text>
```

Panic requires explicit confirmation. It freezes privileged Knight mutations and records a critical incident; it does not strip roles or rewrite the server. Status and the matching recovery control remain available. See [Lockdown and Panic](../security/lockdown-and-panic.md) for scope and recovery details.

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
