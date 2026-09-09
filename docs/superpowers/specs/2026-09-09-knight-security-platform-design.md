# Knight Security Platform Design

**Date:** 2026-09-09  
**Status:** Approved design  
**Repository:** `CodWasTaken/Knight`

## 1. Purpose

Knight is a self-hosted Discord security platform focused on preventing staff abuse and server nuking, detecting destructive native Discord actions, containing attackers, preserving evidence, and restoring recoverable server state.

Knight's product identity is:

> **The security layer between Discord staff and destructive administrative power.**

The first release must prioritize a complete security loop:

**Prevent → Detect → Attribute → Contain → Preserve → Recover → Explain**

Knight is not intended to become a general-purpose entertainment or economy bot in v1.

## 2. Product goals

Knight must:

- Be self-hosted only.
- Allow one Knight deployment to protect multiple Discord guilds with isolated configuration and data.
- Provide both a Discord-first operational interface and a full web dashboard from the first usable release.
- Use custom Staff Profiles instead of hard-coded moderator tiers.
- Allow owners to define exactly which actions each Staff Profile may perform and exactly what rate limits, risk budgets, target rules, and approval requirements apply.
- Support Guarded Permissions, where staff use Knight for moderation instead of holding the underlying destructive Discord permissions.
- Detect native Discord bypasses and destructive actions performed outside Knight.
- Correlate mixed destructive actions into incidents rather than relying on simple single-action counters.
- Provide protected users/resources, bot and webhook firewalls, lockdowns, panic mode, and raid protection.
- Maintain a durable, tamper-evident Security Ledger.
- Provide structural backups, selected-channel history archives, incident recovery, and point-in-time recovery planning.
- Explain every allow/deny/approval decision in human-readable terms.
- Provide beginner-friendly installation and setup documentation from creating the Discord application through enabling Guarded Permissions.
- Be easy to self-host with Docker Compose while also supporting distributed/cloud deployment patterns.

## 3. Non-goals for v1

The following are explicitly out of scope for v1:

- Music.
- Economy or leveling.
- Giveaways.
- Tickets.
- AI chatbot functionality.
- AI-driven automatic moderation or quarantine decisions.
- General-purpose custom commands.
- A hosted Knight SaaS.
- Billing or premium tiers.
- Plugin marketplace or public extension ecosystem.

AI, if introduced later, may summarize incidents, explain logs, or suggest policy adjustments, but must not autonomously decide that a staff member is malicious.

## 4. Technology stack

Knight uses:

- TypeScript.
- Node.js.
- `discord.js` for the Discord bot and Gateway integration.
- Next.js + React for the web dashboard.
- Drizzle ORM.
- PostgreSQL as the durable source of truth.
- Redis for ephemeral counters, locks, caches, cooldowns, and distributed coordination.
- Docker Compose as the reference deployment.
- A monorepo with shared packages so bot and dashboard use the same security logic.

## 5. Monorepo architecture

```text
Knight/
├── apps/
│   ├── bot/                 # discord.js bot + Gateway listeners
│   ├── web/                 # Next.js dashboard + Discord OAuth
│   └── worker/              # backup/recovery/background jobs
│
├── packages/
│   ├── security/            # policy, authorization, risk, incidents
│   ├── database/            # Drizzle schema, queries, migrations
│   ├── redis/               # counters, locks, ephemeral state
│   ├── discord/             # Discord adapter and action layer
│   ├── contracts/           # schemas/types/shared API contracts
│   ├── config/              # environment/runtime config
│   ├── logging/             # app logs + Security Ledger helpers
│   └── ui/                  # reusable web UI components
│
├── docs/
│   ├── setup/
│   ├── staff/
│   ├── security/
│   ├── backups/
│   ├── dashboard/
│   ├── deployment/
│   └── troubleshooting/
│
├── docker/
├── docker-compose.yml
└── ...
```

### 5.1 Bot responsibilities

The bot:

- Receives Gateway and audit-log events.
- Runs slash commands and interaction UI.
- Executes Guarded moderation actions only after authorization.
- Performs containment and selected recovery actions.
- Runs the Discord setup flow.

The bot must not contain duplicated policy logic. It calls the shared `packages/security` engine.

### 5.2 Dashboard responsibilities

The web app:

- Uses Discord OAuth only for identity.
- Shows guilds the signed-in user is authorized to manage in Knight.
- Allows owners and explicitly authorized Knight Security Managers to configure Knight.
- Uses the same shared contracts and security rules as the bot.
- Re-checks current Knight authorization for sensitive actions instead of treating a session as permanently privileged.

Native Discord `Administrator` alone does not automatically grant Knight dashboard security access.

### 5.3 Worker responsibilities

The worker handles:

- Structural backups.
- Selected-channel history archival.
- Attachment archival.
- Restore/recovery jobs.
- Retention cleanup.
- Expired temporary grants/restrictions.
- Behavioral-baseline calculations.
- Scheduled security scans and reconciliation.
- Large exports.

Large background jobs must not block the Discord Gateway process.

## 6. Data ownership: PostgreSQL vs Redis

PostgreSQL is authoritative for durable security state, including:

- Guild configuration.
- Staff Profiles and versions.
- Staff assignments.
- Permission and action policies.
- Risk policies.
- Protected assets.
- Security managers.
- Approvals.
- Incidents and notes.
- Security Ledger entries.
- Moderation cases.
- Backups and restore history.
- OAuth/session records.
- Behavioral baselines.

Redis stores disposable operational state, including:

- Rate-limit counters.
- Risk-window counters.
- Short-lived execution correlation records.
- Temporary distributed locks.
- Incident correlation windows.
- Cooldowns.
- Ephemeral caches.

Redis must never be the only place an important security policy exists. A Redis flush must not destroy configuration or historical evidence.

## 7. Security invariants

The implementation must preserve these invariants:

1. **Fail closed for destructive Guarded actions.** If Knight cannot determine current policy, a destructive Guarded operation is denied.
2. **One canonical policy engine.** Bot and dashboard cannot implement independent authorization behavior.
3. **Discord role membership is not authority.** Knight's database assignment is authoritative; mapped Discord roles represent staff identity.
4. **No self-escalation.** Users cannot directly or indirectly increase their own effective security authority.
5. **Restrictions beat grants.** Lockdowns, quarantine, protected-target rules, and temporary restrictions override ordinary grants.
6. **The owner retains ultimate Knight authority.** Certain destructive security-configuration actions remain owner-only.
7. **Anomaly detection is advisory-only.** Behavioral anomaly alone cannot automatically quarantine, ban, or trigger panic mode.
8. **Evidence is append-oriented.** Historical security data is preserved; false positives are marked, not erased.
9. **Knight-generated mutations are correlated.** Recovery and containment actions must not cause Knight to interpret itself as an attacker.
10. **Recovery never overclaims.** Recreated resources/messages are documented as new Discord objects where the original cannot be restored.

## 8. Canonical action vocabulary

Knight uses canonical action IDs rather than ad hoc permission names. Initial categories include:

```text
member.warn
member.warning.view
member.warning.remove
member.timeout
member.timeout.remove
member.kick
member.ban
member.unban
member.mass_ban

message.delete
message.purge
message.purge_member
message.purge_channel

role.assign
role.remove
role.create
role.update
role.delete
role.permissions.update

channel.create
channel.update
channel.delete
channel.lock
channel.permissions.update

voice.move
voice.disconnect
voice.mute
voice.deafen

bot.request
bot.approve
bot.remove

webhook.create
webhook.update
webhook.delete

invite.create
invite.revoke

automod.create
automod.update
automod.delete

security.view
security.incidents.view
security.incidents.resolve
security.staff.assign
security.staff.remove
security.staff.manage_profiles
security.policy.view
security.policy.edit
security.protection.manage
security.approvals.approve
security.lockdown
security.panic
security.backup.create
security.backup.restore
```

The catalog is extensible and versioned.

## 9. Staff Profiles and Guarded Permissions

### 9.1 Staff Profiles

Owners create arbitrary Staff Profiles such as Trial Moderator, Moderator, Senior Moderator, Administrator, or Security Administrator. Names are not hard-coded.

Each Staff Profile contains:

- Guild ID.
- Name and description.
- Mapped Discord role ID.
- Knight hierarchy rank.
- Enabled state.
- Allowed/denied canonical permissions.
- Per-action policies.
- Target policies.
- Risk budgets.
- Approval rules.
- Version history.

### 9.2 Staff assignments

`/staff assign` creates a durable Knight staff assignment and adds the mapped Discord role when Knight can manage it.

`/staff remove` disables the assignment, removes the mapped role, revokes temporary grants, cancels pending elevated access, and keeps historical records.

Knight assignment is authority; Discord role membership alone is not.

### 9.3 Role synchronization modes

Per guild/profile, Knight supports:

- **Monitor:** alert only.
- **Repair:** restore missing mapped roles for valid assignments.
- **Enforced:** Knight is authoritative and may remove unauthorized mapped-role assignments.

Observe/Test should default to Monitor. Guarded mode may recommend Enforced.

### 9.4 Hierarchy and target rules

Profiles have an internal Knight rank. By default, staff may only use Knight moderation actions against lower-ranked targets.

Target evaluation also considers:

- Discord role hierarchy.
- Protected-user status.
- Unregistered users who hold elevated Discord roles.

A missing Knight assignment must not cause a highly privileged Discord user to be treated as an ordinary member.

### 9.5 Per-user overrides and temporary access

Effective access is computed from:

```text
Profile defaults
+ User overrides
+ Temporary grants/restrictions
+ Current emergency security state
= Effective policy
```

Knight supports:

- Per-user permission overrides.
- Per-user limit overrides.
- Temporary permission grants.
- Temporary restrictions.
- Temporary limit increases/decreases.
- Probation overlays.

The dashboard must expose an understandable **Effective Permissions** view.

### 9.6 No self-escalation and grant ceilings

A user cannot:

- Promote themselves.
- Increase their own limits.
- Grant themselves permissions.
- Remove restrictions affecting themselves.
- Approve their own elevated request.
- Change a profile that governs them in a way that increases their effective authority.

Profile-management permissions must have grant ceilings. An actor cannot create, assign, or edit authority beyond what they are allowed to administer.

### 9.7 Security Managers

Security Managers are explicitly authorized Knight principals. Native Discord `Administrator` does not automatically make a user a Security Manager.

The guild owner is always an ultimate authority. A small set of operations remains owner-only, including fully disabling protection and resetting/overriding security-manager control.

## 10. Guarded Permissions migration

Knight uses a staged migration:

### Observe

Knight monitors existing native staff activity, calculates policy outcomes, builds baselines, and recommends configuration. It does not remove permissions or automatically contain staff.

### Test

Staff can use Knight moderation commands while retaining native Discord permissions. Knight compares Knight-routed and native actions and identifies likely Guarded bypasses or policy mismatches.

### Guarded

After explicit owner approval, Knight snapshots current mapped-role permissions and removes only the selected native destructive permissions. Staff then perform those actions through Knight.

Owners can guard permission categories incrementally, such as member moderation first and structural permissions later.

Every migration must show a preview, affected roles/users, exact native permissions being removed, and rollback availability.

## 11. Policy engine

The security engine is a pure decision layer where practical. Given actor, requested action, target, guild state, profile version, counters, and security state, it returns a structured decision:

- `ALLOW`
- `DENY`
- `REQUIRE_APPROVAL`
- `CONTAIN` for detected native/security events where intervention is required

Every decision includes structured reasoning, such as:

- Permission matched.
- Limit/window used.
- Current usage.
- Protected-target rule.
- Current risk budget.
- Lockdown state.
- Approval rule.
- Policy/profile version.

The system must be able to explain every decision later.

## 12. Rate limits and risk budgets

### 12.1 Multiple rate windows

Each action may have multiple simultaneous windows, e.g.:

```text
member.ban
2 / 10 seconds
5 / 30 minutes
15 / 24 hours
```

All active windows must pass.

Limits have explicit states: Disabled, Limited, or Unlimited. Unlimited is never represented in user-facing logic by a magic numeric value.

### 12.2 Cross-action risk budgets

Actions contribute configurable risk points. Profiles may have risk budgets over multiple windows, allowing Knight to catch mixed attacks that do not exceed any individual action threshold.

Example:

```text
channel delete      +25
role delete         +20
webhook create      +10
2 bans              +16
```

The cumulative total can trigger containment even if each individual action stayed below its own count limit.

### 12.3 Contextual risk modifiers

Risk can be modified by:

- Protected target/resource level.
- Staff target vs ordinary member.
- Newly promoted/probation state.
- Native Guarded bypass.
- Rapid sequences.
- Maintenance windows.
- Active raid state.
- Lockdown state.
- Advisory anomaly score.

## 13. Security Events and incident correlation

All relevant Discord/Gateway/audit actions normalize into a `SecurityEvent` with actor, action, target, source, before/after state, risk, audit-log reference, Knight execution reference, and optional incident ID.

Sources include:

- Knight Guarded action.
- Native Discord action.
- Knight internal containment/recovery action.
- Reconciliation-discovered change.

Related events are correlated into incidents using actor, target/resource relationships, time windows, and deterministic attack patterns.

Built-in patterns include:

- Self privilege escalation.
- Bot-assisted nuke.
- Security-disable sequence.
- Mass structural destruction.
- Staff purge.
- Permission takeover.
- Webhook attack.
- Slow nuke.

Incident severities:

- INFO
- LOW
- MEDIUM
- HIGH
- CRITICAL
- EMERGENCY

Incident lifecycle:

- DETECTING
- ACTIVE
- CONTAINED
- RECOVERING
- RESOLVED
- FALSE_POSITIVE

## 14. Containment and emergency controls

### 14.1 Response ladder

Knight supports configurable escalation:

1. Log.
2. Warn.
3. Block Guarded actions.
4. Security restrict.
5. Strip dangerous manageable roles.
6. Quarantine.
7. Guild lockdown.
8. Panic mode.

Automatic staff bans are not the recommended default. Restriction/quarantine is safer for potentially compromised accounts.

### 14.2 Quarantine and chain containment

Quarantine snapshots manageable staff roles, removes dangerous roles, applies Knight's quarantine state/role where configured, revokes temporary grants, cancels pending approvals, and denies privileged Knight commands.

Attempts by another staff member to restore a quarantined user's dangerous authority are blocked/reverted where possible and attached to the same incident.

### 14.3 Lockdown modes

Granular modes include:

- Member moderation lock.
- Structural lock.
- Role lock.
- Channel lock.
- Bot lock.
- Webhook lock.
- Security-config lock.
- Full lock.

### 14.4 Panic mode

Panic mode is an emergency privileged-activity freeze. It takes an emergency snapshot, freezes Guarded destructive actions, revokes temporary elevation, blocks bot/webhook approvals and structural changes, alerts authorized responders, contains identified attackers, and prepares recovery.

Panic mode is not designed to blindly destroy every staff role.

## 15. Protected resources

Knight supports protection levels:

- Normal.
- Important.
- Critical.
- Immutable.

Protected objects include:

- Users.
- Staff profiles/roles.
- Channels/categories.
- `@everyone` permission state.
- AutoMod rules.
- Bots/integrations.
- Security logging resources.
- Quarantine configuration.

`Immutable` means Knight policy requires the strongest authorized path/approval; it does not mean the Discord object is physically impossible to change.

## 16. Behavioral anomaly detection

Behavioral detection is advisory-only in v1.

Knight may aggregate administrative behavior such as:

- Action frequency.
- Action categories.
- Typical active hours.
- Typical resource areas.
- Sudden privilege usage.
- Rapid destructive activity after promotion.

Knight must not need invasive message-content profiling, device fingerprinting, location inference, or personality inference for staff anomaly detection.

Anomaly scores may increase risk, raise alerts, or cause an action to require additional approval, but anomaly alone cannot automatically quarantine, ban, or trigger panic mode.

## 17. Bot firewall

Newly added bots are classified as:

- TRUSTED
- APPROVED
- PENDING
- RESTRICTED
- BLOCKED

Knight records the bot/application identity, inviter, current permissions, role position, Administrator status, trust status, and timestamp.

Guild policy controls whether unknown bots are observed, alerted, restricted, removed, or blocked.

Known bots may have allowlisted permissions. If a trusted bot is later granted a forbidden permission such as Administrator, Knight treats this as bot permission escalation and may revert it and create an incident.

## 18. Webhook firewall

Knight monitors webhook create/update/delete activity and maintains a webhook inventory.

Policies control:

- Who may create/manage webhooks.
- Per-profile rate limits.
- Allowed channels.
- Protected-channel restrictions.
- Approval requirements.

Unknown or malicious webhook changes may be reverted/removed where possible and attached to incidents.

## 19. Raid protection

Knight includes focused anti-raid capability without attempting to replace all-purpose moderation bots.

V1 raid features include:

- Join-burst detection.
- Account-age rules as a heuristic.
- Bot-join bursts.
- Mention/link/repeated-message spam where Message Content access is enabled and configured.
- Newcomer restrictions.
- Verification escalation.
- Invite restrictions.
- Native AutoMod coordination and protection.
- Raid Mode.

Raid Mode protects against incoming-member attacks; Panic Mode protects against privileged/server takeover. They are independent and may run simultaneously.

Message Content intent is optional for core anti-nuke functionality. Features that depend on message content must clearly report when the privileged intent is not enabled.

## 20. Advanced logging and Security Ledger

Knight has two logging layers:

### Application logs

For startup, database/Redis failures, worker jobs, API errors, diagnostics, and performance.

### Security Ledger

For durable evidence of:

- Moderation actions.
- Policy decisions.
- Native Discord actions.
- Staff/profile changes.
- Approvals.
- Security incidents.
- Containment.
- Backups and recovery.
- Security configuration changes.

Ledger entries include actor, target, action, source, timestamps, before/after state where available, profile/policy version, decision/incident IDs, risk state, Discord audit-log ID where available, Knight execution ID, metadata, and hash-chain linkage.

The ledger is append-oriented. False positives are marked rather than deleted.

### 20.1 Tamper evidence

Ledger entries are hash chained using a cryptographic hash of the current entry plus the previous entry hash. This provides tamper evidence, not absolute immutability.

### 20.2 Discord notification channels

Discord log channels are notification surfaces only. Deleting them does not delete Knight's authoritative ledger in PostgreSQL.

## 21. Moderation cases

Warn, timeout, kick, ban, unban, and substantial purge actions may create moderation cases containing moderator, target, reason, evidence references, policy/profile version, decision ID, and risk contribution.

Moderation cases are distinct from Security Incidents but may be linked.

Reason/evidence requirements are configurable per action/profile.

## 22. Backups and recovery

### 22.1 Backup types

Knight supports:

- Full structural snapshots.
- Incremental structural snapshots.
- Emergency snapshots created at serious incident time.

### 22.2 Structural backup content

Recoverable configuration may include:

- Guild settings supported by Discord's API.
- Roles and hierarchy.
- Categories/channels and positions.
- Permission overwrites.
- Voice/forum/media configuration where supported.
- AutoMod rules.
- Emoji/sticker metadata/assets where supported.
- Knight staff/security configuration.
- Explicitly opted-in selected-channel message history.

### 22.3 Selected-channel message history

Message-history archival is disabled by default and enabled only for explicitly selected channels.

Archived records may include message IDs, author IDs/display-name snapshots, timestamps, content, embeds, attachment metadata, reply/reference metadata, and pinned state where available.

Attachment storage is configurable as metadata-only or downloaded content. Downloaded data uses a storage abstraction supporting local persistent volumes and S3-compatible object storage.

### 22.4 Resource identity mapping

Knight uses stable internal resource IDs in addition to current Discord Snowflakes. Restores maintain old-Discord-ID → Knight-resource → new-Discord-ID mappings.

### 22.5 Recovery capability classification

Every planned restore operation is classified as:

- EXACT.
- REVERT.
- RECREATE.
- ARCHIVE_ONLY.
- NOT_RECOVERABLE.

Examples:

- Existing role permission edit: REVERT.
- Deleted role: RECREATE.
- Deleted channel: RECREATE.
- Ban: REVERT through unban.
- Kick: NOT_RECOVERABLE automatically.
- Deleted archived message: ARCHIVE_ONLY / optional replay as a new message.

Knight must never claim a recreated Discord object has preserved the original Discord ID.

### 22.6 Recovery planning

Restores are previewed before execution. Knight validates role hierarchy, permissions, conflicts, storage health, dependencies, and expected consequences.

Restore order follows dependencies, broadly:

```text
Guild settings
→ Roles
→ Role hierarchy
→ Categories
→ Channels
→ Channel hierarchy
→ Permission overwrites
→ AutoMod
→ Knight protected-resource mappings
→ Optional archive replay/transcripts
```

### 22.7 Point-in-time and incident recovery

Owners can request:

- Point-in-time recovery plans.
- Selective resource restores.
- Incident-specific recovery plans.

Incident recovery uses the incident's correlated changes to generate the rollback/recreation plan.

### 22.8 Resumable jobs and locks

Recovery jobs are checkpointed and resumable. A guild recovery lock prevents conflicting structural operations during restore.

Discord writes pass through a priority/rate-limit-aware action queue so containment work is not blocked behind background archive/recovery tasks.

## 23. First-time setup and onboarding

The documentation and product wizard must follow the same beginner journey:

```text
Install Knight
→ Create/configure Discord application
→ Configure environment
→ Start services
→ Open dashboard
→ Invite Knight
→ /setup
→ Permission/hierarchy health check
→ Existing server/staff scan
→ Import or create Staff Profiles
→ Configure limits/policies
→ Configure Security Managers
→ Configure logging
→ Configure protected resources
→ Configure backups/archive options
→ Observe Mode
→ Review recommendations
→ Test Mode
→ Staff practice Knight moderation
→ Preview Guarded migration
→ Guarded Permissions
→ Final security scan
→ Protected
```

Setup progress is persistent.

### 23.1 Beginner documentation requirements

The repository must include clear guides for:

- Requirements.
- Creating the Discord application/bot.
- Finding the bot token, application/client ID, and OAuth secret.
- Configuring OAuth callback URLs.
- Required and optional Gateway intents.
- Required permissions and role hierarchy.
- Environment variables with beginner explanations.
- Docker Compose installation.
- Manual/distributed/cloud deployment.
- Inviting Knight.
- Running `/setup`.
- Importing existing staff roles.
- Creating Staff Profiles.
- Configuring rate limits/risk policies.
- Observe/Test/Guarded modes.
- Backups and recovery limitations.
- Updating Knight.
- `/doctor` diagnostics.
- Troubleshooting.

The `.env.example` must explain every variable instead of containing unexplained placeholders.

## 24. Dashboard information architecture

Primary sections:

```text
Overview

Security
├── Security Score
├── Incidents
├── Live Activity
├── Protected Resources
├── Lockdown
└── Panic Mode

Staff
├── Staff Members
├── Staff Profiles
├── Permissions
├── Limits
├── Temporary Access
└── Approvals

Policies
├── Action Policies
├── Risk Budgets
├── Attack Patterns
├── Anomaly Detection
└── Simulator

Recovery
├── Backups
├── Message Archives
├── Restore
└── Recovery History

Logs
├── Security Ledger
├── Moderation
├── Configuration
└── Exports

Server
├── Bots
├── Roles
├── Permissions
├── Webhooks
└── AutoMod

Settings
├── General
├── Discord
├── Logging
├── Storage
└── Maintenance
```

The dashboard should default to a beginner-friendly view with advanced controls expandable rather than showing every low-level policy parameter immediately.

## 25. Discord operational commands

Important security functionality remains available inside Discord, especially during incidents.

Initial command surface includes:

```text
/member warn
/member warnings
/member timeout
/member untimeout
/member kick
/member ban
/member unban
/message purge

/staff assign
/staff remove
/staff inspect
/staff grant
/staff restrict

/access request
/access approve
/access reject

/security status
/security score
/security incidents
/security incident
/security lockdown
/security unlock
/security panic

/backup create
/backup status
/restore preview

/setup
/doctor
```

Friendly top-level aliases may be added where they do not create command-management ambiguity.

## 26. Discord event and execution model

Knight uses Discord Gateway events, including audit-log entry events where available, as the primary real-time attribution path.

Native events may temporarily be marked `PENDING_ATTRIBUTION` until audit context is available. If actor attribution fails, Knight uses `UNKNOWN` rather than guessing.

Before Knight performs a destructive Discord mutation, it creates a short-lived execution correlation record containing actor/requester, action, target, and expected audit event. When Discord reports the bot's action, Knight links it back to the human requester/approver and marks it as Knight-originated.

Periodic reconciliation compares expected Knight state with actual Discord state to detect changes made during bot downtime or missed events.

## 27. Reliability and failure behavior

### 27.1 Structured errors

Operational errors use categories such as:

- `PERMISSION_DENIED`
- `ROLE_HIERARCHY_BLOCKED`
- `TARGET_NOT_FOUND`
- `DISCORD_RATE_LIMITED`
- `DEPENDENCY_UNAVAILABLE`
- `POLICY_CHANGED`
- `CONFLICT`
- `RECOVERY_PRECONDITION_FAILED`

User-facing messages explain the actionable problem while developer logs retain raw Discord/API errors.

### 27.2 Discord API scheduling

Discord writes use a priority/rate-limit-aware execution layer. Example priorities:

- P0 attacker containment.
- P1 dangerous permission revert.
- P2 bot/webhook removal.
- P3 critical recovery.
- P4 ordinary recovery.
- P5 archival/background work.

### 27.3 Graceful shutdown

Bot and worker processes must checkpoint or safely stop critical work, stop accepting new destructive operations during shutdown, flush logs, release/expire leases safely, and close dependencies cleanly.

## 28. Security hardening

Knight itself is highly privileged and must be treated as a security-sensitive application.

Requirements include:

- Secrets never committed or logged.
- `.env` ignored; `.env.example` contains placeholders only.
- Strong session secrets.
- Discord OAuth with CSRF/session protections.
- Current guild authorization rechecked for sensitive dashboard actions.
- Defense against IDOR/guild ID tampering.
- Input validation at API boundaries.
- PostgreSQL constraints for key invariants where practical.
- Redis never used as the sole authorization source.
- TLS documented for distributed deployments.
- Application-level authenticated encryption for sensitive stored secrets that truly require persistence.
- Backup/export integrity hashes.
- Health/readiness endpoints.
- Role-hierarchy health checks.

## 29. Testing strategy

Security logic requires automated verification at multiple levels.

### 29.1 Unit tests

Especially for `packages/security`, including:

- Permission allow/deny behavior.
- Hierarchy targeting.
- Protected targets.
- Multiple rate windows.
- Risk-budget accumulation.
- Restriction precedence.
- Lockdown precedence.
- Self-escalation prevention.
- Indirect self-escalation prevention.
- Approval rules.
- Probation/new-staff overlays.

Use fake clocks for time-window tests.

### 29.2 Table-driven policy tests

Large actor/action/target matrices should verify expected decisions without duplicated test boilerplate.

### 29.3 Race-condition tests

Cover cases such as:

- Two simultaneous actions competing for one remaining rate-limit slot.
- Duplicate approvals.
- Duplicate recovery workers.
- Containment during profile edits.
- Simultaneous panic/maintenance transitions.

### 29.4 Incident tests

Feed deterministic event sequences and assert correct incident correlation, attack patterns, severity, actor, and accumulated risk.

### 29.5 Recovery tests

Use a fake Discord adapter to mutate simulated guild state, generate recovery plans, execute them, and compare resulting state.

Core security logic must not depend directly on discord.js; Discord operations use an adapter/port so tests can supply a fake implementation.

### 29.6 Integration and CI

Integration tests cover PostgreSQL, Redis, migrations, repositories, jobs, API routes, and dashboard authorization boundaries.

CI should require formatting, linting, TypeScript type checking, unit tests, integration tests, migration validation, production builds, and a practical dependency/security audit.

Before releases, a private Discord test guild is used for smoke tests of Discord-specific behavior that cannot be perfectly simulated.

Every discovered security regression receives a permanent regression test.

## 30. Deployment model

### 30.1 Reference deployment

Docker Compose runs:

- Knight Bot.
- Knight Web.
- Knight Worker.
- PostgreSQL.
- Redis.

The intended beginner workflow is approximately:

```bash
git clone <repository>
cd Knight
cp .env.example .env
# configure .env
docker compose up -d
```

### 30.2 Distributed/cloud deployment

The architecture must also support separate deployment of web, bot, worker, managed PostgreSQL, managed Redis, and S3-compatible storage.

No core domain logic may depend on Docker-specific networking assumptions.

## 31. Diagnostics

Knight includes `/doctor` and a CLI equivalent.

Diagnostics should verify:

- Discord connection.
- Guild availability.
- Required permissions.
- Role hierarchy.
- Required/optional intents.
- PostgreSQL connection/schema version.
- Redis connection.
- Worker health.
- Dashboard OAuth configuration.
- Backup storage read/write/delete health.
- Latest snapshot integrity.
- Guarded-mode health.
- Dangerous native Administrator roles/bots.

Diagnostics must redact secrets.

## 32. Security Score

Knight exposes an explainable guild Security Score. Positive/negative factors include:

- Guarded Permissions coverage.
- Knight role hierarchy health.
- Protected critical resources.
- Backup health.
- Security Managers configured.
- Panic/lockdown readiness.
- Uncontrolled native Administrator roles.
- Unknown Administrator bots.
- Guarded bypass permissions still present.

The score must always explain what raises or lowers it.

## 33. Shadow Mode and policy simulator

Shadow Mode evaluates the full policy/incident pipeline without taking automatic enforcement actions. It reports what would have been denied, quarantined, or escalated and identifies likely false positives.

The policy simulator can replay recent historical security events against proposed policy changes to estimate affected staff/actions before configuration is applied.

## 34. V1 feature boundary

The first release includes:

### Foundation

- TypeScript monorepo.
- discord.js bot.
- Next.js dashboard.
- Drizzle/PostgreSQL.
- Redis.
- Worker.
- Docker Compose.
- Distributed deployment documentation.
- Discord OAuth.
- Multi-guild self-hosted isolation.

### Staff/IAM

- Custom Staff Profiles.
- Discord role mapping.
- Hierarchy.
- Assignments.
- Granular permissions.
- Multiple rate windows.
- Risk budgets.
- Per-user overrides.
- Temporary grants/restrictions.
- No-self-escalation.
- Grant ceilings.
- Security Managers.
- Approvals.

### Guarded Permissions

- Observe.
- Test.
- Guarded.
- Migration previews/snapshots.
- Incremental guarded categories.
- Native bypass detection.
- Role synchronization.

### Anti-nuke

- Real-time audit/security event ingestion.
- Normalized Security Events.
- Action limits and burst detection.
- Cross-action risk.
- Protected users/resources.
- Deterministic attack patterns.
- Incident correlation.
- Restriction/quarantine/chain containment.
- Lockdowns and panic mode.

### Firewall

- Bot-add detection and trust inventory.
- Dangerous bot-permission detection.
- Bot approval flow.
- Webhook monitoring/protection.

### Moderation

- Warn.
- Timeout/untimeout.
- Kick.
- Ban/unban.
- Purge.
- Cases/reasons.

### Recovery

- Full/incremental/emergency structural snapshots.
- Resource versioning.
- Point-in-time recovery planning.
- Incident recovery.
- Selective restore.
- Resumable recovery worker.
- Integrity validation.
- Optional selected-channel archive.
- Optional attachment storage.

### Logging

- Security Ledger.
- Hash chaining.
- Before/after diffs.
- Incident timelines.
- Configuration history.
- Searchable dashboard logs.
- Discord alert channels.
- Exports.

### Intelligence

- Administrative behavior baselines.
- Advisory anomaly score.
- Shadow Mode.
- Policy simulator.
- Security Score and recommendations.

### Onboarding

- `/setup`.
- Dashboard setup wizard.
- Server scan.
- Existing staff import.
- Permission/hierarchy health checks.
- Security presets.
- Backup setup.
- `/doctor`.
- Beginner documentation.

### Raid layer

- Join-burst detection.
- Raid Mode.
- Account-age policy.
- Newcomer restrictions.
- Protected AutoMod management.

## 35. Documentation quality bar

Documentation is part of the product, not an afterthought.

A first-time user must be able to understand:

- What Knight protects against.
- What Guarded Permissions means.
- Why staff roles should lose native destructive permissions.
- Why Knight requires a high role position and strong Discord permissions.
- How to create/import Staff Profiles.
- How limits, risk budgets, approvals, and protected resources interact.
- Why Observe and Test modes exist.
- How to enable Guarded mode safely.
- How incidents, quarantine, lockdown, and panic mode differ.
- What backups can restore exactly vs recreate vs archive only.
- How to recover from common failures.

Every major documentation page should cover:

1. What the feature does.
2. Why a server might use it.
3. How to configure it.
4. A concrete example.
5. Security implications.
6. Common mistakes.

## 36. Final architecture principle

All privileged activity, whether initiated through Knight or detected natively, must converge on one auditable security model:

```text
Discord / Dashboard Request OR Native Discord Event
                    ↓
              Security Event
                    ↓
    Authorization + Limits + Risk + Protection
                    ↓
        Correlation + Advisory Anomaly
                    ↓
              Decision / Incident
                    ↓
     Allow / Approval / Block / Containment
                    ↓
              Security Ledger
                    ↓
      Evidence + Snapshot + Recovery Plan
                    ↓
              Recover + Verify
```

For every privileged action, Knight should be able to answer:

> **Who requested or performed what, against whom or what resource, under which Staff Profile and policy version, with what limits/risk state, who approved it if required, what Knight did in response, and why?**

That explainability requirement is the core consistency test for the implementation.
