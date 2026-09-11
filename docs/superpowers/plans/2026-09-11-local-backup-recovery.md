# Local Backup and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add simple local structural backups, optional selected-channel archives, preview-first recovery, and truthful setup gates using the existing worker and a Docker volume.

**Architecture:** PostgreSQL stores policy/job/backup metadata. The existing worker polls pending rows, uses a small Discord REST structure adapter, writes gzip JSON snapshots under a generated local path, and verifies SHA-256 before restore. The dashboard enqueues preview/restore work and reads durable job state; only the worker touches backup files.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Redis, discord.js REST, Node `fs/promises` + `zlib` + `crypto`, Next.js, Docker Compose, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-local-security-platform-completion-design.md`

## Global Constraints

- Local named Docker volume only; no S3/object storage/cloud queue.
- Backup policy modes are exactly `DISABLED`, `MANUAL`, `DAILY`.
- Structural scope: non-managed roles/order, categories/text channels, parent/position relationships, permission overwrites, and Knight recovery references.
- Managed/integration roles are reference-only and never recreated or arbitrarily edited.
- Message archival is disabled by default, selected-channel only, capped per channel, and evidence-only.
- Restore is preview-first, owner-confirmed, sequential, checkpointed, and never claims recreated Discord IDs are preserved.
- User input must never become an arbitrary host filesystem path.

---

### Task 1: Add backup policy, backup metadata, and recovery-job persistence

**Files:**
- Create: `packages/contracts/src/backup.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/database/src/schema/backups.ts`
- Create: `packages/database/src/repositories/backup-repository.ts`
- Create: `packages/database/src/repositories/backup-repository.test.ts`
- Modify: `packages/database/src/schema/index.ts`
- Modify: `packages/database/src/index.ts`
- Generate additive migration under `packages/database/migrations/`.

**Interfaces:**
- `BackupPolicyMode = 'DISABLED' | 'MANUAL' | 'DAILY'`.
- `BackupRepository.savePolicy(input)` and `getPolicy(guildId)`; no row means setup not explicitly configured.
- `enqueueBackup({ guildId, requestedBy })`, `claimPendingBackup()`, `completeBackup(...)`, `failBackup(...)`.
- `enqueueRestorePreview({ guildId, backupId, requestedBy })`, `saveRestorePreview(...)`, `confirmRestore(...)`, `claimPendingRestore()`, `updateRestoreCheckpoint(...)`.

- [ ] **Step 1: Write failing repository tests**

Cover explicit Disabled policy, selected channel IDs + cap default 1000, pending-backup claiming, daily-due selection, restore preview/confirmation lifecycle, guild isolation, and persisted failure/checkpoint state.

- [ ] **Step 2: Run database tests and confirm RED**

Run: `pnpm --filter @knight/database test -- backup-repository.test.ts`
Expected: FAIL because contracts/schema/repository are missing.

- [ ] **Step 3: Implement the minimal tables and repository**

Use `backup_policies`, `backups`, and `recovery_jobs`. A backup row is also its own backup job (`PENDING | RUNNING | COMPLETED | FAILED`); do not create a generic jobs framework.

- [ ] **Step 4: Generate migration and rerun tests**

Run: `pnpm --filter @knight/database exec drizzle-kit generate`
Run: `pnpm --filter @knight/database test -- backup-repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/database
git commit -m "feat: persist local backup jobs"
```

### Task 2: Add a narrow Discord structural REST adapter

**Files:**
- Create: `packages/discord/src/structure-port.ts`
- Create: `packages/discord/src/discord-rest-structure-adapter.ts`
- Create: `packages/discord/src/discord-rest-structure-adapter.test.ts`
- Modify: `packages/discord/src/index.ts`
- Extend backup contracts in `packages/contracts/src/backup.ts`.

**Interfaces:**
- `DiscordStructurePort.captureGuild(guildId): Promise<DiscordStructuralSnapshot>`.
- `createRole`, `updateRole`, `setRolePositions`, `createChannel`, `updateChannel`, `setChannelPositions`, and `setChannelPermissionOverwrites` expose only fields present in the snapshot contract.
- `fetchChannelMessages(channelId, limit)` returns archive evidence records for configured channels.

- [ ] **Step 1: Define snapshot contracts and failing adapter tests**

Snapshot role fields: `id`, `name`, `managed`, `permissions`, `position`, `color`, `hoist`, `mentionable`. Channel fields: `id`, `name`, `type`, `parentId`, `position`, and normalized permission overwrites.

- [ ] **Step 2: Implement capture using discord.js `REST` + `Routes`**

Filter restore candidates to non-managed roles and category/text channels, while retaining managed roles as `managed: true` reference records. Do not capture arbitrary unsupported channel types for recreation.

- [ ] **Step 3: Implement only the restore writes required by the snapshot contract**

All writes accept a `reason` string. The adapter never decides what to restore; it executes an already-reviewed operation from the worker.

- [ ] **Step 4: Run Discord package tests and commit**

Run: `pnpm --filter @knight/discord test && pnpm --filter @knight/discord typecheck`
Expected: PASS.

```bash
git add packages/contracts packages/discord
git commit -m "feat: add Discord structural backup adapter"
```

### Task 3: Write verified local snapshots from the existing worker

**Files:**
- Create: `apps/worker/src/backups/local-backup-storage.ts`
- Create: `apps/worker/src/backups/local-backup-storage.test.ts`
- Create: `apps/worker/src/backups/backup-service.ts`
- Create: `apps/worker/src/backups/backup-service.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/index.test.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- `LocalBackupStorage.write(guildId, backupId, payload): Promise<{ relativePath: string; sha256: string }>`.
- `LocalBackupStorage.readVerified(relativePath, sha256): Promise<StructuralBackupPayload>`.
- `BackupService.runDueDaily(now)`, `processNextPendingBackup()`, and `runTick(now)`.

- [ ] **Step 1: Write failing storage tests**

Write/read a gzip JSON payload, assert SHA-256 verification, reject a tampered file, and reject guild/backup IDs containing `/`, `..`, or path separators.

- [ ] **Step 2: Implement generated filesystem paths only**

Write beneath `${KNIGHT_BACKUP_DIR}/${guildId}/${backupId}.json.gz` using `mkdir({ recursive: true })`, `gzip`, and SHA-256 over the compressed bytes. Store only the relative path in PostgreSQL.

- [ ] **Step 3: Write failing backup-service tests**

Use fake Discord/repositories/storage. Assert a pending backup captures Discord structure plus Knight role/logging/protection references, writes the file, and marks the row Completed. A failure marks Failed and preserves previous completed backups.

- [ ] **Step 4: Implement `BackupService` and the worker tick**

On each tick: enqueue due Daily policies that do not already have a pending/running backup, then process pending backup rows one at a time. Use a short interval such as 60 seconds; no cron or queue service.

- [ ] **Step 5: Add explicit archive opt-in configuration**

Add `ENABLE_MESSAGE_CONTENT_ARCHIVE=false` and `KNIGHT_BACKUP_DIR=/data/knight-backups` defaults. If a policy selects archive channels while the flag is false, reject the policy in web code and fail safely in the worker. When true, add `GatewayIntentBits.MessageContent` at bot startup and require the operator to enable the privileged intent in Discord Developer Portal.

- [ ] **Step 6: Archive only selected channels**

For each configured channel, fetch at most `maxMessagesPerChannel` (default 1000), newest-first pages as needed, normalize message ID/author ID/timestamp/content/attachment metadata, and store it inside the backup payload. Never scan unselected channels.

- [ ] **Step 7: Run worker/config tests and commit**

Run: `pnpm --filter @knight/config test && pnpm --filter @knight/worker test && pnpm --filter @knight/worker typecheck`
Expected: PASS.

```bash
git add apps/worker packages/config .env.example
git commit -m "feat: create local structural backups"
```

### Task 4: Add backup policy UI and Discord backup commands

**Files:**
- Create: `apps/web/app/guilds/[guildId]/recovery/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/recovery/actions.ts`
- Create: `apps/web/app/guilds/[guildId]/recovery/actions.test.ts`
- Modify: `apps/web/app/guilds/[guildId]/layout.tsx`
- Create: `apps/bot/src/commands/backup.ts`
- Create: `apps/bot/src/commands/backup.test.ts`
- Modify: `apps/bot/src/register-commands.ts`
- Modify: `apps/bot/src/register-commands.test.ts`
- Modify: `apps/bot/src/commands/router.ts`
- Modify: `apps/bot/src/commands/router.test.ts`

**Interfaces:**
- Recovery page saves `DISABLED | MANUAL | DAILY`, selected archive channel IDs, and message cap.
- `/backup create` enqueues one manual backup for the current guild.
- `/backup status` reports the latest backup status/time and active recovery job if any.

- [ ] **Step 1: Write failing web action tests**

Cover owner/Security-Manager authorization, exact policy modes, cap bounds `1..10000`, selected channel guild validation, and archive rejection when `ENABLE_MESSAGE_CONTENT_ARCHIVE` is false.

- [ ] **Step 2: Implement the Recovery policy/list page**

List policy, recent backups, integrity/status, and restore-job status. No charts, retention engine, export service, or arbitrary local path field.

- [ ] **Step 3: Write failing command-registration/router tests**

Require exact shapes `/backup create` and `/backup status`; both are guild-only and require owner or Security Manager authority for create, while status is available to the same setup-authorized principals.

- [ ] **Step 4: Implement command handlers**

`create` only enqueues; it does not block the Discord interaction waiting for filesystem work. Reply with the queued backup ID/status. `status` reads Postgres only.

- [ ] **Step 5: Run web/bot tests and commit**

Run: `pnpm --filter @knight/web test && pnpm --filter @knight/bot test`
Expected: PASS.

```bash
git add apps/web/app/guilds/[guildId]/recovery apps/web/app/guilds/[guildId]/layout.tsx apps/bot
git commit -m "feat: manage local backup policy"
```

### Task 5: Build preview-first structural recovery

**Files:**
- Create: `apps/worker/src/backups/restore-planner.ts`
- Create: `apps/worker/src/backups/restore-planner.test.ts`
- Create: `apps/worker/src/backups/restore-service.ts`
- Create: `apps/worker/src/backups/restore-service.test.ts`
- Modify: `apps/worker/src/backups/backup-service.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/web/app/guilds/[guildId]/recovery/page.tsx`
- Modify: `apps/web/app/guilds/[guildId]/recovery/actions.ts`
- Modify: `apps/web/app/guilds/[guildId]/recovery/actions.test.ts`

**Interfaces:**
- `planRestore(snapshot, current): RestorePreview` returns operations classified `REVERT | RECREATE | ARCHIVE_ONLY | NOT_RECOVERABLE`.
- `RestoreService.processPreviewJob(jobId)` verifies the backup hash before planning.
- `RestoreService.processExecutionJob(jobId)` uses `LockStore.acquire('recovery:<guildId>', ttl)` and durable checkpoints.

- [ ] **Step 1: Write failing pure planner tests**

Cover surviving changed role/channel = `REVERT`, missing non-managed role/channel = `RECREATE`, missing managed role = `NOT_RECOVERABLE`, archived messages = `ARCHIVE_ONLY`, and dependent channel/overwrite references mapped through recreated IDs.

- [ ] **Step 2: Implement the pure restore planner**

The planner performs no writes. It emits ordered operations: roles → role ordering → categories → channels → channel ordering → overwrites → Knight reference remaps.

- [ ] **Step 3: Write failing restore-service tests**

Assert preview verifies SHA before use; execution refuses an unconfirmed job; a failed operation stops immediately and persists checkpoint/error; retry resumes after the last completed stage; a second concurrent guild restore cannot acquire the Redis lock.

- [ ] **Step 4: Add narrowly-scoped recovery remap repository methods**

Add `StaffRepository.remapDiscordRoleForRecovery(...)`, `SecurityRepository.remapProtectedResourceForRecovery(...)`, and `SecurityLedgerRepository.remapLoggingChannelForRecovery(...)`. Staff role remap must create a new immutable Staff Profile version rather than mutating history in place.

- [ ] **Step 5: Implement sequential restore execution**

Store old→new role/channel IDs in the recovery checkpoint JSON. Pass every Discord write an audit reason containing the recovery job ID. Never replay archived messages or recreate managed roles.

- [ ] **Step 6: Add dashboard preview/confirm/retry actions**

Preview request may be owner/Security Manager; actual restore confirmation is guild-owner-only and requires an explicit checkbox. A failed job offers owner-only Retry from its durable checkpoint.

- [ ] **Step 7: Run worker/web/database tests and commit**

Run: `pnpm --filter @knight/database test && pnpm --filter @knight/worker test && pnpm --filter @knight/web test`
Expected: PASS.

```bash
git add apps/worker apps/web packages/database packages/redis
git commit -m "feat: preview and execute local recovery"
```

### Task 6: Replace blind setup advancement with real readiness gates

**Files:**
- Modify: `apps/bot/src/setup/setup-service.ts`
- Modify: `apps/bot/src/setup/setup-service.test.ts`
- Modify: `apps/web/lib/setup-dependencies.ts`
- Modify: `apps/web/app/guilds/[guildId]/setup/page.tsx`
- Modify: `apps/web/app/guilds/[guildId]/setup/actions.ts`
- Modify: `apps/web/lib/dashboard-structure.test.ts`

**Interfaces:**
- `SetupService` gains read-only dependencies for `securityLedger.getLoggingSettings`, `security.getFirewallSettings`, `security.listProtectedResources`, and `backups.getPolicy`.
- `advanceStep(guildId, actorUserId)` evaluates the current step before persisting the next step and throws `SETUP_STEP_BLOCKED` with a concrete reason when not ready.
- `getState(...)` exposes `currentStepReady: boolean` and `currentStepBlockers: readonly string[]` so Discord and web show the same truth.

- [ ] **Step 1: Write failing setup-service tests for every gate**

Cover: HEALTH requires doctor-equivalent Manage Roles/profile/hierarchy readiness; STAFF requires an enabled valid profile; POLICIES requires current versions/action policies; LOGGING requires a saved row even when both channels are disabled; PROTECTION requires saved firewall/protection configuration; BACKUPS requires an explicit policy row; OBSERVE requires no blocking configuration errors.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @knight/bot test -- setup-service.test.ts`
Expected: FAIL because `advanceStep` still advances blindly.

- [ ] **Step 3: Implement one readiness function per setup step**

Keep readiness checks inside `SetupService`; do not add a generic workflow engine. Reuse the existing Discord hierarchy/profile checks and the repositories produced by Slices 1–4.

- [ ] **Step 4: Update Setup UI and `/setup` status copy**

Disable `Advance setup step` while blocked, list the exact blockers, and link to Logging/Staff/Recovery where appropriate. `COMPLETE` remains setup progress only and never changes Observe/Test/Guarded automatically.

- [ ] **Step 5: Run bot/web tests and commit**

Run: `pnpm --filter @knight/bot test && pnpm --filter @knight/web test`
Expected: PASS.

```bash
git add apps/bot/src/setup apps/web/lib/setup-dependencies.ts apps/web/app/guilds/[guildId]/setup apps/web/lib/dashboard-structure.test.ts
git commit -m "feat: enforce truthful setup readiness"
```

### Task 7: Wire the local volume, documentation, and full verification

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `docs/setup/06-first-run.md`
- Create: `docs/security/logging-and-protection.md`
- Create: `docs/backups/local-backups-and-recovery.md`

**Interfaces:**
- Compose adds named volume `knight-backups` mounted only into `worker` at `/data/knight-backups`.
- Web/bot continue to use Postgres metadata and never require direct backup-file access.

- [ ] **Step 1: Add Compose volume and validate configuration**

Add `KNIGHT_BACKUP_DIR=/data/knight-backups` to worker environment and mount `knight-backups:/data/knight-backups`. Do not publish the directory or add host-path configuration to the dashboard.

Run: `docker compose config`
Expected: exit 0 and one persistent `knight-backups` volume.

- [ ] **Step 2: Update operator docs**

Document logging channels, protection/firewall modes, Lockdown/Panic behavior, local backup location, archive opt-in + Message Content requirement, restore limitations, and the now-enforced setup gates. State clearly that backup files must be included in the host's normal filesystem/volume backup if off-machine disaster recovery is desired.

- [ ] **Step 3: Run the complete repository gate**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Run container/runtime verification**

Build the image, verify non-root execution and bot/web/worker imports, then run `docker compose up -d --build`. Require migrate exit 0; Postgres/Redis/web healthy; bot/web/worker running without restart loops; `/api/health/live` and `/api/health/ready` healthy.

- [ ] **Step 5: Run safe feature smoke**

Using a disposable/test guild resource where required: save Disabled logging then a real notification channel, append/read ledger entries, configure Observe firewall, protect a disposable user/channel, enter/clear Lockdown, create and verify one local backup, generate a restore preview, and confirm no restore writes occur without owner confirmation. Do not run destructive Panic/firewall/restore mutations against production resources.

- [ ] **Step 6: Commit docs/deployment wiring**

```bash
git add docker-compose.yml .env.example docs
git commit -m "docs: finish local security setup guide"
```

### Completion Gate

Before this four-plan project is considered complete, rerun the full repository gate and a clean Compose rollout from the final committed tree. Remove only known generated build artifacts, require an empty `git status --short`, and do not push or merge without explicit user authorization.
