# Local Security Platform Completion Design

**Date:** 2026-09-11
**Status:** Approved
**Repository:** `CodWasTaken/Knight`
**Target branch:** `feature/security-platform-completion`

## 1. Goal

Finish the currently missing Knight security-platform areas without turning the project into a distributed system.

Knight will be deployed on one local machine with Docker Compose. PostgreSQL remains the durable source of truth, Redis remains ephemeral coordination state, and backup/archive files live on a local persistent Docker volume.

The implementation should make every setup step truthful and usable:

`WELCOME → HEALTH → STAFF → POLICIES → LOGGING → PROTECTION → BACKUPS → OBSERVE → COMPLETE`

Observe/Test/Guarded remains a separate security-mode state machine.

## 2. Simplicity constraints

Do not add S3, cloud queues, Kafka, external workers, service meshes, multi-region support, or distributed leases.

Do not add generic plugin systems, workflow engines, policy DSLs, or event buses. Use small typed services and direct repository calls.

Prefer one table per durable concept, one local worker loop, and one local filesystem storage adapter.
## 3. Logging and Security Ledger

Add a PostgreSQL `security_ledger` table with guild ID, timestamp, severity, source, action, actor, target, decision/incident references, JSON metadata, previous hash, and entry hash.

Ledger writes are append-only through one repository/service. Hash chaining is per guild. If notification delivery fails, the ledger entry remains authoritative.

Add guild logging settings with two optional existing Discord text-channel IDs:

- Security notifications.
- Moderation notifications.

The dashboard gets a simple Logging page with channel selectors and explicit `Disabled` choices. Knight validates guild ownership and send/view capability before saving.

Moderation actions, Staff Profile/config changes, Guarded transitions, containment actions, backup/restore jobs, and native security events write ledger records.

A Logs page shows recent entries with simple filters for source, action, severity, actor, and target. No search index or analytics database is needed.

## 4. Security events and incidents

Add a normalized `security_events` table for important Discord-native or Knight-originated changes.

The bot listens only to security-relevant Discord events and uses audit-log lookup where Discord exposes it. If attribution cannot be established safely, store actor as unknown rather than guessing.

Existing Redis execution-correlation records identify Knight-originated Discord writes so Knight does not report itself as an attacker.
Incidents stay intentionally simple: related suspicious events are grouped by guild, actor, and short time window with a severity and lifecycle of `ACTIVE`, `CONTAINED`, or `RESOLVED`.

No machine learning, behavioral profiling, or complex rules engine is included in this slice.

## 5. Protected resources

Add a `protected_resources` table for three resource types initially:

- User.
- Role.
- Channel/category.

Each resource has one level: `IMPORTANT`, `CRITICAL`, or `IMMUTABLE`. Unlisted resources are normal.

Protection is checked by the same moderation/security execution paths before mutations. The guild owner is always protected. `IMMUTABLE` blocks ordinary staff mutation; owner-only recovery/configuration paths may still operate when explicitly confirmed.

The dashboard gets a small Protected Resources page for adding/removing existing Discord objects and choosing a level.

## 6. Bot and webhook firewall

Store a small guild-level mode for each firewall: `OBSERVE`, `ALERT`, or `ENFORCE`.

Maintain inventories of known bot IDs and webhook IDs plus a trust state: `TRUSTED`, `APPROVED`, `UNKNOWN`, or `BLOCKED`.

In Observe, Knight only records changes. In Alert, it also sends a security notification. In Enforce, only explicitly blocked/forbidden entries are removed when Knight can do so safely.

Unknown bots or webhooks are never automatically deleted by default.
## 7. Lockdown and Panic

Add durable guild security state with `NORMAL`, scoped `LOCKDOWN`, and `PANIC`.

Lockdown uses a small fixed set of scopes: member moderation, roles, channels, bots/webhooks, security configuration, or full.

The central authorization path checks the active security state before allowing privileged Knight operations. Restrictions always beat ordinary grants.

Panic is owner/Security-Manager controlled, records an emergency ledger entry, blocks privileged Knight actions except recovery/status operations, and sends a security notification when configured.

For this local-first version, Panic does not attempt broad automatic role stripping or server-wide destructive rewrites. It is primarily a reliable privilege freeze plus incident marker.

Discord commands and dashboard controls provide status, lockdown, unlock, panic, and clear-panic operations with explicit confirmation for Panic.

## 8. Local backups and recovery

Use a named Docker volume mounted into the worker and web/bot where needed, for example `/data/knight-backups`.

Backup metadata lives in PostgreSQL. Snapshot payloads are compressed JSON files on the local volume with a SHA-256 integrity hash.

A structural backup captures supported guild state: roles, role ordering, channels/categories, permission overwrites, selected supported guild settings, and Knight configuration needed for recovery.
Selected-channel message archival is optional and disabled by default. If enabled, it requires Message Content intent and stores only configured channels in local compressed files.

Restore is preview-first. Knight classifies each operation as `REVERT`, `RECREATE`, `ARCHIVE_ONLY`, or `NOT_RECOVERABLE`, validates hierarchy/manageability, then requires owner confirmation before writes.

Recovery executes sequentially in dependency order. A simple PostgreSQL job row records status and checkpoint; the existing worker polls pending local jobs. No external queue is introduced.

A single guild recovery lock prevents overlapping restore jobs. Redis can hold the short-lived lock because PostgreSQL still records durable job state.

## 9. Setup wizard behavior

Replace blind setup advancement with readiness checks for the steps that now have real configuration.

- `HEALTH`: doctor prerequisites must be healthy.
- `STAFF`: at least one enabled valid Staff Profile.
- `POLICIES`: enabled profiles must have saved action policies.
- `LOGGING`: owner must save logging settings, including an explicit disabled choice.
- `PROTECTION`: owner must save protection/firewall settings, even if all are Observe/off.
- `BACKUPS`: owner must save a backup policy, including an explicit disabled choice.
- `OBSERVE`: readiness summary must have no blocking configuration errors.

Setup completion does not automatically change Observe/Test/Guarded mode.

## 10. Dashboard

Keep the UI flat and operational. Extend the guild navigation with:

- Security: state, incidents, protected resources, bot/webhook firewall.
- Logs: recent Security Ledger entries.
- Recovery: backup policy, backups, restore previews/jobs.
- Settings/Logging: notification channels.
Do not build analytics dashboards, charting systems, or a generic administration framework. Each page should answer one operational question and reuse current guild authorization.

## 11. Discord command surface

Add only the commands needed when the dashboard is unavailable:

```text
/security status
/security lockdown scope:<scope> reason:<text>
/security unlock reason:<text>
/security panic reason:<text>
/security panic-clear reason:<text>
/backup create
/backup status
```

Restore remains dashboard-first because previews are easier to review safely there.

Existing moderation/staff/setup/doctor commands remain unchanged except for ledger hooks and security-state enforcement.

## 12. Backup policy

Backup policy has only three modes: `DISABLED`, `MANUAL`, or `DAILY`.

Daily means the existing worker checks for due guilds and creates one snapshot. No cron service is added.

Optional message archive settings contain selected channel IDs and a maximum messages-per-channel cap. Default is 1000. Message archival is never enabled implicitly.

Archived messages are evidence only in this version; restore does not impersonate users or automatically replay deleted messages.
## 13. Failure behavior

Security ledger persistence is attempted before best-effort Discord notifications.

If PostgreSQL is unavailable, destructive Knight actions continue to fail closed as they do today. Notification failure does not roll back an otherwise valid durable action record.

Native-event listeners must never perform destructive containment unless the relevant firewall/security mode is explicitly `ENFORCE` or `PANIC` and the action is covered by a tested rule.

Backup creation failure marks the job failed without deleting the previous good backup. Restore failure stops at the current checkpoint and records exactly what completed.

Filesystem paths are generated by Knight from guild/job IDs; user input never becomes an arbitrary host path.

## 14. Testing and verification

Use TDD for each slice.

Required coverage includes ledger hash chaining, guild isolation, notification failure, event attribution, Knight execution correlation, protected-resource precedence, firewall modes, lockdown/panic precedence, backup integrity, restore previews, checkpoint resume, and setup gating.

Use disposable PostgreSQL and Redis services. Discord-destructive behavior is tested with fake adapters unless an explicitly disposable guild resource is used.

Each implementation slice must pass repository lint, typecheck, tests, build, `git diff --check`, Docker build/runtime imports, and Compose health before its commit series is considered complete.

## 15. Explicit non-goals

This completion project does not add behavioral ML, risk scoring, approval workflows, temporary grants, raid message analysis, cloud storage, multi-host workers, automatic full-server reconstruction, or a generic rules language.

Those can be separate projects after the core security loop is real and stable.
## 16. Implementation order

Implement in four independently verifiable slices:

1. Logging settings + Security Ledger + Logs UI + ledger hooks.
2. Security events + incidents + protected resources + bot/webhook firewall.
3. Lockdown/Panic state + commands + dashboard + authorization enforcement.
4. Local backup/archive + worker jobs + restore preview/execution + real setup gates.

Database migrations are additive. Existing guilds default to safe neutral settings: notifications disabled, protection/firewalls Observe, security state Normal, backups disabled.

No slice should expose a dashboard control before its backend behavior and persistence are implemented and tested.

## 17. Success criteria

A fresh local installation can complete every setup step without encountering a placeholder.

The owner can configure logging destinations, inspect durable security history, protect important Discord resources, observe or enforce bot/webhook rules, freeze privileged actions with Lockdown/Panic, create and verify local backups, preview structural recovery, and execute only supported restore operations.

Knight continues to run on the existing local Docker Compose architecture and remains understandable to a single self-hosting operator.
## 18. Exact first-pass Discord coverage

The native-event layer initially records role create/update/delete, channel/category create/update/delete, member ban/unban, bot-member joins, and webhook-update signals.

When audit-log attribution is available, Knight attaches the actor and audit entry. When it is not, the event remains unattributed.

No message-content scanning, voice-event monitoring, invite monitoring, AutoMod management, or broad member-activity tracking is added in this project.

Core moderation continues to use `Guilds`, `GuildMembers`, and `GuildModeration`; native webhook-update coverage additionally requires the non-privileged `GuildWebhooks` intent. Message Content is added only when the owner explicitly enables selected-channel archival.

## 19. Exact structural backup scope

Structural backups capture non-managed Discord roles, their permissions and ordering, categories/text channels, parent/position relationships, channel permission overwrites, and Knight-owned configuration from PostgreSQL.

Managed/integration roles are recorded for reference but never recreated or arbitrarily edited.

Restore updates surviving objects by original Discord ID. Missing non-managed roles/channels may be recreated, with old-to-new ID mappings stored in restore-job metadata so dependent overwrites can be rebuilt safely.

Message archives are evidence-only and are never replayed automatically.

## 20. Implementation correction: webhook Gateway intent

The installed Discord API types expose webhook update delivery behind `GatewayIntentBits.GuildWebhooks`. Add that non-privileged intent for the webhook-update signal described above. `MessageContent` remains disabled unless the owner explicitly enables selected-channel message archival.
