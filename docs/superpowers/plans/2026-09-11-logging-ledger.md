# Logging and Security Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable per-guild security history, configurable Discord notification channels, and a simple Logs UI without introducing a separate logging service.

**Architecture:** PostgreSQL is authoritative. A `SecurityLedgerRepository` appends hash-chained rows transactionally; Discord notifications are best-effort after the durable write. Bot and web code reuse the existing repository/runtime patterns and the current Discord adapter.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL 17, discord.js, Next.js 16, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-local-security-platform-completion-design.md`

## Global Constraints

- Single-machine Docker Compose deployment only.
- No S3, cloud queues, event bus, analytics database, or generic logging framework.
- PostgreSQL is the source of truth; notification failure must never erase a ledger entry.
- Logging channels are existing Discord text channels or explicit `Disabled`.
- Database migrations are additive and existing guilds default to notifications disabled.
- Follow TDD and commit each independently reviewable task.

---

### Task 1: Persist logging settings and hash-chained ledger entries

**Files:**
- Create: `packages/database/src/schema/security-ledger.ts`
- Create: `packages/database/src/repositories/security-ledger-repository.ts`
- Create: `packages/database/src/repositories/security-ledger-repository.test.ts`
- Modify: `packages/database/src/schema/index.ts`
- Modify: `packages/database/src/index.ts`
- Create migration through Drizzle Kit under `packages/database/migrations/`

**Interfaces:**
- Produces `SecurityLedgerRepository.append(input): Promise<SecurityLedgerRecord>`.
- Produces `SecurityLedgerRepository.listRecent(guildId, filters): Promise<SecurityLedgerRecord[]>`.
- Produces `SecurityLedgerRepository.getLoggingSettings(guildId)` and `saveLoggingSettings(input)`.

- [ ] **Step 1: Write failing repository tests**

Create tests that migrate a disposable PostgreSQL database, append two entries for the same guild, and assert guild isolation plus chaining:

```ts
const first = await repo.append({
  guildId: 'g1', severity: 'INFO', source: 'KNIGHT', action: 'member.warn',
  actorUserId: 'u1', targetId: 'u2', decisionId: null, incidentId: null, metadata: {},
});
const second = await repo.append({
  guildId: 'g1', severity: 'LOW', source: 'CONFIG', action: 'staff.profile.update',
  actorUserId: 'u1', targetId: 'p1', decisionId: null, incidentId: null, metadata: { version: 2 },
});
expect(first.previousHash).toBeNull();
expect(second.previousHash).toBe(first.entryHash);
expect(second.entryHash).not.toBe(first.entryHash);
expect(await repo.listRecent('g2', {})).toEqual([]);
```

Also assert logging settings default to both channels `null` and persist explicit selections.

- [ ] **Step 2: Run the repository test and confirm RED**

Run: `pnpm --filter @knight/database test -- security-ledger-repository.test.ts`
Expected: FAIL because the schema/repository do not exist.

- [ ] **Step 3: Add the minimal schema and append implementation**

Use one `guild_logging_settings` row per guild and one append-only `security_ledger` table. Compute `entryHash` from a stable JSON payload plus `previousHash` using `createHash('sha256')`; lock the latest guild row inside the append transaction before inserting the next row.

```ts
export type AppendSecurityLedgerInput = Readonly<{
  guildId: string; severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  source: string; action: string; actorUserId: string | null; targetId: string | null;
  decisionId: string | null; incidentId: string | null; metadata: Record<string, unknown>;
}>;
```

- [ ] **Step 4: Generate the additive migration and rerun tests**

Run: `pnpm --filter @knight/database exec drizzle-kit generate`
Run: `pnpm --filter @knight/database test -- security-ledger-repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database
git commit -m "feat: add security ledger persistence"
```

### Task 2: Add Discord notification delivery and channel validation

**Files:**
- Modify: `packages/discord/src/port.ts`
- Modify: `packages/discord/src/discord-js-adapter.ts`
- Modify: `packages/discord/src/discord-js-adapter.test.ts`
- Create: `apps/bot/src/security/security-recorder.ts`
- Create: `apps/bot/src/security/security-recorder.test.ts`

**Interfaces:**
- Extend `DiscordActionPort` with `listTextChannels(guildId)`, `canSendToChannel(guildId, channelId)`, and `sendChannelMessage(channelId, content)`.
- Produce `SecurityRecorder.record(input, notificationKind?): Promise<SecurityLedgerRecord>`.

- [ ] **Step 1: Write failing Discord adapter tests**

Test that only guild text-capable channels are returned, permission validation rejects a channel Knight cannot view/send to, and `sendChannelMessage` calls Discord without exposing secrets.

- [ ] **Step 2: Run adapter tests and confirm RED**

Run: `pnpm --filter @knight/discord test`
Expected: FAIL on the three missing adapter methods.

- [ ] **Step 3: Implement the three adapter methods minimally**

Use `guild.channels.fetch()` and Discord permission checks for `ViewChannel` + `SendMessages`; never create a channel automatically.

- [ ] **Step 4: Write the recorder failure-order test**

```ts
const record = await recorder.record(input, 'SECURITY');
expect(ledger.append).toHaveBeenCalledBefore(discord.sendChannelMessage);
expect(record.entryHash).toBe('hash');
```

Make `discord.sendChannelMessage` reject and assert `record()` still resolves after the ledger append.

- [ ] **Step 5: Implement `SecurityRecorder`**

The recorder reads saved logging settings, appends first, formats one short operational line, then attempts the selected notification channel inside `try/catch`. `SECURITY` uses the security channel; `MODERATION` uses the moderation channel; `undefined` writes ledger only.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm --filter @knight/discord test && pnpm --filter @knight/bot test -- security-recorder.test.ts`
Expected: PASS.

```bash
git add packages/discord apps/bot/src/security
git commit -m "feat: deliver ledger notifications"
```

### Task 3: Hook existing Knight actions into the ledger

**Files:**
- Modify: `apps/bot/src/index.ts`
- Modify: `apps/bot/src/moderation/moderation-executor.ts`
- Modify: `apps/bot/src/commands/message/purge.ts`
- Modify: `apps/bot/src/staff/role-sync-service.ts`
- Modify: `apps/bot/src/security/security-manager-service.ts`
- Modify: `apps/bot/src/setup/guarded-migration-service.ts`
- Update their existing tests.

**Interfaces:**
- `ModerationExecutorDependencies` gains `securityRecorder: Pick<SecurityRecorder, 'record'>`.
- Existing services receive the same recorder through constructor dependencies.

- [ ] **Step 1: Add failing tests for one allowed and one denied moderation request**

Assert a denied request records `metadata.outcome = 'DENIED'`, while an executed request records `metadata.outcome = 'EXECUTED'`, with `decisionId`, actor, target, and canonical action.

- [ ] **Step 2: Run bot tests and confirm RED**

Run: `pnpm --filter @knight/bot test`
Expected: FAIL because recorder dependencies/hooks are missing.

- [ ] **Step 3: Record moderation outcomes centrally**

In `executeModerationAction`, record after the decision is known and after mutation outcome is known. Do not make notification delivery part of action success; if durable ledger append itself fails, return `SECURITY_UNAVAILABLE` before a destructive mutation.

- [ ] **Step 4: Add focused config/Guarded hook tests**

Assert profile create/update/assignment/removal, Security Manager add/remove, and Guarded enable/rollback each append a `CONFIG` or `SECURITY` ledger entry with actor and target identifiers.

- [ ] **Step 5: Implement those thin service hooks and rerun bot tests**

Run: `pnpm --filter @knight/bot test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bot
git commit -m "feat: record Knight security actions"
```

### Task 4: Add Logging settings and Logs pages

**Files:**
- Modify: `apps/web/lib/server-dependencies.ts`
- Create: `apps/web/app/guilds/[guildId]/logging/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/logging/actions.ts`
- Create: `apps/web/app/guilds/[guildId]/logs/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/logging/actions.test.ts`
- Modify: `apps/web/app/guilds/[guildId]/layout.tsx`

**Interfaces:**
- `WebRepositories` gains `securityLedger: SecurityLedgerRepository`.
- Logging action accepts `securityChannelId: string | null` and `moderationChannelId: string | null`.

- [ ] **Step 1: Write failing action tests**

Cover owner/Security-Manager authorization, explicit Disabled (`null`) values, rejection of channels outside the guild, and rejection when Knight lacks `ViewChannel` or `SendMessages`.

- [ ] **Step 2: Implement server action and page**

Use `getWebDiscordAdapter()` to list current text channels; never let the browser submit an arbitrary unchecked channel ID. Save only after revalidating the selected IDs server-side.

- [ ] **Step 3: Add Logs page tests/structure assertions**

Render the latest 100 entries and simple query-string filters for `source`, `action`, `severity`, `actor`, and `target`. Do not add full-text search, pagination infrastructure, or charts.

- [ ] **Step 4: Add navigation links and run web tests**

Run: `pnpm --filter @knight/web test && pnpm --filter @knight/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: configure logging and browse security ledger"
```

### Task 5: Make the LOGGING setup step truthful

**Files:**
- Modify: `apps/bot/src/setup/setup-service.ts`
- Modify: `apps/bot/src/setup/setup-service.test.ts`
- Modify: `apps/web/lib/setup-dependencies.ts`
- Modify: `apps/web/app/guilds/[guildId]/setup/page.tsx`
- Modify: `docs/setup/06-first-run.md`

**Interfaces:**
- `SetupService` consumes `securityLedger.getLoggingSettings(guildId)`.
- `advanceStep()` refuses `LOGGING → PROTECTION` until a settings row exists, even when both channel IDs are `null`.

- [ ] **Step 1: Write a failing setup test**

```ts
await expect(service.advanceStep('g1', ownerId)).rejects.toThrow('Configure logging');
await ledger.saveLoggingSettings({ guildId: 'g1', securityChannelId: null, moderationChannelId: null, updatedBy: ownerId });
await expect(service.advanceStep('g1', ownerId)).resolves.toBeDefined();
```

- [ ] **Step 2: Implement the readiness check and actionable Setup copy**

The Setup page should link to Logging and say that choosing Disabled is valid; it must not imply Discord channels are mandatory.

- [ ] **Step 3: Run slice verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && git diff --check`
Expected: all commands exit 0.

- [ ] **Step 4: Docker/Compose smoke**

Run `docker build --tag knight-ledger-ci .`, verify bot/worker source imports as non-root, then `docker compose up -d --build`. Confirm migrate exit 0, `/api/health/live`, `/api/health/ready`, and no bot/web/worker restart loop.

- [ ] **Step 5: Commit docs/setup gate changes**

```bash
git add apps/bot/src/setup apps/web/lib/setup-dependencies.ts apps/web/app/guilds/[guildId]/setup docs/setup/06-first-run.md
git commit -m "feat: require explicit logging setup"
```
