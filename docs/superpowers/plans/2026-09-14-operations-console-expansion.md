# Knight Operations Console Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Knight dashboard/logging/reset/Guarded improvements while preserving the existing security, recovery, and authorization architecture.

**Architecture:** Extend the current PostgreSQL/Drizzle repositories, bot services, Next.js server actions, and worker loop rather than introducing new frameworks. Factory reset is a durable worker job with guild-scoped operation locking; Security Ledger remains the durable event store; dashboard changes expose the same services in clearer language and safer controls.

**Tech Stack:** Node 24.17+, TypeScript 6, pnpm 12, Vitest 5, Drizzle ORM/PostgreSQL 17, Redis 8, discord.js 14, Next.js 16/React 19, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-14-dashboard-logging-reset-design.md`

## Global Constraints

- Preserve PostgreSQL, Redis, Drizzle, Next.js, discord.js, the worker architecture, current repositories/services, and fail-closed authorization.
- Preserve the existing uncommitted `docker-compose.yml` change: bot/web/worker must remain `restart: "no"`.
- Never read, print, commit, or expose real `.env` secrets.
- Factory reset must never alter Discord roles, channels, members, webhooks, overwrites, ordering, or permissions.
- Keep the Security Ledger hash chain authoritative; Discord notification delivery remains best-effort.
- Do not add a generic event bus, cloud backups, component library, alternate auth system, or unrelated refactors.
- Implement with focused tests first, minimal production changes second, and small commits per task.

---
## File Structure

- `packages/database/src/schema/security-ledger.ts`: four logging destinations plus deleted-content retention flag.
- `packages/database/src/schema/policies.ts`: Guarded activation metadata distinguishing real snapshots from no-op Guarded activation.
- `packages/database/src/schema/maintenance.ts`: durable guild factory-reset jobs.
- `packages/database/src/repositories/factory-reset-repository.ts`: reset queue, eligibility, status, and transactional Knight-state wipe.
- `packages/database/src/repositories/security-ledger-repository.ts`: expanded logging settings persistence/remapping.
- `packages/contracts/src/backup.ts`: four logging recovery references.
- `apps/worker/src/factory-reset/factory-reset-service.ts`: worker-owned filesystem/database reset execution.
- `apps/worker/src/backups/local-backup-storage.ts`: guild backup-directory deletion.
- `apps/bot/src/setup/guarded-migration-service.ts`: safe no-op Guarded activation/rollback.
- `apps/bot/src/security/security-recorder.ts`: Security/Moderation/Messages/Voice routing and safe notification formatting.
- `apps/bot/src/activity/activity-log-service.ts`: deleted-message and voice event persistence rules.
- `apps/bot/src/activity/install-activity-listeners.ts`: Discord message-delete/voice listeners and trustworthy attribution.
- `apps/bot/src/discord-client.ts`: GuildMessages/GuildVoiceStates intents and optional MessageContent capability.
- `apps/web/app/guilds/[guildId]/**`: logging, logs, overview, setup, reset Danger Zone, and explanatory UX.
- `docker-compose.yml`, `.env.example`, setup docs: runtime capability forwarding and deployment guidance.

### Task 1: Extend durable database contracts and repositories

**Files:**
- Modify: `packages/database/src/schema/security-ledger.ts`
- Modify: `packages/database/src/schema/policies.ts`
- Create: `packages/database/src/schema/maintenance.ts`
- Modify: `packages/database/src/schema/index.ts`
- Create: `packages/database/src/repositories/factory-reset-repository.ts`
- Modify: `packages/database/src/repositories/security-ledger-repository.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/package.json`
- Modify/Test: `packages/database/src/repositories/security-ledger-repository.test.ts`
- Create/Test: `packages/database/src/repositories/factory-reset-repository.test.ts`
- Modify/Test: `packages/database/src/repositories/backup-repository.ts`
- Modify/Test: `packages/database/src/repositories/backup-repository.test.ts`
- Generate: `packages/database/migrations/0006_factory_reset_logging.sql` and Drizzle metadata via `drizzle-kit generate --name factory_reset_logging`
**Interfaces:**
- `LoggingSettingsRecord` adds `messageChannelId: string | null`, `voiceChannelId: string | null`, and `storeDeletedMessageContent: boolean`.
- `SecurityLedgerRepository.saveLoggingSettings()` accepts all four channel IDs plus the retention boolean.
- `guildFactoryResetJobs` stores `id`, `guildId`, `requestedBy`, `status`, `error`, `createdAt`, `startedAt`, `completedAt`, `updatedAt`; statuses are `PENDING | RUNNING | COMPLETED | FAILED`.
- `FactoryResetRepository` produces `enqueue`, `claimPending`, `getActive`, `getLatest`, `complete`, `fail`, `recoverInterrupted`, `getExecutionEligibility`, and `resetGuildKnightState` methods. `enqueue` locks the guild row and atomically refuses active backup/recovery work or another active reset.
- Backup/recovery queue transitions (`enqueueBackup`, `enqueueRestorePreview`, `confirmRestore`, `retryRestore`) lock the same guild row and refuse while a reset is `PENDING` or `RUNNING`, closing the preflight/queue race.
- `guardedCategories` adds `migrationId: uuid | null` and `snapshotRequired: boolean` so rollback can distinguish no-op activation from lost snapshots.

- [ ] **Step 1: Write failing repository tests for expanded logging settings**

Add tests that save four channels and `storeDeletedMessageContent: true`, reload them, and verify `remapLoggingChannelForRecovery()` updates every matching channel field without touching unrelated fields.

```ts
expect(saved).toMatchObject({
  securityChannelId: 'security', moderationChannelId: 'moderation',
  messageChannelId: 'messages', voiceChannelId: 'voice',
  storeDeletedMessageContent: true,
});
```

- [ ] **Step 2: Write failing factory-reset repository tests**

Cover owner-preserving reset state, deletion of guild-scoped Knight rows, preservation of Auth.js rows, one active reset per guild, active backup/recovery refusal, and idempotent retry of the same reset job. Add BackupRepository tests proving backup/restore queue transitions reject an active reset and that reset enqueue vs backup enqueue serialize through the guild-row lock.

- [ ] **Step 3: Run database tests and confirm they fail for missing schema/repository behavior**

Run: `pnpm --filter @knight/database test`
Expected: FAIL only in the newly added expectations/types until implementation exists.
- [ ] **Step 4: Implement schema and repository changes**

Add `message_channel_id`, `voice_channel_id`, and `store_deleted_message_content boolean not null default false` to `guild_logging_settings`. Add Guarded activation metadata to `guarded_categories`. Create `guild_factory_reset_jobs` with a partial unique index preventing more than one `PENDING`/`RUNNING` job per guild.

`resetGuildKnightState({ guildId, resetJobId, ownerId })` must run in one transaction and explicitly remove guild rows in FK-safe order: recovery jobs, backups, backup policy, policy decisions, member warnings, staff assignments, staff overrides, temporary access, staff profiles (versions cascade), Security Managers, security events, incidents, protected resources, firewall settings, known bots/webhooks, emergency state, Security Ledger, logging settings, Guarded snapshots/categories, old reset jobs except `resetJobId`, and setup state. Then update the preserved guild row to `OBSERVE` with `ownerId`, and insert fresh setup state `WELCOME` with `[]` completed steps.

Do not touch `users`, `accounts`, `sessions`, or `verification_tokens`.

- [ ] **Step 5: Generate the migration instead of hand-editing Drizzle metadata**

Run:
```bash
pnpm --filter @knight/database exec drizzle-kit generate --name factory_reset_logging
```
Expected: next migration is `0006_factory_reset_logging.sql` and Drizzle metadata/journal are updated consistently.

- [ ] **Step 6: Run database tests and migration tests**

Run:
```bash
pnpm --filter @knight/database test
```
Expected: PASS, including existing migration resolver tests and new repository coverage.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/database
git commit -m "feat: add reset state and expanded logging settings"
```

### Task 2: Implement worker-owned factory reset and guild operation exclusivity

**Files:**
- Modify/Test: `apps/worker/src/backups/local-backup-storage.ts`
- Modify/Test: `apps/worker/src/backups/local-backup-storage.test.ts`
- Create: `apps/worker/src/factory-reset/factory-reset-service.ts`
- Create/Test: `apps/worker/src/factory-reset/factory-reset-service.test.ts`
- Modify/Test: `apps/worker/src/backups/backup-service.ts`
- Modify/Test: `apps/worker/src/backups/backup-service.test.ts`
- Modify/Test: `apps/worker/src/backups/restore-service.ts`
- Modify/Test: `apps/worker/src/backups/restore-service.test.ts`
- Modify/Test: `apps/worker/src/index.ts`
- Modify/Test: `apps/worker/src/index.test.ts`
**Interfaces:**
- `LocalBackupStorage.deleteGuild(guildId: string): Promise<void>` recursively removes only `<KNIGHT_BACKUP_DIR>/<guildId>` after identifier validation.
- `FactoryResetService.processNextPendingReset(): Promise<boolean>` claims one reset job, acquires `guild-operation:<guildId>`, deletes backup files, resets database state, then completes/fails the job.
- Backup and restore execution use the same `guild-operation:<guildId>` Redis lock so reset, backup, and recovery cannot overlap across multiple worker processes.

- [ ] **Step 1: Write failing storage deletion tests**

Create a temporary root, write backups for two guilds, call `deleteGuild('g1')`, and assert only `g1` disappears while `g2` remains. Also assert traversal-like identifiers are rejected.

- [ ] **Step 2: Write failing reset worker tests**

Test success ordering (`claim → eligibility recheck → lock → delete files → DB reset → complete → release`), lock contention, a Guarded/Panic/config-lock condition appearing after queueing, file-delete failure, DB-reset failure, interrupted `RUNNING` recovery back to `PENDING`, and retry after a failed attempt. A failure must call `fail` and must never call `complete`.

- [ ] **Step 3: Write failing shared-lock tests for backup/recovery**

Update existing service fixtures so backup, recovery, and reset all acquire `guild-operation:<guildId>`. Assert lock contention causes safe failure/defer behavior and that release failures do not rewrite already-durable completion state.

- [ ] **Step 4: Run worker tests and verify the new cases fail**

Run: `pnpm --filter @knight/worker test`
Expected: FAIL in the new reset/delete/lock tests before implementation.

- [ ] **Step 5: Implement reset execution and shared lock**

Extend `LocalBackupStorage`, add `FactoryResetService`, inject `FactoryResetRepository` and `LockStore` in `apps/worker/src/index.ts`, call `recoverInterrupted()` at worker startup, and process a pending reset before due backups/restores each tick. Recheck Guarded/emergency eligibility immediately before destructive work. Preserve the current one-active-tick guard.

For reset execution, capture the guild owner from the reset job/repository before wiping state; the worker must not query or mutate Discord resources during reset.

- [ ] **Step 6: Run focused worker tests**

Run: `pnpm --filter @knight/worker test`
Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/worker
git commit -m "feat: execute safe guild factory resets"
```
### Task 3: Make Guarded Moderation support safe no-op activation

**Files:**
- Modify/Test: `apps/bot/src/setup/guarded-migration-service.ts`
- Modify/Test: `apps/bot/src/setup/guarded-migration-service.test.ts`
- Modify/Test: `apps/bot/src/setup/setup-service.ts`
- Modify/Test: `apps/bot/src/setup/setup-service.test.ts`
- Modify: `packages/database/src/repositories/guild-repository.ts`
- Create/Test: `packages/database/src/repositories/guild-repository.test.ts`
- Modify: `apps/web/app/guilds/[guildId]/setup/page.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/setup/page.test.tsx`

**Interfaces:**
- `GuildRepository.setGuardedBanState()` accepts activation metadata: `{ migrationId: string | null; snapshotRequired: boolean }` in addition to enabled/mode/updater.
- `getGuardedCategory()` exposes `migrationId` and `snapshotRequired`.
- Real Guarded activation stores `snapshotRequired: true` and its migration ID; no-op activation stores `snapshotRequired: false` and `migrationId: null`.
- Observe → Test is legal only after persistent setup step `COMPLETE`; Guarded activation also rechecks setup completion server-side so an older/inconsistent Test guild cannot bypass readiness.

- [ ] **Step 1: Write failing no-op Guarded service tests**

Add a test proving Observe → Test is rejected before setup `COMPLETE`, plus a Guarded test where `previewBanGuard()` returns zero roles only after setup is complete. Owner-confirmed `enableBanGuard()` must transition to `GUARDED`, record `guarded.enable`, create no snapshots, and mark the category as no-op.

Add rollback tests proving a no-op Guarded activation returns to `TEST` without snapshots, while a real activation with `snapshotRequired: true` still throws `ROLLBACK_SNAPSHOT_MISSING` if its snapshots are absent.

- [ ] **Step 2: Write failing setup-page presentation tests**

Assert the page uses `Guarded Moderation`, explains that zero permission changes are safe, does not disable activation merely because `preview.roles.length === 0`, and renders plain-language blocker text rather than `MEMBER_BAN Guarded` as the normal heading.

- [ ] **Step 3: Run focused bot/web tests to verify failure**

Run:
```bash
pnpm --filter @knight/bot test -- src/setup/guarded-migration-service.test.ts
pnpm --filter @knight/web test -- app/guilds/[guildId]/setup/page.test.tsx
```
Expected: new no-op and copy expectations fail before implementation.

- [ ] **Step 4: Implement activation metadata and no-op behavior**

Add the setup-complete gate to `SetupService.transitionMode()` and `GuardedMigrationService.enableBanGuard()`. Keep snapshot/compensation behavior unchanged when affected roles exist. When none exist, skip snapshot and Discord permission writes, persist Guarded state with `snapshotRequired: false`, and still record the durable security event. On rollback, permit missing snapshots only when the active Guarded category explicitly says snapshots were not required.

- [ ] **Step 5: Run bot/database/web tests**

Run:
```bash
pnpm --filter @knight/database test
pnpm --filter @knight/bot test
pnpm --filter @knight/web test
```
Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/bot/src/setup apps/web/app/guilds/'[guildId]'/setup packages/database/src/repositories/guild-repository.ts
git commit -m "fix: make guarded activation explainable and no-op safe"
```
### Task 4: Add four-category notification routing and Discord activity listeners

**Files:**
- Modify/Test: `apps/bot/src/security/security-recorder.ts`
- Modify/Test: `apps/bot/src/security/security-recorder.test.ts`
- Modify/Test: `apps/bot/src/security/native-event-service.ts`
- Modify/Test: `apps/bot/src/security/native-event-service.test.ts`
- Create: `apps/bot/src/activity/activity-log-service.ts`
- Create/Test: `apps/bot/src/activity/activity-log-service.test.ts`
- Create: `apps/bot/src/activity/install-activity-listeners.ts`
- Create/Test: `apps/bot/src/activity/install-activity-listeners.test.ts`
- Modify/Test: `apps/bot/src/discord-client.ts`
- Modify/Test: `apps/bot/src/discord-client.test.ts`
- Modify/Test: `apps/bot/src/index.ts`

**Interfaces:**
- `SecurityNotificationKind` becomes `'SECURITY' | 'MODERATION' | 'MESSAGES' | 'VOICE'`.
- Notification channel selection maps those kinds to `securityChannelId`, `moderationChannelId`, `messageChannelId`, and `voiceChannelId`.
- `ActivityLogService` consumes `SecurityLedgerRepository.getLoggingSettings()` and `SecurityRecorder.record()` and exposes `recordMessageDelete`, `recordBulkMessageDelete`, and `recordVoiceTransition`.
- Store at most 4,000 UTF-16 code units of deleted message text in ledger metadata; Discord notification formatting is capped below 2,000 characters and neutralizes `@everyone`, `@here`, user mentions, and role mentions by inserting a zero-width separator after `@`.

- [ ] **Step 1: Write failing recorder routing/sanitization tests**

Verify each notification kind selects the correct configured channel, disabled destinations send nothing, Discord delivery failure preserves the ledger row, and text such as `@everyone <@123> <@&456>` is emitted mention-safe and length-safe. Message notifications must include available author/channel/content context; Voice notifications must include member plus old/new channel context for moves. Also verify existing native `member.ban`/`member.unban` events notify the Moderation destination while role/channel/bot/webhook events continue to notify Security.

- [ ] **Step 2: Write failing message activity service tests**

Cover: retention disabled; retention enabled + runtime capability; retention enabled without runtime capability; partial/deleted content unavailable; single-delete actor unknown; single-delete actor attributed only from a strict `AuditLogEvent.MessageDelete` match; and bulk delete attribution only from a strict `AuditLogEvent.MessageBulkDelete` match. Bulk persistence must never fabricate actors.

Use metadata keys consistently: `channelId`, `messageId`, `authorUserId`, `attachmentCount`, `attachments`, `content`, `contentStatus`, `auditLogId`, and `bulkOperationId` where applicable.

- [ ] **Step 3: Write failing voice transition tests**

Verify exactly these actions: `voice.join`, `voice.leave`, `voice.move`, `voice.server_mute`, `voice.server_unmute`, `voice.server_deafen`, `voice.server_undeafen`. An update with no supported change must produce no record.

- [ ] **Step 4: Write failing listener/intent tests**

`KNIGHT_GATEWAY_INTENTS` must include `GuildMessages` and `GuildVoiceStates` in addition to existing intents, while `MessageContent` remains conditional on `ENABLE_MESSAGE_CONTENT_ARCHIVE`. Configure `Partials.Message` so uncached guild message deletions can still produce metadata-only events; tests must assert the final client intents/partials options.

- [ ] **Step 5: Run bot tests and verify new failures**

Run: `pnpm --filter @knight/bot test`
Expected: FAIL in new routing/activity/intent cases before implementation.
- [ ] **Step 6: Implement activity logging without weakening native security listeners**

Keep `installNativeListeners()` focused on existing native security/moderation events, but update `NativeEventService` notification routing so native bans/unbans go to Moderation and role/channel/bot/webhook events go to Security. Install the new message/voice activity listeners separately from `apps/bot/src/index.ts`. For message deletion attribution, accept an audit actor only when the audit event type, channel, author/target where available, count, and timestamp all match tightly; otherwise store `actorUserId: null`. Bulk delete persists detailed ledger-only per-message entries plus one `message.bulk_delete` notification summary. The summary includes count and as many mention-safe deleted-content snippets as fit below the Discord message cap, then states that remaining details are available in the dashboard ledger.

Format Message/Voice notifications from structured ledger metadata rather than a second event model. For voice updates, compare old/new `VoiceState` values and emit only supported transitions. A move is one `voice.move` event, not a leave+join pair.

- [ ] **Step 7: Run bot tests**

Run: `pnpm --filter @knight/bot test`
Expected: PASS with existing native-event/firewall tests unchanged except for intentional intent/listener additions.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/bot
git commit -m "feat: log message deletion and voice activity"
```

### Task 5: Preserve expanded logging through backup/recovery and fix runtime propagation

**Files:**
- Modify/Test: `packages/contracts/src/backup.ts`
- Modify/Test: `packages/contracts/src/contracts.test.ts`
- Modify/Test: `apps/worker/src/backups/backup-service.ts`
- Modify/Test: `apps/worker/src/backups/backup-service.test.ts`
- Modify/Test: `apps/worker/src/backups/restore-service.ts`
- Modify/Test: `apps/worker/src/backups/restore-service.test.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify/Test: `apps/worker/src/backups/docker-compose-backup-volume.test.ts`

**Interfaces:**
- `KnightLoggingRecoveryReference` includes `securityChannelId`, `moderationChannelId`, `messageChannelId`, and `voiceChannelId`.
- Backup payload version stays `1`; the two new nullable channel-reference fields are backward-compatible when absent in older version-1 payloads.
- `ENABLE_MESSAGE_CONTENT_ARCHIVE` is forwarded into `bot`, `web`, and `worker` Compose environments; bot/web use it for runtime capability display/listening, worker keeps using it for selected-channel archive capture.

- [ ] **Step 1: Write failing contract/backup tests**

Assert structural backups capture all four logging channel references, and restoring a recreated channel remaps every matching logging destination including Messages and Voice.

- [ ] **Step 2: Add backward-compatibility test for old backup logging references**

An older payload containing only Security/Moderation must still preview/restore safely; missing Message/Voice references normalize to `null` rather than throwing.

- [ ] **Step 3: Run contract/worker tests and confirm failures**

Run:
```bash
pnpm --filter @knight/contracts test
pnpm --filter @knight/worker test
```
Expected: new four-channel expectations fail before implementation.
- [ ] **Step 4: Implement four-channel backup references and runtime forwarding**

Update backup capture and restore remap loops to include Message/Voice. Normalize absent fields to `null` when consuming older payloads. In `docker-compose.yml`, add:

```yaml
ENABLE_MESSAGE_CONTENT_ARCHIVE: ${ENABLE_MESSAGE_CONTENT_ARCHIVE:-false}
```

to bot, web, and worker without changing `restart: "no"`. Keep `.env.example` wording explicit that Message Content intent must also be enabled in the Discord Developer Portal.

- [ ] **Step 5: Validate Compose without printing its expanded secrets into committed logs**

Run locally: `docker compose config >/dev/null`
Expected: exit code 0. Do not paste the expanded config into documentation or test output.

- [ ] **Step 6: Run contracts/worker/config tests**

Run:
```bash
pnpm --filter @knight/contracts test
pnpm --filter @knight/worker test
pnpm --filter @knight/config test
```
Expected: PASS.

- [ ] **Step 7: Commit Task 5, including the user's existing manual-start policy change**

Before staging, verify the only intended Compose edits are `restart: "no"` plus message-content env forwarding. Then:

```bash
git add packages/contracts apps/worker docker-compose.yml .env.example
git commit -m "feat: preserve logging destinations through recovery"
```

### Task 6: Build four-category Logging and readable Logs dashboard pages

**Files:**
- Modify/Test: `apps/web/app/guilds/[guildId]/logging/page.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/logging/page.test.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/logging/actions.ts`
- Modify/Test: `apps/web/app/guilds/[guildId]/logging/actions.test.ts`
- Modify/Test: `apps/web/app/guilds/[guildId]/logs/page.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/logs/page.test.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Logging form fields: `securityChannelId`, `moderationChannelId`, `messageChannelId`, `voiceChannelId`, `storeDeletedMessageContent`.
- Capability display derives from `runtime.env.ENABLE_MESSAGE_CONTENT_ARCHIVE`; the guild toggle does not falsely claim content capture works when runtime capability is false.
- Logs render structured metadata inside expandable `<details>` and use friendly labels for known actions while retaining raw action IDs for filtering.
- [ ] **Step 1: Write failing logging-page/action tests**

Assert four independent channel selectors render, categories may share one channel, invalid/non-sendable channels are rejected, all-Disabled remains a valid explicit saved configuration, and the deleted-content checkbox persists independently of destination choice.

Add capability-copy tests for both runtime states:
```ts
expect(html).toContain('Message Content available');
expect(html).toContain('Message Content intent is not enabled');
```
Use the matching assertion for each fixture; do not expose environment values beyond the boolean capability.

- [ ] **Step 2: Write failing Logs-page readability tests**

Verify friendly labels for representative actions (`member.warn`, `message.delete`, `voice.move`, `guarded.enable`), category/severity badges, readable timestamps, and an expandable metadata section. Raw metadata JSON may appear inside `<details>` only.

- [ ] **Step 3: Run web tests and confirm failure**

Run: `pnpm --filter @knight/web test`
Expected: new Logging/Logs expectations fail before implementation.

- [ ] **Step 4: Implement Logging action/page**

Validate every non-null selected destination against `listTextChannels()` and `canSendToChannel()`. Save all four destinations plus retention boolean in one repository call. Revalidate `/logging`, `/setup`, the guild Overview, and `/logs` after a successful save. Show concise examples under each category: Security (roles/channels/firewall), Moderation (warn/timeout/kick/ban/purge), Messages (deletes/bulk deletes), Voice (join/leave/move/server mute/deafen).

- [ ] **Step 5: Implement Logs readability without changing ledger semantics**

Keep current filters and 100-row limit. Add a pure friendly-label mapping and structured metadata presentation; do not mutate stored records or add a parallel log store.

- [ ] **Step 6: Run web tests and accessibility-oriented structure tests**

Run: `pnpm --filter @knight/web test`
Expected: PASS, including existing focus/responsive structure tests.

- [ ] **Step 7: Commit Task 6**

```bash
git add apps/web/app/guilds/'[guildId]'/logging apps/web/app/guilds/'[guildId]'/logs apps/web/app/globals.css
git commit -m "feat: expand dashboard logging controls"
```

### Task 7: Add owner-only factory reset UI and finish Setup/Overview guidance

**Files:**
- Create: `apps/web/lib/factory-reset-service.ts`
- Create/Test: `apps/web/lib/factory-reset-service.test.ts`
- Modify/Test: `apps/web/lib/server-dependencies.ts`
- Modify/Test: `apps/web/lib/server-dependencies.test.ts`
- Modify/Test: `apps/web/app/guilds/[guildId]/setup/actions.ts`
- Modify/Test: `apps/web/app/guilds/[guildId]/setup/actions.test.ts`
- Modify/Test: `apps/web/app/guilds/[guildId]/setup/page.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/setup/page.test.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/page.tsx`
- Modify/Test: `apps/web/lib/dashboard-structure.test.ts`
- Modify/Test: `apps/web/lib/discord-runtime.ts`
- Modify/Test: `packages/discord/src/rest-setup-adapter.ts`
- Modify/Test: `packages/discord/src/rest-setup-adapter.test.ts`
- Modify: `apps/web/app/globals.css`
**Interfaces:**
- `FactoryResetService.getPreflight(guildId, actorUserId)` returns owner status, Guarded/emergency blockers, active backup/recovery/reset status, and a user-facing blocker list.
- `FactoryResetService.requestReset({ guildId, actorUserId })` rechecks all preconditions and calls `FactoryResetRepository.enqueue`; it never performs filesystem or Discord mutations.
- Reset action requires exact phrase `RESET KNIGHT` and checkbox value `yes` before calling the service.
- Setup actions redirect back with a small safe status code (`success`, `blocked`, `invalid-confirmation`, `failed`) so the page can render in-page feedback without leaking raw stack/errors.
- The web Discord adapter exposes `getGuildIdentity(guildId): Promise<{ guildId: string; name: string }>` so normal dashboard headings/sidebar use the Discord server name while IDs remain in Advanced details.

- [ ] **Step 1: Write failing factory-reset service/action tests**

Cover non-owner denial (including Security Manager), Guarded denial, Panic denial, `SECURITY_CONFIG`/`FULL` Lockdown denial, active backup/recovery/reset denial, invalid phrase, missing checkbox, successful queueing, and a second server-side precondition check at submit time.

- [ ] **Step 2: Write failing Setup UX tests**

Assert the visible setup sequence presents Health → Staff → Policies → Logging → Protection → Backups → Review with descriptions and direct fix links. Guarded readiness must independently show setup completion, owner, Manage Roles, hierarchy, emergency availability, and affected-role state.

Assert a zero-role Guarded preview says `No native moderation permissions need removal` and still renders an enabled activation button when every other prerequisite is satisfied and confirmation can be provided.

- [ ] **Step 3: Write failing Danger Zone tests**

Verify only the owner sees an actionable factory-reset form; the copy explicitly says Knight data/backups are erased and Discord roles/channels/members/webhooks/permissions are untouched. In Guarded mode show `Rollback Guarded before factory reset` and link to the rollback control instead of an actionable reset submit.

- [ ] **Step 4: Write failing Overview tests**

Require cards/status for current mode, setup step/progress, four logging destinations, backup policy/latest status, emergency state, Staff Profile count, and a concrete next-action link when something is blocked.

- [ ] **Step 5: Run web tests to verify failure**

Run: `pnpm --filter @knight/web test`
Expected: new service/action/page expectations fail before implementation.

- [ ] **Step 6: Implement reset preflight/action and safe page feedback**

Add `FactoryResetRepository` to `WebRepositories`. Add focused `BackupRepository.getActiveBackup(guildId)` and reuse existing `getActiveRecoveryJob(guildId)`; do not duplicate SQL in React pages. Catch known domain errors in server actions and redirect with safe status codes; unexpected failures use a generic failure notice.

- [ ] **Step 7: Rework Setup and Overview using existing services**

Do not create a second readiness model. Render `SetupService.getState()`, Guarded preview data, logging settings, backup state, security state, and staff repository data in plain language. Resolve Discord server/role/channel names through the live Discord adapter where available. Add the focused `getGuildIdentity()` REST helper instead of widening every bot-facing guild-state mock. If a name cannot be resolved, fall back to the ID inside Advanced details rather than the primary blocker text.

- [ ] **Step 8: Run web tests**

Run: `pnpm --filter @knight/web test`
Expected: PASS.

- [ ] **Step 9: Commit Task 7**

```bash
git add apps/web packages/database/src/repositories/backup-repository.ts packages/database/src/repositories/backup-repository.test.ts packages/discord/src/rest-setup-adapter.ts packages/discord/src/rest-setup-adapter.test.ts
git commit -m "feat: add guided setup and factory reset controls"
```
### Task 8: Polish remaining dashboard controls and operator documentation

**Files:**
- Modify: `apps/web/app/guilds/[guildId]/staff/page.tsx`
- Modify: `apps/web/app/guilds/[guildId]/staff/[profileId]/page.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/staff/actions.ts`
- Modify/Test: `apps/web/app/guilds/[guildId]/staff/actions.test.ts`
- Modify: `apps/web/app/guilds/[guildId]/security/page.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/security/actions.ts`
- Modify/Test: `apps/web/app/guilds/[guildId]/security/actions.test.ts`
- Modify: `apps/web/app/guilds/[guildId]/security/protected/page.tsx`
- Modify: `apps/web/app/guilds/[guildId]/security/protected/actions.ts`
- Create/Test: `apps/web/app/guilds/[guildId]/security/protected/actions.test.ts`
- Modify: `apps/web/app/guilds/[guildId]/recovery/page.tsx`
- Modify/Test: `apps/web/app/guilds/[guildId]/recovery/actions.ts`
- Modify/Test: `apps/web/app/guilds/[guildId]/recovery/actions.test.ts`
- Modify/Test: `apps/web/lib/dashboard-structure.test.ts`
- Modify: `apps/web/app/globals.css`
- Modify: `README.md`
- Modify: `docs/setup/06-first-run.md`
- Modify: `docs/setup/07-enable-guarded-permissions.md`
- Modify: `docs/security/logging-and-protection.md`
- Modify: `docs/backups/local-backups-and-recovery.md`

**Interfaces:**
- Primary/Secondary/Danger are CSS classes only; do not add a component library.
- Staff capability descriptions remain tied to existing action IDs; action semantics/rate-limit behavior do not change.
- Security firewall and protection behavior do not change; only explanation/presentation changes.
- Staff/Security/Protected/Recovery server actions follow the Setup safe-feedback pattern: successful or known-blocked operations redirect back with whitelisted notice codes; raw exception text is never put in the URL or page.

- [ ] **Step 1: Add failing/updated dashboard structure expectations**

Require `.danger`, `.buttonHelp`, and an Advanced-details style/pattern; preserve `:focus-visible`, responsive `.guildNav`, and the existing prohibition on decorative gradients/large box shadows.

- [ ] **Step 2: Improve Staff, Security, Protected, and Recovery explanatory copy**

Staff must explicitly say Discord role mapping is representation and does not grant Knight authority without assignment. Firewall cards explain Observe/Alert/Enforce. Protected levels explain Important/Critical/Immutable. Recovery explains preview-first, owner-only execution, and that message archives are evidence-only.

- [ ] **Step 3: Add action-feedback tests for Staff/Security/Protected/Recovery**

For each mutating action group, test one success and one domain/validation failure. The action must return the user to its page with a whitelisted notice code and the page must render a human-readable success/error notice. Assert raw stack/error text is not surfaced.

- [ ] **Step 4: Standardize controls and disabled-state explanations**

Use Primary for recommended next actions, Secondary for neutral/reversible operations, and Danger for destructive operations. Every disabled important/destructive button must have nearby text explaining the blocker; opacity alone is not sufficient. Apply the safe-feedback pattern to Staff, Security, Protected, and Recovery actions.

- [ ] **Step 5: Update operator docs**

Document the four logging categories, deleted-content retention, Voice logging, Message Content privileged intent requirement, factory reset semantics, no-op Guarded behavior, and manual Docker start/stop. Add a deployment note that source changes require `docker compose up -d --build` before slash-command changes appear. Warn that `docker compose config` expands secrets and should not be pasted publicly.

- [ ] **Step 6: Run web tests and repository lint**

Run:
```bash
pnpm --filter @knight/web test
pnpm lint
```
Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add apps/web README.md docs
git commit -m "docs: finish dashboard guidance and operator setup"
```
### Task 9: Full verification, rebuilt deployment, and command-registration proof

**Files:**
- No new feature files expected; only fix defects exposed by verification in the task that owns them.

**Interfaces:**
- Final deployment is the existing Docker Compose stack with manual restart policy retained.
- Verification must not factory-reset the user's real guild or perform destructive moderation; destructive flows are covered by tests and later manual QA in a disposable Discord test server.

- [ ] **Step 1: Verify worktree and secret hygiene before running the suite**

Run:
```bash
git status --short
git diff --check
git grep -nE 'DISCORD_TOKEN=.+|DISCORD_CLIENT_SECRET=.+|AUTH_SECRET=.+' -- ':!*.example' ':!docs/superpowers/*' || true
```
Expected: only intentional source/docs changes; `git diff --check` is clean; no newly committed literal secrets. Do not display `.env`.

- [ ] **Step 2: Run the full repository verification suite**

Run:
```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
Expected: all commands exit 0. Fix root causes, rerun the failing command, then rerun all four before completion.

- [ ] **Step 3: Validate migrations and Compose**

Run:
```bash
docker compose config >/dev/null
docker compose down
docker compose up -d --build
docker compose ps
```
Expected: migration container exits successfully; postgres/redis healthy; web healthy; bot/worker running. Do not use `down -v`.

- [ ] **Step 4: Inspect startup health without exposing env values**

Run:
```bash
docker compose logs --tail=100 migrate bot web worker
docker compose exec -T web node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>{console.log(r.status); process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```
Expected: migrations applied, bot reports a successful Knight connection, web readiness returns HTTP 200, worker has no reset/backup startup failure.

- [ ] **Step 5: Prove the rebuilt image registered `/backup` without printing credentials**

Run this inside the bot container so secrets remain environment variables rather than shell literals:
```bash
docker compose exec -T bot node -e "fetch('https://discord.com/api/v10/applications/'+process.env.DISCORD_CLIENT_ID+'/commands',{headers:{Authorization:'Bot '+process.env.DISCORD_TOKEN}}).then(r=>r.json()).then(xs=>{for(const c of xs){console.log(c.name+': '+(c.options||[]).map(o=>o.name).join(','))}})"
```
Expected output includes `backup: create,status` along with the existing approved command groups. If Discord propagation is delayed, retry after bot startup; do not add a second registration mechanism.
- [ ] **Step 6: Verify manual restart policy and leave Knight stopped after smoke testing**

Run:
```bash
docker inspect knight-bot-1 --format '{{.HostConfig.RestartPolicy.Name}}'
docker inspect knight-web-1 --format '{{.HostConfig.RestartPolicy.Name}}'
docker inspect knight-worker-1 --format '{{.HostConfig.RestartPolicy.Name}}'
docker compose stop
```
Expected: `no` three times, then bot/web/worker/postgres/redis are stopped. This preserves the user's explicit manual-start preference.

- [ ] **Step 7: Run final Git verification**

Run:
```bash
git status --short
git log --oneline -12
```
Expected: clean worktree after the plan's commits. Do not push unless the user explicitly asks.

- [ ] **Step 8: Produce the implementation report and manual QA handoff**

Report: commits created, tests/build results, migration name, Docker smoke result, registered command names, any intentional limitations, and exact operator steps for enabling Message Content intent. Explicitly state that no factory reset or destructive moderation was executed against the user's real server during automated verification.

## Manual QA after implementation

Use a disposable Discord test server for destructive checks. Start Knight manually with `docker compose up -d`, verify `/doctor`, then factory-reset Knight from the dashboard and confirm Discord roles/channels remain unchanged. Complete the setup wizard from Welcome through Review, configure four logging channels, exercise a Knight warning/timeout plus a deleted message and voice join/move/leave, verify each reaches the correct destination, enter Test, then enable Guarded after the readiness checklist passes. Test real Guarded permission removal only on disposable staff roles. Stop Knight afterward with `docker compose stop`.

## Completion rule

Do not claim completion from code inspection alone. Completion requires fresh evidence from the full `pnpm test/typecheck/lint/build` sequence, Docker rebuild/readiness, restart-policy inspection, and Discord application-command query showing `backup: create,status`.
