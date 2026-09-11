# Protection, Native Events, and Incidents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record important native Discord security changes, enforce protected resources through the existing policy engine, and add simple bot/webhook firewall modes plus incident grouping.

**Architecture:** Add focused PostgreSQL repositories for security events, incidents, protected resources, firewall settings, and bot/webhook inventory. Gateway listeners normalize only the approved first-pass events; the existing authorization context receives real protection levels instead of `Normal`. Redis correlation gains one short-lived lookup index so Knight can recognize its own Discord writes.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Redis 8, discord.js, Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-local-security-platform-completion-design.md`

## Global Constraints

- Only record role/channel create-update-delete, ban/unban, bot-member joins, and webhook-update signals in this project.
- Add `GatewayIntentBits.GuildWebhooks`; do not add Message Content for core protection.
- Unknown actors remain unknown; never guess audit attribution.
- Unknown bots/webhooks are not automatically deleted.
- Enforce mode removes only explicitly `BLOCKED` entries and only when Discord hierarchy/permissions allow it.
- Protected-resource restrictions must run through the shared authorization path where applicable.
- No behavioral ML, risk engine, generic rules system, or broad Discord activity monitoring.

---

### Task 1: Persist events, incidents, protection, and firewall state

**Files:**
- Create: `packages/database/src/schema/security.ts`
- Create: `packages/database/src/repositories/security-repository.ts`
- Create: `packages/database/src/repositories/security-repository.test.ts`
- Modify: `packages/database/src/schema/index.ts`
- Modify: `packages/database/src/index.ts`
- Generate one additive migration under `packages/database/migrations/`.

**Interfaces:**
- `SecurityRepository.recordEvent(input): Promise<SecurityEventRecord>`.
- `SecurityRepository.findOrCreateIncident(input): Promise<SecurityIncidentRecord>` groups by guild + actor key + 5-minute window.
- `getProtectionLevel(guildId, resourceType, resourceId)` returns `ProtectionLevel` with unlisted resources as Normal.
- `saveProtection`, `removeProtection`, `getFirewallSettings`, `saveFirewallSettings`, `upsertBotInventory`, and `upsertWebhookInventory` remain guild-scoped.

- [ ] **Step 1: Write failing repository tests**

Test guild isolation, unlisted protection = Normal, persisted `IMPORTANT`/`CRITICAL`/`IMMUTABLE`, neutral firewall defaults (`OBSERVE`), inventory trust states, and incident grouping within/far outside the 5-minute window.

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm --filter @knight/database test -- security-repository.test.ts`
Expected: FAIL because schema/repository are missing.

- [ ] **Step 3: Implement minimal tables/repository**

Use tables `security_events`, `security_incidents`, `protected_resources`, `guild_firewall_settings`, `known_bots`, and `known_webhooks`. Keep event `action` as free text because native events are not Staff Profile permissions.

- [ ] **Step 4: Generate migration and rerun tests**

Run: `pnpm --filter @knight/database exec drizzle-kit generate`
Run: `pnpm --filter @knight/database test -- security-repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database
git commit -m "feat: persist security events and protection state"
```

### Task 2: Feed protected-user levels into the existing policy engine

**Files:**
- Modify: `apps/bot/src/moderation/staff-state-port.ts`
- Modify: `apps/bot/src/moderation/staff-state-port.test.ts`
- Modify: `apps/bot/src/moderation/moderation-executor.ts`
- Modify: `packages/security/src/authorization/evaluate-policy.test.ts`
- Modify: `apps/bot/src/index.ts`

**Interfaces:**
- `ModerationStaffStateDependencies` gains `security: Pick<SecurityRepository, 'getProtectionLevel'>`.
- User targets call `getProtectionLevel(guildId, 'USER', userId)` and put the result into `AuthorizationContext.target.protectionLevel`.

- [ ] **Step 1: Write failing tests for protected targets**

Assert `CRITICAL` produces the existing `REQUIRE_APPROVAL` decision and `IMMUTABLE` produces a hard deny for non-owner mutating moderation. Preserve the guild-owner protection rule.

- [ ] **Step 2: Adjust the pure policy rule minimally**

Change the current combined Critical/Immutable approval branch so `IMMUTABLE` returns `DENY` with code `PROTECTED_TARGET`, while `CRITICAL` keeps `REQUIRE_APPROVAL`. `IMPORTANT` remains informational in this first pass.

- [ ] **Step 3: Replace the hard-coded `ProtectionLevel.Normal` in `staff-state-port.ts`**

Fetch the level concurrently with target Staff Profile/Discord state and pass it into the existing context object.

- [ ] **Step 4: Run focused security/bot tests and commit**

Run: `pnpm --filter @knight/security test && pnpm --filter @knight/bot test -- staff-state-port.test.ts moderation-executor.test.ts`
Expected: PASS.

```bash
git add packages/security apps/bot
git commit -m "feat: enforce protected member targets"
```

### Task 3: Normalize native Discord security events and attribute safely

**Files:**
- Modify: `packages/redis/src/execution-correlation-store.ts`
- Modify: `packages/redis/src/execution-correlation-store.test.ts`
- Create: `apps/bot/src/security/native-event-service.ts`
- Create: `apps/bot/src/security/native-event-service.test.ts`
- Create: `apps/bot/src/security/install-native-listeners.ts`
- Modify: `apps/bot/src/discord-client.ts`
- Modify: `apps/bot/src/index.ts`

**Interfaces:**
- Extend `ExecutionCorrelationStore` with `consumeMatch(input): Promise<ExecutionCorrelation | null>` using a secondary Redis key written by `create()`.
- `NativeEventService.record(input)` persists `security_events`, links an incident when suspicious, and calls the Slice-1 `SecurityRecorder` for the ledger/notification.

- [ ] **Step 1: Write a failing correlation-store test**

Create a correlation for guild `g1`, bot `b1`, action `member.ban`, target `u2`; assert `consumeMatch()` returns it once and then returns `null`.

- [ ] **Step 2: Implement the secondary TTL index**

Use a deterministic key containing guild, expected audit actor bot, action, and target. Store the correlation ID with the same TTL; consuming the match also consumes the primary correlation.

- [ ] **Step 3: Write native-event service tests**

Cover known Knight correlation, audit-attributed native actor, unattributed event, protected-resource change, and simple incident grouping. No test may require a live Discord guild.

- [ ] **Step 4: Implement only the approved Gateway listeners**

Wire role/channel create-update-delete, guild ban add/remove, bot-member join, and webhook update. Audit-log lookup is best-effort; if Discord does not provide a trustworthy matching entry, pass `actorUserId: null`.

- [ ] **Step 5: Add `GatewayIntentBits.GuildWebhooks` and run bot/Redis tests**

Run: `pnpm --filter @knight/redis test && pnpm --filter @knight/bot test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/redis apps/bot
git commit -m "feat: record native Discord security events"
```

### Task 4: Implement explicit bot/webhook firewall enforcement

**Files:**
- Modify: `packages/discord/src/port.ts`
- Modify: `packages/discord/src/discord-js-adapter.ts`
- Modify: `packages/discord/src/discord-js-adapter.test.ts`
- Create: `apps/bot/src/security/firewall-service.ts`
- Create: `apps/bot/src/security/firewall-service.test.ts`
- Modify: `apps/bot/src/security/native-event-service.ts`

**Interfaces:**
- Add `listChannelWebhooks(channelId)` and `deleteWebhook(webhookId, reason)` to `DiscordActionPort`.
- `FirewallService.handleBotJoin(guildId, botUserId)` and `handleWebhookUpdate(guildId, channelId)` return `{ observed, removed }` counts/status without throwing on best-effort notification failure.

- [ ] **Step 1: Write failing firewall tests for OBSERVE, ALERT, and ENFORCE**

Assert OBSERVE records inventory only; ALERT also requests a security notification; ENFORCE removes only inventory entries whose trust state is `BLOCKED`. Assert `UNKNOWN` survives ENFORCE.

- [ ] **Step 2: Extend the Discord adapter minimally**

Use guild/channel webhook fetch APIs and webhook delete. Reuse existing `kickMember` for blocked bot members; do not add a second bot-removal API.

- [ ] **Step 3: Implement `FirewallService` and connect it to native listeners**

Persist inventory before enforcement. When a blocked removal fails, record a HIGH ledger/event result but do not loop retries in the Gateway handler.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm --filter @knight/discord test && pnpm --filter @knight/bot test -- firewall-service.test.ts native-event-service.test.ts`
Expected: PASS.

```bash
git add packages/discord apps/bot/src/security
git commit -m "feat: add explicit bot and webhook firewall"
```

### Task 5: Add Security/Protected Resources UI and the PROTECTION setup gate

**Files:**
- Modify: `apps/web/lib/server-dependencies.ts`
- Create: `apps/web/app/guilds/[guildId]/security/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/security/actions.ts`
- Create: `apps/web/app/guilds/[guildId]/security/protected/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/security/protected/actions.ts`
- Create: `apps/web/app/guilds/[guildId]/security/actions.test.ts`
- Modify: `apps/web/app/guilds/[guildId]/layout.tsx`
- Modify: `apps/bot/src/setup/setup-service.ts`
- Modify: `apps/bot/src/setup/setup-service.test.ts`
- Modify: `apps/web/lib/setup-dependencies.ts`
- Modify: `apps/web/app/guilds/[guildId]/setup/page.tsx`

**Interfaces:**
- Security page edits only firewall modes and inventory trust states.
- Protected page adds/removes `USER`, `ROLE`, or `CHANNEL` records after server-side Discord existence validation.
- `SetupService` considers PROTECTION configured only after a `guild_firewall_settings` row has been explicitly saved.

- [ ] **Step 1: Write failing web action tests**

Cover guild authorization, invalid resource IDs, managed role rejection for protection edits that imply manageability, firewall mode validation, and cross-guild inventory/resource IDs.

- [ ] **Step 2: Implement the two operational pages**

Show active incidents, firewall modes/inventory, and protected resources. Keep forms simple; no analytics, charts, or generic rule builder.

- [ ] **Step 3: Write and implement the PROTECTION setup gate**

Allow Observe/Observe with zero protected resources as a valid explicit configuration; require the owner/Security Manager to save it once before advancing.

- [ ] **Step 4: Run slice verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && git diff --check`
Then rebuild Compose and confirm health endpoints plus no restart loop. Use fake adapters for destructive firewall tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web apps/bot/src/setup docs/setup
git commit -m "feat: configure server protection"
```
