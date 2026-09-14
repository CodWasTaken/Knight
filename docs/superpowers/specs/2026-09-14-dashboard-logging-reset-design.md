# Knight dashboard, logging, reset, and Guarded design

Date: 2026-09-14
Status: Approved design

## Goal

Extend Knight's existing architecture without rewriting it. The work must fix stale slash-command deployment, make Guarded activation understandable and correct, add an owner-only factory reset that erases Knight state without touching Discord structure, add first-class Message and Voice logging destinations, and make the dashboard feel like a finished operations console.

## Scope principles

- Preserve PostgreSQL, Redis, Drizzle, Next.js, discord.js, the worker, and the current repository/service boundaries.
- Prefer focused extensions over new frameworks or generalized infrastructure.
- Preserve the durable hash-chained Security Ledger as the authoritative event store.
- Keep Discord notification delivery best-effort.
- Preserve the existing uncommitted manual-start Compose change: `restart: "no"` for bot, web, and worker.
- Never read, print, commit, or expose real `.env` secrets.
- Factory reset must never delete, rename, reorder, or change permissions on Discord roles, channels, members, or webhooks.

## Current problems confirmed during design

- `/backup create` and `/backup status` exist in current source and router code, but the running bot image contains an older command-registration build that omits the `backup` command group.
- The current Guarded UI disables activation when the preview has zero affected roles, making a legitimate no-op migration look broken.
- The current setup page exposes raw implementation concepts such as `MEMBER_BAN Guarded`, raw role IDs, and permission bigints too prominently.
- Logging currently has only Security and Moderation destinations; deleted-message and voice activity are not first-class categories.

## Architecture choice

Use an integrated extension of the existing Knight architecture.

- Reuse existing repositories, services, server actions, worker loop, and Vitest patterns.
- Add only the durable state needed for factory-reset jobs and expanded logging settings.
- Do not add a generic event bus, new API layer, frontend component library, or cloud backup layer.
- Keep destructive filesystem cleanup in the worker because the worker alone owns the backup volume.

## Slash-command deployment

The backup commands do not need to be reimplemented. Keep the existing command definitions and router behavior.

Deployment must make the running image match source:

- Command-registration tests must keep `/backup create` and `/backup status` in the approved command set.
- Rebuild the bot image after source changes, for example with `docker compose up -d --build`.
- Verify the rebuilt container includes the current command list and registers it with Discord on startup.
- Document that source changes require an image rebuild in the Docker reference deployment.
- Do not create a second command-registration mechanism.

## Guarded moderation model

Rename the user-facing concept from `MEMBER_BAN Guarded` to **Guarded Moderation** where it describes the existing four-permission mask. Database compatibility names may remain if changing them would add migration risk without user benefit.

Guarded readiness must check setup completion, owner authority, Knight `Manage Roles`, role hierarchy, emergency state, and affected mapped roles. Blockers must be rendered in plain language and should prefer Discord role names over raw IDs.

If mapped roles still contain one or more of Ban Members, Kick Members, Moderate Members, or Manage Messages, preserve the current safe workflow: snapshot exact permission bigints, remove only the guarded mask, and compensate on failure.

If no mapped role needs a permission change, Guarded activation is a valid no-op migration:

- Owner confirmation is still required.
- The guild transitions from `TEST` to `GUARDED`.
- No meaningless role-permission snapshot is created.
- The UI says that no native moderation permissions need removal.
- Rollback from a no-op Guarded activation must return safely to `TEST` without requiring a nonexistent snapshot.

Factory reset is forbidden while Guarded is active. The owner must first use the existing Guarded rollback so Knight never destroys the snapshots needed to restore Discord permissions.

## Factory reset

Factory reset is an owner-only destructive operation that erases Knight's server-specific data while preserving Discord itself.

The reset must preserve:

- Discord roles, channels, members, webhooks, ordering, overwrites, and role permissions.
- Global Auth.js users, accounts, sessions, and verification data.
- The guild's current Discord owner identity so dashboard access can be recreated immediately.

The reset must remove Knight-owned server state, including setup progress, staff profiles/versions/assignments, Security Managers, overrides and temporary access, policy decisions and warnings, logging settings, Security Ledger history, security events/incidents, protected resources, firewall state/inventory, emergency state, Guarded categories/snapshots, backup policy, backup/recovery records, and that guild's local backup files.

Reset lifecycle:

1. Setup exposes a separate Danger Zone for the guild owner.
2. A preflight refuses reset while the guild is Guarded, while Panic or a configuration-blocking Lockdown is active, while backup/recovery work is active, or while another reset is active.
3. The owner must type a strong confirmation phrase such as `RESET KNIGHT` and check a separate acknowledgement that Knight data and local backups will be permanently erased while Discord structure is left alone.
4. The web service queues a durable reset job; it does not mount or delete worker backup files itself.
5. The worker claims the reset job and acquires guild-scoped exclusivity so backup/recovery work cannot overlap.
6. The worker removes the guild backup directory, then clears database state in an intentional transaction rather than relying on cascading deletion of the guild row.
7. The transaction leaves/recreates the minimal fresh state: current owner, mode `OBSERVE`, setup step `WELCOME`, and empty completed steps.
8. The current operational reset job may remain long enough to report `COMPLETED` or `FAILED`; it is not treated as retained server configuration/history.

The flow must be idempotent. Retrying a partially completed reset must finish safely without recreating deleted configuration or touching Discord structure. A failed file cleanup or failed database reset must never be displayed as a successful factory reset.

## Logging settings model

Extend the existing guild logging settings instead of creating parallel per-category settings tables.

Each guild can independently configure:

- Security destination: nullable Discord text channel.
- Moderation destination: nullable Discord text channel.
- Messages destination: nullable Discord text channel.
- Voice destination: nullable Discord text channel.
- Store deleted message content when available: boolean.

Any destination may be Disabled. Multiple categories may intentionally point at the same channel. Saving a destination must validate that the channel belongs to the guild and Knight can send to it.

Setup readiness treats explicitly saved logging settings as configured even when one or all destinations are Disabled.

Backup/recovery structural metadata must include all four logging channel references so recovery can remap recreated channels consistently.

## Event routing

Keep the Security Ledger as the durable event store. Route notifications by category while persisting structured metadata.

- **Security:** role/channel configuration changes, bot/webhook events, firewall actions, Guarded changes, emergency changes, and protection changes.
- **Moderation:** Knight warn/timeout/kick/ban/unban/purge operations and attributable native moderation events.
- **Messages:** single deletes, bulk deletes, and related message-moderation metadata.
- **Voice:** voice join, leave, channel move, server mute/unmute, and server deafen/undeafen.

Discord notification messages should be human-readable and generated from structured records. They must escape mentions and stay within Discord-safe message lengths. Notification delivery remains best-effort after durable persistence.

## Deleted-message logging

Add `GuildMessages` intent and message deletion listeners. Support single and bulk deletion.

Persist, when known:

- guild, channel, and message IDs;
- author user ID;
- event timestamp;
- attachment metadata/count;
- deleted content when the per-guild setting is enabled and content is actually available;
- deletion actor only when attribution is trustworthy.

Knight must never invent a deleter. When attribution is unavailable, the actor remains unknown. When message content was not supplied/cached, record `content unavailable` semantics instead of pretending the message body was captured.

Deleted message content must be mention-safe in Discord notifications and truncated for presentation. The durable ledger should enforce a sensible hard cap on stored text so an abusive payload cannot create unbounded storage growth.

Bots and webhooks may be logged, but Knight must avoid obvious recursive self-log loops.

## Voice logging

Add `GuildVoiceStates` intent and record only useful operational transitions:

- join a voice channel;
- leave a voice channel;
- move between voice channels;
- server mute/unmute;
- server deafen/undeafen.

Record the member and old/new channel IDs where applicable. Do not emit logs for voice-state updates where no supported meaningful field changed. Client-side self-mute/self-deafen churn is intentionally out of scope for this pass.

## Message-content capability

Message metadata logging and message-content retention are separate capabilities.

The bot must always be able to record deletion metadata with the normal message intent. Actual deleted text requires Discord's privileged Message Content intent and the operator runtime flag.

Fix the current Docker Compose propagation gap by forwarding the existing message-content capability environment variable to the services that need it, or introduce a clearer replacement while retaining backward compatibility. Update `.env.example` and setup documentation.

The dashboard must display whether content capture is operational. If the per-guild setting requests content retention but the runtime capability is missing, show a clear warning and continue metadata-only logging.

## Dashboard UX

Keep the current dark Discord-like direction and responsive shell. Improve information architecture and controls rather than replacing the frontend stack.

Normal views should prioritize plain-language status and recommended actions. Raw Discord IDs, migration IDs, and permission bigints belong in optional Advanced/troubleshooting details.

### Overview

Show setup progress, current mode, logging status for all four categories, backup status, emergency state, Staff Profile count, and active blockers. Each status card should have one obvious next action.

### Setup

Present setup as a visible sequence: Health → Staff → Policies → Logging → Protection → Backups → Review. Each step explains why it matters, what Knight checked, what is complete, and what still blocks progress.

Replace generic disabled controls with explicit blocker text and direct links to the page that resolves each blocker.

### Observe, Test, Guarded

Explain modes in user terms:

- Observe: Knight watches and records while native Discord moderation remains available.
- Test: staff practice Knight-routed moderation while native permissions remain available.
- Guarded: Knight removes selected native moderation permissions from mapped staff roles so those actions must pass through Knight policy.

The Guarded readiness card must separately show setup completion, owner confirmation authority, Manage Roles, role hierarchy, emergency availability, and affected-role state. The checkbox controls explicit confirmation; readiness blockers are not hidden behind the checkbox.

### Logging

Render four understandable category cards with examples of events each category receives. The Messages card also contains the deleted-content retention toggle and a visible runtime capability indicator.

### Logs

Retain filtering but improve readability with category/severity badges, friendly action labels, readable timestamps, actor/target presentation, and expandable structured metadata. Raw JSON should not dominate the default view.

### Staff Profiles

Keep the existing capability and rate-limit model. Add short descriptions to internal action identifiers and clearly distinguish Discord role mapping from Knight authority: manually granting a mapped Discord role does not create a Knight staff assignment.

### Security, Protected, Recovery

Explain risky controls before the user acts. Firewall modes need concise Observe/Alert/Enforce examples. Protection levels need plain-language consequences. Recovery must emphasize preview-first behavior and clearly label owner-only destructive execution.

### Danger Zone

Factory Reset lives at the bottom of Setup in a visually separated Danger Zone. Its first action reveals the confirmation form rather than resetting immediately.

The confirmation area explicitly lists what Knight erases and states that Discord roles, channels, members, webhooks, and permissions are untouched. If Guarded is active or another preflight condition blocks reset, show the required fix instead of a dead submit button.

### Controls and feedback

Use a small existing-style control system: Primary for the recommended next action, Secondary for neutral/reversible actions, and Danger for destructive actions. Do not add a UI library.

Disabled important/destructive controls must have nearby explanatory text. Server-action failures and successes should be rendered in-page so failures do not look like ignored clicks. Preserve responsive navigation and visible keyboard focus.

## Acceptance criteria

### Backup command deployment

- Current command definitions and router behavior remain the source of truth.
- After rebuild, Discord exposes `/backup create` and `/backup status`.
- Startup/registration tests and Docker smoke verification prove the running image matches source.

### Guarded

- Plain-language blockers replace ambiguous disabled-button behavior.
- Role names are preferred over raw IDs.
- Real migrations preserve exact snapshots and compensation behavior.
- Zero-change migrations can still enter Guarded with owner confirmation and without fake snapshots.
- Rollback handles both real and no-op Guarded activations.
- Factory reset cannot run while Guarded is active.

### Factory reset

- Owner-only with confirmation phrase and acknowledgement checkbox.
- Refuses unsafe concurrent/emergency/Guarded states.
- Worker owns backup-file deletion and reset execution.
- Reset removes all agreed Knight guild configuration/history and local backup files.
- Discord structure and global authentication data remain untouched.
- Fresh state is owner-preserved, `OBSERVE`, `WELCOME`, no completed setup steps.
- Retry is idempotent and partial failure is never reported as success.

### Four-category logging

- Security, Moderation, Messages, and Voice each have independent nullable destinations.
- Categories may share the same destination.
- Channel membership and sendability are validated.
- Existing Security and Moderation flows remain functional.
- Backup/recovery metadata remaps all four channel references.

### Deleted messages and voice

- Single and bulk deletes are supported.
- Deleted-message metadata is durable even when content is unavailable.
- Content retention obeys the guild toggle and runtime Message Content capability.
- Deletion attribution is recorded only when trustworthy.
- Mention-safe and length-safe Discord notifications are required.
- Stored message content has a hard size cap.
- Voice join/leave/move/server mute/server deafen transitions are durable and routed to Voice.
- Irrelevant voice-state churn does not create log spam.

### Dashboard

- Overview provides useful server status and next actions.
- Setup has understandable steps and blockers.
- Guarded readiness and confirmation are visually distinct.
- Logging exposes four categories and message-content capability status.
- Factory reset has a clearly separated Danger Zone.
- Primary/Secondary/Danger styling is consistent.
- Important disabled controls explain why.
- Server-action feedback is visible.
- Normal views favor Discord names over raw IDs.
- Existing responsive and keyboard-accessible behavior remains.

### Deployment configuration

- Preserve `restart: "no"` for bot, web, and worker.
- Forward the message-content capability environment variable to required services.
- Update `.env.example` and operator docs for the Discord Developer Portal Message Content intent.
- Do not expose secrets in UI, tests, logs, documentation examples, commits, or support output.
- Documentation should warn that `docker compose config` expands environment values and should not be pasted publicly.

## Testing strategy

Follow the repository's existing Vitest/TDD style and add focused tests around behavior rather than broad snapshots.

Required coverage includes:

- command registration still includes backup subcommands;
- Guarded no-op activation and rollback;
- Guarded blocker explanations and role-name presentation;
- factory-reset authorization, confirmation, eligibility, idempotency, and failure handling;
- database reset behavior without deleting the root guild or Auth.js records;
- logging repository persistence for four destinations and content-retention setting;
- SecurityRecorder routing for all four categories plus mention-safe formatting;
- native message-delete and voice-state listeners;
- message-content unavailable behavior;
- backup/recovery remapping for all four logging destinations;
- dashboard/server-action validation and user-visible feedback;
- Compose/config coverage for the message-content environment flag where deployment tests already exist.

Before completion, run the full repository test suite plus the existing build/typecheck/lint checks, then run Docker Compose build/smoke validation. Verify bot startup, web readiness, and actual Discord command registration from the rebuilt image.

## Explicit non-goals

Do not rewrite authentication, moderation authorization, storage architecture, backup format, or the frontend framework. Do not add cloud backups, a generic event bus, a component library, message-edit logs, invite logs, nickname/avatar history, reaction logging, or exhaustive Discord audit coverage in this pass.

Do not change Discord roles/channels during factory reset. Do not weaken existing durable-ledger, permission-snapshot, recovery-checkpoint, or fail-closed authorization guarantees for implementation convenience.

## Expected operator flow after implementation

A server owner can factory-reset Knight, return to a fresh Observe/Welcome setup, configure staff and policies, select four logging destinations, enable deleted-content retention when the runtime supports it, configure protection/backups, complete setup, enter Test, validate moderation/logging behavior, and finally enter Guarded with an explicit readiness checklist and owner confirmation.

## Implementation boundary

Codex should work incrementally inside the existing framework. It must inspect and follow current service/repository patterns before editing, avoid unrelated refactors, preserve all user changes already present in the worktree, and never overwrite the manual Docker restart-policy change.

If implementation reveals a conflict between this design and an existing durability/safety invariant, preserve the invariant and report the conflict rather than silently weakening it.

<!-- End of approved design. -->
