# Knight Moderation + Dashboard Expansion Design

**Date:** 2026-09-10
**Status:** Approved
**Branch:** `feature/security-foundation`

## Goal

Expand Knight from the guarded-ban foundation into a complete first moderation surface while preserving one shared security model across Discord commands and the dashboard.

This pass adds guarded warn, timeout, kick, ban, unban, and message purge actions; durable warning history; per-action rate limits; dashboard Staff Profile creation/editing; broader Guarded native-permission stripping; and a flat Discord-inspired dashboard redesign.

## Non-goals

- Knight does not create Discord roles. Staff Profiles map to roles that already exist in Discord.
- This pass does not implement incidents, anomaly scoring, backups, raid protection, or anti-nuke automation.
- This pass does not make native Discord Administrator a Knight authority source.
- This pass does not remove Discord permissions until a working Knight replacement exists.

## Canonical permissions

Existing action IDs remain canonical. Add one new read-only capability:

- `member.warn`
- `member.warnings.view`
- `member.timeout`
- `member.kick`
- `member.ban`
- `member.unban`
- `message.purge`

## Authorization invariants

All mutating moderation commands use one shared target-aware authorization path in `@knight/security`.

For non-owner actors, a moderation action is denied when the target has an equal or higher Knight rank. The guild owner target remains protected from staff moderation. Elevated Discord users without a Knight rank remain fail-closed rather than being treated as rank zero.

The guild owner keeps ultimate Knight authority, subject to Discord's own API constraints.

`member.warnings.view` is intentionally different: it is read-only, requires the explicit permission for staff, has no rate limit, and does not apply target-rank or owner-target restrictions. Staff with that permission may inspect warning history for any user in the guild; the guild owner may always inspect warning history without a Staff Profile permission.

Temporary restrictions and emergency moderation locks continue to override grants for mutating moderation actions. Missing policy/rate state fails closed.

## Shared moderation pipeline

Refactor the current ban-specific orchestration into reusable moderation execution primitives rather than copying the ban handler six times.

Each mutating action follows:

```text
resolve actor + target state
→ evaluate canonical permission and hierarchy
→ evaluate action policy
→ atomically consume that action's rate limit
→ durably record policy decision
→ create execution evidence when an external Discord mutation follows
→ perform the narrowly scoped mutation
→ return a safe, actionable result
```

No slash-command router or React component may implement its own hierarchy rule.

## Discord command surface

Register and implement:

```text
/member warn user:<member> reason:<text>
/member warnings user:<member>
/member timeout user:<member> duration:<duration> reason:<text>
/member kick user:<member> reason:<text>
/member ban user:<member> reason:<text>
/member unban user_id:<discord-user-id> reason:<text>
/message purge count:<1-100> [user:<member>] [reason:<text>]
```

Timeout duration accepts concise values such as `10m`, `1h`, or `1d`, is parsed into an explicit duration, and must respect Discord's supported timeout ceiling. Invalid or excessive durations are rejected before authorization or mutation.

Unban resolves a Discord user even though the user is no longer a guild member. Knight still consults durable staff state so a banned staff member cannot be unbanned by a lower-ranked actor if an active Knight assignment identifies a protected rank.

Purge operates only on recent messages eligible for safe bulk deletion. If a user filter is supplied, that user is a moderation target and normal rank protection applies. Without a user filter, Knight evaluates message authors and skips messages belonging to the guild owner or equal/higher-ranked Knight staff rather than letting a bulk purge bypass hierarchy.

All command replies remain ephemeral where appropriate and never include stack traces, tokens, database URLs, or raw internal exceptions.

## Durable warnings

Add a guild-scoped warning table storing at minimum warning ID, guild ID, target Discord user ID, actor Discord user ID, reason, actor policy/profile version when available, created timestamp, and DM delivery status.

Issuing `/member warn` first passes Knight authorization and rate limiting. On allow, Knight writes the warning durably, then attempts a direct message to the target. A DM failure does not erase or roll back the warning; delivery status records the outcome.

`/member warnings` reads this table in reverse chronological order, scoped by guild and target user. It requires `member.warnings.view` but ignores target rank as explicitly approved.

## Discord adapter expansion

Extend `DiscordActionPort` with narrowly scoped methods for kick, timeout, unban, direct-message delivery, recent-message fetch, and message deletion. Policy remains outside the adapter.

The adapter returns enough message-author metadata for the security/application layer to filter protected authors before purge. It must not silently make hierarchy decisions itself.

Execution correlations remain required immediately before moderation mutations that Discord will expose as external actions. Warning creation itself is durable Knight state; DM delivery is secondary and must not determine whether the warning exists.

## Per-action rate limits

Rate policies are stored in the existing `ActionPolicies` structure per action. The configurable rate-limited actions are:

- `member.warn`
- `member.timeout`
- `member.kick`
- `member.ban`
- `member.unban`
- `message.purge`

Each defaults to Unlimited when enabled. Each may instead have up to three finite windows. `member.warnings.view` is not rate limited.

The Redis key remains scoped by guild, actor, and action, so using one action never consumes another action's budget.

## Staff Profile dashboard management

The dashboard becomes a complete Staff Profile management surface for configured guilds.

### Create profile

The Staff Profiles page gains a Create Staff Profile action with:

- profile name
- existing Discord role selection
- Knight rank

Discord roles are fetched server-side from the connected guild and displayed by name. Knight does not create or rename Discord roles.

New profiles start with no moderation permissions enabled and no finite rate windows. Creation remains guild-scoped and subject to existing owner/Security Manager management authorization.

### Edit profile metadata and policy

A profile page can edit name, mapped Discord role, Knight rank, canonical permissions, and per-action rate policies. Every edit that changes authority-bearing state creates a new immutable Staff Profile version containing the effective name, mapped role, rank, permissions, and action policies; the current profile row remains the lookup pointer/index for the latest version.

Rank changes and other authority-increasing edits are subject to grant-ceiling and self-escalation checks. A Security Manager cannot raise the authority of the profile governing themselves, create/edit a peer at or above their own rank, or grant permissions/limits beyond their own effective authority. Guild owner authority remains the override.

Mapped-role changes must target a real role in the same guild and a role Knight can manage. They never make possession of that Discord role sufficient for Knight authority; the durable Knight assignment remains authoritative. When a mapped role changes, active assignments are resynchronized from the old role to the new role with the existing `NEEDS_REPAIR` behavior on Discord failure.

Creating a new mapped profile or changing a mapped role is blocked while the guild is already in `GUARDED`. The owner must roll back to `TEST`, change mappings, preview the expanded Guarded migration again, and re-enable Guarded. This prevents a newly mapped role from silently reintroducing native bypass permissions.

## Dashboard visual redesign

Replace the current gradient-heavy prototype with a flat, Discord-inspired dark interface without copying Discord branding or logos.

Use neutral charcoal surfaces, subtle separators, compact spacing, restrained accent color, clear typography hierarchy, and consistent control states. Remove all gradients and large decorative shadows.

Guild pages gain a persistent navigation structure with clear entries for Overview, Staff Profiles, and Setup. Selected navigation, destructive actions, warnings, and mode state should be visually distinct without relying on gradients.

The Staff Profile editor renders one capability row per implemented permission. Enabled mutating permissions expose an Unlimited/Custom rate-limit control; Custom starts with one visible window and supports adding up to three. Disabled actions do not show meaningless empty rate rows. `member.warnings.view` is marked read-only and has no rate controls.

Forms must remain usable on narrow screens and keyboard-accessible. Server actions remain the source of truth; client components are limited to progressive UI behavior such as adding/removing rate-window rows.

## Guarded mode expansion

Expand Guarded native-permission replacement to these mappings:

```text
Discord Ban Members      → member.ban / member.unban
Discord Kick Members     → member.kick
Discord Moderate Members → member.timeout
Discord Manage Messages  → message.purge
```

Warnings have no native Discord moderation permission to strip.

When Guarded mode is enabled, every mapped staff role that currently carries one of the guarded native permission bits is included in preview, even if its Knight profile does not grant the corresponding Knight action. This prevents a profile with no Knight grant from retaining a native bypass.

Preview computes the union of affected permission bits per role, verifies Knight can manage every affected role, and shows exact before/after permission bigints. Enabling snapshots each affected role before any mutation. If preview is blocked, enabling performs zero role mutations.

Rollback restores the exact saved permission bigint for every affected role. A role is snapshotted once per migration even when multiple guarded categories affect it.

Guarded mode may only strip a native permission after the corresponding Knight command and policy path are implemented and verified in the same release.

## Data and migration changes

Add a migration for durable warnings and extend Staff Profile version storage so authority-bearing metadata (mapped role and rank, plus profile name for reconstruction) is captured with each immutable version. Existing version rows are backfilled from their current profile metadata because historical metadata edits were not previously supported. Existing guild, profile, assignment, policy-decision, guarded-category, and role-snapshot data must remain compatible.

No migration may rewrite existing Staff Profile permissions or silently enable newly added actions. Existing profiles keep their current permissions and policies; all new capabilities begin disabled until explicitly granted.

## Error handling

Security denials use stable decision codes and human-readable command/dashboard messages. Discord API failures after authorization are reported as mutation failures without leaking internals; attempted rate-limited mutations continue to consume their security budget where appropriate.

Warning DM failure is a partial-success state: warning stored, DM delivery failed. Purge reports deleted and protected/skipped counts. Cross-guild IDs, missing roles, stale profiles, and invalid durations/counts fail before mutation.

## Testing strategy

All behavioral changes follow strict red-green-refactor TDD. Add table-driven policy tests proving every mutating moderation action denies equal/higher Knight targets and owner targets while the owner actor remains authoritative. Add a separate warning-history test proving target rank does not block `member.warnings.view`.

Add command tests for every deny/allow path, mutation ordering, rate exhaustion, dependency failure, warning persistence plus DM failure, unban hierarchy from durable staff state, and purge filtering of protected authors.

Add database integration tests for warning guild isolation/history ordering and Staff Profile metadata updates. Add dashboard service/action tests for profile creation, role validation, rank/grant ceilings, immutable policy versions, and action-specific rate-policy parsing.

Add Guarded migration tests covering the four native permission bits, unioning multiple bits on one role, snapshot-before-mutation ordering, blocked previews, and exact bigint rollback.

Visual/dashboard tests should assert structural behavior rather than pixel snapshots: persistent guild navigation, no gradient CSS, capability rows, read-only warning-history treatment, and rate controls shown only when relevant.

## Verification and rollout

Before completion run the full repository gates against disposable PostgreSQL/Redis services:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
docker build
Docker runtime import/non-root gate
```

Then rebuild the Compose stack and verify web health, bot/worker stability, slash-command registration, and a private-guild smoke test. Live destructive moderation should only target disposable test accounts/messages. If no disposable target exists, do not claim a real destructive action was exercised.

The smoke should verify profile creation/editing in the dashboard, per-action rate limits, lower-rank denial against higher-ranked staff, warning persistence/history lookup, timeout/kick/ban/unban/purge command wiring, Guarded preview for all four native permissions, and exact rollback.

## Compatibility and security boundary

PostgreSQL remains authoritative for Knight staff identity, rank, warning history, and policy. Redis remains disposable rate/correlation state. Discord roles remain mapped representation, not Knight authority.

OAuth dashboard authorization continues to use the linked Discord account ID. Native Discord Administrator does not imply Knight dashboard or policy authority. Existing `.env` credentials remain unchanged and must never be printed or committed.
