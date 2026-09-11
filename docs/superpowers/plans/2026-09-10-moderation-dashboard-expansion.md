# Knight Moderation + Dashboard Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Knight from guarded bans into a complete first moderation surface with durable warnings, per-action policy limits, hierarchy-safe commands, dashboard-managed Staff Profiles, expanded Guarded native-permission replacement, and a flat Discord-inspired dashboard.

**Architecture:** Keep `@knight/security` as the single policy authority. Build one shared target-aware moderation executor used by warn/timeout/kick/ban/unban/purge, keep warning-history lookup read-only and rank-independent, persist warnings/profile-version metadata in PostgreSQL, and keep Redis limited to rate/correlation state. Web server actions call shared services; React and slash routers contain no security rules.

**Tech Stack:** Node.js 24.17.x, pnpm 12.4.x, TypeScript, discord.js 14.27.x, Next.js 16.3.x, React, Auth.js, Drizzle ORM 0.44.7, PostgreSQL 17, Redis 8, Zod, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-10-moderation-dashboard-expansion-design.md`

## Global Constraints

- Branch remains `feature/security-foundation`; preserve legitimate dirty work and never reset/stash/discard unrelated changes.
- Never print, commit, or expose `.env` contents, OAuth tokens, database credentials, Redis passwords, or session tokens.
- Knight does not create Discord roles; Staff Profiles map only to existing guild roles.
- PostgreSQL is authoritative for Knight staff identity, rank, warning history, and policy. Redis is disposable operational state.
- Native Discord Administrator is never a Knight authority source.
- Mutating moderation actions deny equal/higher Knight-ranked targets for non-owner actors and always protect the guild owner target.
- `member.warnings.view` is read-only, explicit for staff, unlimited, and rank-independent; the guild owner may always view warning history.
- Existing profiles do not gain new capabilities automatically. All newly wired action permissions start disabled until explicitly granted.
- Guarded may strip a native Discord permission only after its Knight replacement is implemented and verified in the same release.
- Creating a mapped profile or changing a mapped role is blocked while guild mode is `GUARDED`.
- Every behavioral change follows strict red-green-refactor TDD; watch the intended test fail before production code.
- No real destructive Discord smoke against non-disposable members/messages.

---

### Task 1: Canonical moderation capabilities and policy metadata

**Files:**
- Modify: `packages/contracts/src/actions.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Create: `packages/contracts/src/moderation.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces `MODERATION_ACTIONS`, `RATE_LIMITED_MODERATION_ACTIONS`, `READ_ONLY_ACTIONS`, and metadata for labels/native Discord replacement mapping.
- Adds canonical `member.warnings.view` without changing existing action IDs.

- [ ] **Step 1: Write the failing contract tests**

Assert `ACTION_IDS` contains `member.warnings.view`, mutating moderation actions are exactly warn/timeout/kick/ban/unban/purge, warning-history is read-only, and each rate-limited action has a stable human label.

```ts
expect(ACTION_IDS).toContain('member.warnings.view');
expect(RATE_LIMITED_MODERATION_ACTIONS).toEqual([
  'member.warn', 'member.timeout', 'member.kick',
  'member.ban', 'member.unban', 'message.purge',
]);
expect(READ_ONLY_ACTIONS).toContain('member.warnings.view');
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @knight/contracts test`
Expected: FAIL because the new capability/metadata do not exist.

- [ ] **Step 3: Implement minimal contracts**

Create a small metadata module; do not make command execution dynamic. Keep the action ID as the durable permission key and expose labels/UI grouping from one source.

- [ ] **Step 4: Run GREEN and typecheck**

Run: `pnpm --filter @knight/contracts test && pnpm --filter @knight/contracts typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

`git add packages/contracts && git commit -m "feat: define complete moderation capabilities"`

---

### Task 2: Durable warnings and immutable Staff Profile metadata

**Files:**
- Modify: `packages/database/src/schema/staff.ts`
- Create: `packages/database/src/schema/warnings.ts`
- Modify: `packages/database/src/schema/index.ts`
- Modify: `packages/database/src/repositories/staff-repository.ts`
- Create: `packages/database/src/repositories/warning-repository.ts`
- Modify: `packages/database/src/index.ts`
- Create: `tests/integration/database/warning-repository.test.ts`
- Modify: `tests/integration/database/staff-repository.test.ts`
- Create: generated Drizzle migration under `packages/database/drizzle/`

**Interfaces:**
- Produces `WarningRepository.create`, `WarningRepository.setDmDeliveryStatus`, `WarningRepository.listForUser`.
- Extends profile-version records with immutable `profileName`, `discordRoleId`, and `rank` values stored on every version.
- Produces an atomic repository method for metadata + policy version changes while preserving the profile row as the latest lookup index.

- [ ] **Step 1: Write failing database integration tests**

Cover warning guild isolation, newest-first history ordering, DM-status update, and immutable profile metadata v1/v2 preservation. Also assert existing profile permissions remain unchanged when the migration is applied.

- [ ] **Step 2: Run RED against a disposable PostgreSQL instance**

Run the two integration files with a command-local `DATABASE_URL`; never use or print `.env` credentials.
Expected: FAIL because warnings/version metadata columns and repository methods do not exist.- [ ] **Step 3: Implement schema and repositories**

Warning columns: UUID id, guild ID, target user ID, actor user ID, reason, nullable actor profile-version ID, DM status (`PENDING|DELIVERED|FAILED`), created timestamp. Every warning query filters by guild ID.

Add version columns for effective profile name, mapped role ID, and rank. Backfill existing version rows from their current profile metadata in the migration because those metadata fields were not historically versioned.

Expose an atomic update flow that inserts the next immutable version and updates the profile row's current name/role/rank/currentVersionId in one transaction.

- [ ] **Step 4: Generate and inspect the migration**

Run: `pnpm --filter @knight/database exec drizzle-kit generate`
Inspect SQL manually: no permission JSON rewrite, no newly enabled actions, no destructive table recreation, and no cross-guild backfill.

- [ ] **Step 5: Run GREEN**

Apply migration to a fresh disposable database, then run database tests and `pnpm --filter @knight/database typecheck`.
Expected: all pass.

- [ ] **Step 6: Commit**

`git add packages/database tests/integration/database && git commit -m "feat: persist warnings and profile metadata history"`

---

### Task 3: Shared moderation authorization and read-only capability checks

**Files:**
- Modify: `packages/security/src/authorization/evaluate-policy.ts`
- Modify: `packages/security/src/authorization/types.ts`
- Modify: `packages/security/src/authorization/evaluate-policy.test.ts`
- Create: `packages/security/src/authorization/evaluate-capability.ts`
- Create: `packages/security/src/authorization/evaluate-capability.test.ts`
- Modify: `packages/security/src/index.ts`

**Interfaces:**
- Mutating actions continue through `evaluatePolicy(context)` and enforce target hierarchy centrally when `context.target` is a member target.
- `AuthorizationContext.target` becomes nullable for resource-scoped actions such as unfiltered `message.purge`; member-target owner/rank checks run only when a target exists, while the purge planner separately protects message authors.
- Produces `evaluateCapability(context)` for target-insensitive read-only checks such as `member.warnings.view`.

- [ ] **Step 1: Write table-driven RED tests for hierarchy**

For each member-target mutating action (`member.warn`, `member.timeout`, `member.kick`, `member.ban`, `member.unban`) and filtered `message.purge`, assert lower/equal rank target denial, guild-owner target denial, owner actor allowance, missing permission denial, and elevated-unregistered fail-closed behavior where a Discord member exists. Add a resource-scoped `message.purge` case with `target:null` proving permission/emergency/rate policy can be evaluated without inventing a member target.

- [ ] **Step 2: Write RED tests for warning-history access**

```ts
expect(evaluateCapability(ctx('member.warnings.view', { actorRank: 10, targetRank: 99 }))).toMatchObject({
  decision: PolicyDecision.Allow,
});
```

Also assert a non-owner without the permission is denied and the guild owner is allowed.

- [ ] **Step 3: Run RED**

Run: `pnpm --filter @knight/security test`
Expected: warning-history capability tests fail; hierarchy table may expose any ban-specific assumptions.

- [ ] **Step 4: Implement the minimal shared policy changes**

Do not weaken `evaluatePolicy`. Keep hierarchy/owner-target protection there for all mutating moderation actions. Add a separate read-only capability evaluator that checks owner authority, active assignment, temporary restriction, and permission without target-rank checks or rate consumption.

- [ ] **Step 5: Run GREEN and typecheck**

Run: `pnpm --filter @knight/security test && pnpm --filter @knight/security typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

`git add packages/security && git commit -m "feat: generalize moderation authorization"`

---

### Task 4: Reusable moderation execution primitive

**Files:**
- Create: `apps/bot/src/moderation/moderation-executor.ts`
- Create: `apps/bot/src/moderation/moderation-executor.test.ts`
- Create: `apps/bot/src/moderation/staff-state-port.ts`
- Modify: `apps/bot/src/commands/member/ban.ts`
- Modify: `apps/bot/src/commands/member/ban.test.ts`

**Interfaces:**
- Produces `executeModerationAction(input, dependencies, mutation)` for target-aware mutating actions.
- Centralizes Staff Profile snapshot conversion, owner/target resolution, elevated Discord detection, policy authorization, per-action rate limits, and durable decisions.
- The executor accepts `correlation: 'required' | 'none'`; external Discord mutations require a successful pre-mutation correlation, while durable Knight-only mutations such as warning creation use `none`.

- [ ] **Step 1: Write RED executor tests**

Assert DENY never invokes correlation/mutation; `correlation:'required'` creates correlation before mutation; `correlation:'none'` invokes an allowed Knight-only mutation without a correlation; each `ActionId` produces a separate Redis rate key through existing `authorizeGuardedAction`; state dependency failure returns a safe denial; post-authorization mutation failure reports attempted-action semantics.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @knight/bot test -- moderation-executor.test.ts`
Expected: FAIL because the reusable executor does not exist.

- [ ] **Step 3: Implement the executor by extracting the proven ban flow**

Keep `authorizeGuardedAction` in `@knight/security`; do not move Redis/database policy logic into the router. The executor accepts `action`, actor, nullable target user ID, bot ID, current time, correlation mode, and a narrow mutation function. `targetUserId:null` is reserved for resource-scoped actions such as unfiltered purge.

- [ ] **Step 4: Refactor `/member ban` onto the executor**

The existing ban tests must remain behaviorally equivalent: hierarchy, rate denial, correlation ordering, and Discord-rejection messages must still pass.

- [ ] **Step 5: Run GREEN**

Run bot tests and typecheck. Expected: PASS with no behavior regression in ban.

- [ ] **Step 6: Commit**

`git add apps/bot/src/moderation apps/bot/src/commands/member/ban* && git commit -m "refactor: share moderation execution pipeline"`

---

### Task 5: Discord adapter moderation operations and timeout parsing

**Files:**
- Modify: `packages/discord/src/port.ts`
- Modify: `packages/discord/src/discord-js-adapter.ts`
- Create: `packages/discord/src/discord-js-adapter.test.ts`
- Modify: `packages/discord/src/rest-setup-adapter.ts`
- Modify: `packages/discord/src/rest-setup-adapter.test.ts`
- Create: `apps/bot/src/moderation/parse-duration.ts`
- Create: `apps/bot/src/moderation/parse-duration.test.ts`

**Interfaces:**
- Adds narrow adapter methods `kickMember`, `timeoutMember`, `unbanMember`, `sendDirectMessage`, `fetchRecentMessages`, and `deleteMessages`.
- Extends `DiscordRoleState` with `name` and `managed` so both discord.js and REST adapters expose a safe role catalog for the dashboard; position/permissions remain authoritative for manageability checks.
- Extends the REST adapter with the already-defined `addRole`/`removeRole` operations (Discord member-role PUT/DELETE) so dashboard remaps can resynchronize active assignments without a gateway client.
- `fetchRecentMessages` returns message ID, author user ID, creation time, and deletability metadata only; it does not make Knight hierarchy decisions.
- Produces `parseTimeoutDuration(value): number` returning milliseconds and rejecting values above Discord's 28-day timeout ceiling.

- [ ] **Step 1: Write RED adapter/parser tests**

Test `10m`, `1h`, `1d`, exactly `28d`, excessive `29d`, malformed values, and zero/negative values. Mock discord.js guild/member/channel calls to prove each adapter method invokes the expected narrow API without embedding Knight policy. Extend existing REST and discord.js guild-state tests to assert role `name`, `managed`, position, and permissions are preserved, and REST role add/remove uses the exact guild-member-role routes.

- [ ] **Step 2: Run RED**

Run discord package tests plus `parse-duration.test.ts`. Expected: FAIL for missing methods/parser.

- [ ] **Step 3: Implement minimal adapter methods and parser**

Use discord.js native moderation methods. Bulk-message fetch/delete must be channel-scoped and reject non-text-capable contexts safely. Never fetch message content unless required for deletion; Message Content intent remains unnecessary.

- [ ] **Step 4: Run GREEN**

Run `pnpm --filter @knight/discord test`, `pnpm --filter @knight/discord typecheck`, targeted bot parser tests, and bot typecheck.

- [ ] **Step 5: Commit**

`git add packages/discord apps/bot/src/moderation/parse-duration* && git commit -m "feat: add Discord moderation adapter operations"`

---

### Task 6: Durable warn + warning-history commands

**Files:**
- Create: `apps/bot/src/commands/member/warn.ts`
- Create: `apps/bot/src/commands/member/warn.test.ts`
- Create: `apps/bot/src/commands/member/warnings.ts`
- Create: `apps/bot/src/commands/member/warnings.test.ts`
- Modify: `apps/bot/src/index.ts`

**Interfaces:**
- `/member warn` uses the shared moderation executor with action `member.warn` and `correlation:'none'`, writes the warning as the allowed Knight-only mutation, then attempts DM delivery as a secondary side effect.
- `/member warnings` uses `evaluateCapability` with `member.warnings.view`, reads `WarningRepository.listForUser`, and does not consume a rate limit or apply target hierarchy.

- [ ] **Step 1: Write RED warning command tests**

Cover permission denial, higher/equal-rank denial for issuing warnings, rate exhaustion, durable warning creation on allow, DM success status, DM failure status with warning preserved, and no secret/internal error leakage.

- [ ] **Step 2: Write RED history tests**

Prove lower-ranked staff with `member.warnings.view` can read a higher-ranked user's warnings; staff without permission cannot; owner can; output is newest-first and safely truncated to Discord reply limits.

- [ ] **Step 3: Run RED**

Run targeted warn/warnings tests. Expected: FAIL because handlers are missing.

- [ ] **Step 4: Implement handlers**

Persist warning before DM. DM failure becomes partial success, not rollback. Warning-history lookup never creates an execution correlation because it is read-only.

- [ ] **Step 5: Run GREEN and commit**

Run bot tests/typecheck, then `git add apps/bot/src/commands/member apps/bot/src/index.ts && git commit -m "feat: add durable member warnings"`.

---

### Task 7: Timeout, kick, and unban commands

**Files:**
- Create/test: `apps/bot/src/commands/member/timeout.ts`, `timeout.test.ts`
- Create/test: `apps/bot/src/commands/member/kick.ts`, `kick.test.ts`
- Create/test: `apps/bot/src/commands/member/unban.ts`, `unban.test.ts`**Interfaces:**
- Each command delegates policy/rank/rate/correlation work to the shared moderation executor.
- Unban uses durable Knight staff state for the target rank because the target is no longer a guild member.

- [ ] **Step 1: Write RED timeout tests**

Assert invalid duration rejects before authorization, lower/equal-rank targets deny, allowed action creates correlation before `timeoutMember`, per-action rate exhaustion blocks mutation, and Discord rejection is reported safely.

- [ ] **Step 2: Write RED kick tests**

Mirror the shared invariants for `member.kick` and prove the executor receives the correct action ID.

- [ ] **Step 3: Write RED unban tests**

Use a banned target with an active durable Staff Profile. Assert lower-ranked actor is denied even though `getMemberState` cannot return a guild member; higher-ranked/owner actors may proceed when policy allows.

- [ ] **Step 4: Implement the three thin handlers**

Keep only command-specific input validation, mutation arguments, and user-facing wording in each file. Do not duplicate hierarchy or rate logic.

- [ ] **Step 5: Run GREEN**

Run targeted tests, full bot tests, and bot typecheck.

- [ ] **Step 6: Commit**

`git add apps/bot/src/commands/member && git commit -m "feat: add timeout kick and unban commands"`

---

### Task 8: Hierarchy-safe message purge

**Files:**
- Create: `apps/bot/src/commands/message/purge.ts`
- Create: `apps/bot/src/commands/message/purge.test.ts`
- Create: `apps/bot/src/moderation/purge-planner.ts`
- Create: `apps/bot/src/moderation/purge-planner.test.ts`**Interfaces:**
- Produces a pure purge planner that classifies fetched messages into deletable/protected/ineligible groups using guild owner ID and durable Knight ranks.
- `/message purge` authorizes `message.purge` once for the actor and additionally prevents the bulk operation from deleting messages authored by protected equal/higher staff or the guild owner.

- [ ] **Step 1: Write RED pure planner tests**

Cover owner-authored messages, equal/higher-ranked staff, lower-ranked staff, ordinary members, unknown elevated members, old/ineligible messages, and optional user filtering. Assert protected messages are skipped, never sent to deletion.

- [ ] **Step 2: Write RED command tests**

Validate `count` 1–100 before policy; with `user` filter apply normal target hierarchy before fetch/delete; without filter consume one `message.purge` action budget and report deleted/protected/ineligible counts.

- [ ] **Step 3: Run RED**

Run targeted purge tests. Expected: FAIL because planner/handler do not exist.

- [ ] **Step 4: Implement planner and command**

Fetch only the requested bounded recent window, resolve unique author Staff Profiles in a guild-scoped way, plan deletion in application code, then create execution correlation immediately before deletion. Never let Discord adapter decide Knight hierarchy.

- [ ] **Step 5: Run GREEN and commit**

Run bot tests/typecheck; commit with `git add apps/bot/src/commands/message apps/bot/src/moderation/purge-planner* && git commit -m "feat: add hierarchy-safe message purge"`.

---

### Task 9: Slash registration, router wiring, and dependency composition

**Files:**
- Modify: `apps/bot/src/register-commands.ts`
- Modify: `apps/bot/src/register-commands.test.ts`
- Modify: `apps/bot/src/commands/router.ts`
- Modify: `apps/bot/src/commands/router.test.ts`
- Modify: `apps/bot/src/index.ts`**Interfaces:**
- Registers `/member warn|warnings|timeout|kick|ban|unban` and `/message purge` with the exact approved arguments.
- Router remains a parser/dispatcher only and injects shared repositories/services.

- [ ] **Step 1: Write RED registration tests**

Assert exact command/subcommand names, required/optional options, timeout duration string, unban `user_id` string, purge count range 1–100, and no Message Content-dependent options.

- [ ] **Step 2: Write RED router tests**

Build interactions for every new subcommand and assert parsed Discord IDs/reasons/duration/count reach the correct handler. Assert guild-only and ephemeral reply behavior stays intact.

- [ ] **Step 3: Run RED**

Run registration/router tests. Expected: FAIL for missing command definitions/routes.

- [ ] **Step 4: Wire commands and runtime dependencies**

Add the new top-level `message` command to `KNIGHT_COMMANDS`; instantiate `WarningRepository` and the expanded Discord adapter dependencies in bot startup. Reuse one moderation-executor dependency bundle.

- [ ] **Step 5: Run GREEN**

Run all bot tests/typecheck/build. Expected: PASS and command JSON contains the full moderation surface.

- [ ] **Step 6: Commit**

`git add apps/bot/src && git commit -m "feat: register complete moderation commands"`

---

### Task 10: Expand Guarded native-permission migration

**Files:**
- Modify: `apps/bot/src/setup/guarded-migration-service.ts`
- Modify: `apps/bot/src/setup/guarded-migration-service.test.ts`
- Modify as needed: `packages/contracts/src/setup.ts`
- Modify: `docs/setup/07-enable-guarded-permissions.md`**Interfaces:**
- Guarded replacement mapping becomes Ban Members, Kick Members, Moderate Members, and Manage Messages.
- Preview unions affected native bits per mapped role whether or not that profile currently grants the Knight replacement.
- Each role is snapshotted once per migration and rollback restores its exact original bigint.

- [ ] **Step 1: Write RED migration tests**

Cover each bit independently, multiple guarded bits on one role, a mapped profile with native permission but no Knight grant, snapshot-before-any-mutation ordering, blocked hierarchy causing zero mutations, and exact rollback.

- [ ] **Step 2: Run RED**

Run `pnpm --filter @knight/bot test -- guarded-migration-service.test.ts`.
Expected: FAIL because preview currently knows only Ban Members.

- [ ] **Step 3: Implement generalized permission masks**

Compute a single `after = before & ~guardedMask` for every affected role. Store one original bigint snapshot before mutation. Preserve every unrelated Discord permission bit.

- [ ] **Step 4: Update setup copy/docs**

Replace ban-only Guarded wording with explicit replacement mapping and rollback warning. Do not claim warnings are a native-permission replacement.

- [ ] **Step 5: Run GREEN and commit**

Run setup tests, full bot tests/typecheck; commit `git add apps/bot/src/setup packages/contracts/src/setup.ts docs/setup/07-enable-guarded-permissions.md && git commit -m "feat: guard native moderation permissions"`.

---

### Task 11: Dashboard Staff Profile creation and metadata editing service

**Files:**
- Modify: `apps/web/lib/staff-profile-service.ts`
- Modify: `apps/web/lib/staff-profile-service.test.ts`
- Modify: `apps/web/lib/server-dependencies.ts`
- Modify: `apps/web/lib/server-runtime.ts`
- Modify: `apps/web/app/guilds/[guildId]/staff/actions.ts`
- Modify: `apps/web/app/guilds/[guildId]/staff/actions.test.ts`
- Create: `apps/web/lib/discord-runtime.ts`
- Modify: `apps/web/lib/setup-runtime.ts`

**Interfaces:**
- Produces `createStaffProfileFromDashboard` and `updateStaffProfileFromDashboard` service methods.
- Validates the selected Discord role exists in the same guild, is below Knight, is manageable, and guild mode is not `GUARDED` for create/remap.
- Uses the existing owner/Security Manager authority model plus self-escalation/grant-ceiling checks.

- [ ] **Step 1: Write RED creation tests**

Owner creation succeeds with v1 containing no permissions and unlimited/no finite policies. Security Manager may only create below their rank/grant ceiling. Missing/cross-guild/unmanageable role denies. Creation in `GUARDED` denies before persistence.

- [ ] **Step 2: Write RED edit tests**

Cover name/rank/role changes creating immutable v2, old version metadata preserved, self-rank increase denied, peer/above-manager edit denied, mapped-role change in `GUARDED` denied, and successful remap resyncing active assignments old-role → new-role.

- [ ] **Step 3: Run RED**

Run web service/action tests against a disposable database where required.
Expected: FAIL for missing create/edit service paths.

- [ ] **Step 4: Implement services/server actions**

Actor identity comes only from Auth.js session. Add `getWebDiscordAdapter(runtime)` in `discord-runtime.ts` to construct the bot-token REST adapter once per request path; reuse it from `setup-runtime.ts` and Staff Profile actions. Fetch role catalog server-side, and keep role mutation limited to assignment resync via `addRole`/`removeRole`; never create, rename, reorder, or arbitrarily edit Discord roles.

- [ ] **Step 5: Preserve repair semantics**

If metadata persistence succeeds but mapped-role resync fails for an assignment, mark it `NEEDS_REPAIR` and surface that status rather than rolling authority back ambiguously.

- [ ] **Step 6: Run GREEN and commit**

Run web tests/typecheck; commit `git add apps/web/lib apps/web/app/guilds/[guildId]/staff && git commit -m "feat: manage staff profiles from dashboard"`.

---

### Task 12: Per-action policy parsing and Staff Profile editor UI

**Files:**
- Modify: `apps/web/lib/staff-profile-service.ts`
- Modify: `apps/web/lib/staff-profile-service.test.ts`
- Modify: `apps/web/app/guilds/[guildId]/staff/[profileId]/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/staff/rate-limit-editor.tsx`
- Modify: `apps/web/app/guilds/[guildId]/staff/actions.ts`
- Modify: `apps/web/app/guilds/[guildId]/staff/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Policy input becomes `permissions: ActionId[]` plus `actionPolicies` for each rate-limited action rather than ban-specific `banWindows`.
- Client rate-limit editor only controls progressive form visibility/add/remove rows; server schema validates all values and remains authoritative.

- [ ] **Step 1: Write RED parsing/service tests**

For warn/timeout/kick/ban/unban/purge, test enabled+unlimited, enabled+one/two/three finite windows, disabled action discarding stale submitted windows, >3 windows rejection, partial row rejection, and independent budgets. Test `member.warnings.view` has no action policy/rate input.

- [ ] **Step 2: Run RED**

Run `pnpm --filter @knight/web test -- staff-profile-service.test.ts actions.test.ts`.
Expected: FAIL because the service/action is ban-specific.

- [ ] **Step 3: Generalize server validation**

Use `RATE_LIMITED_MODERATION_ACTIONS` from contracts. Parse human-friendly `{max, amount, unit}` form values into millisecond `RateWindow`s server-side; accepted units are minute/hour/day with positive integers and checked multiplication.

- [ ] **Step 4: Build capability rows**

Render Warn, View warning history, Timeout, Kick, Ban, Unban, Purge. Disabled permissions hide finite-limit controls. Enabled mutating actions show Unlimited/Custom; Custom begins with one row and allows up to three. Warning-history is explicitly labeled read-only with no rate control.

- [ ] **Step 5: Add create-profile UI to Staff Profiles page**

Show profile name, existing Discord role selector by role name, and Knight rank. Keep raw role IDs secondary metadata, not the primary label.

- [ ] **Step 6: Run GREEN and commit**

Run web tests/typecheck/build; commit `git add apps/web && git commit -m "feat: edit moderation policy in dashboard"`.

---

### Task 13: Discord-inspired dashboard shell and navigation

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/guilds/[guildId]/layout.tsx`
- Modify: `apps/web/app/guilds/[guildId]/page.tsx`
- Modify: `apps/web/app/guilds/[guildId]/setup/page.tsx`
- Modify: `apps/web/app/guilds/[guildId]/staff/page.tsx`- Modify: `apps/web/app/guilds/[guildId]/staff/[profileId]/page.tsx`
- Create: `apps/web/lib/dashboard-structure.test.ts`

**Interfaces:**
- Guild layout provides persistent Overview / Staff Profiles / Setup navigation.
- Styling is flat, dark, compact, responsive, keyboard-usable, and contains no CSS gradients or large decorative shadows.

- [ ] **Step 1: Write RED structural tests**

Read/render the relevant dashboard structure and assert guild navigation links exist. Read `globals.css` and assert it contains neither `linear-gradient` nor `radial-gradient`; assert accessible focus styles and responsive navigation rules are present.

- [ ] **Step 2: Run RED**

Run web tests. Expected: FAIL because current CSS uses `radial-gradient` and guild layout returns only children.

- [ ] **Step 3: Implement the shell**

Use neutral Discord-like charcoal levels, subtle 1px separators, small-radius controls/cards, restrained accent states, compact headers, and a persistent guild sidebar. Do not copy Discord logos, trademarks, or exact branded artwork.

- [ ] **Step 4: Rework existing pages into the shell**

Remove redundant back-link navigation where the sidebar replaces it. Keep Observe/Test/Guarded and danger states visually distinct using solid fills/borders/text, not gradients.

- [ ] **Step 5: Verify responsive/accessibility behavior**

Build the web app, inspect server-rendered pages at desktop/narrow widths, tab through forms/navigation, and verify labels remain associated with controls.

- [ ] **Step 6: Run GREEN and commit**

Run web lint/test/typecheck/build; commit `git add apps/web && git commit -m "style: redesign Knight dashboard shell"`.

---

### Task 14: Documentation, full verification, Compose rollout, and private smoke

**Files:**
- Modify: `docs/staff/staff-profiles.md`
- Modify: `docs/staff/limits.md`
- Modify: `docs/setup/06-first-run.md`
- Modify: `docs/setup/07-enable-guarded-permissions.md`
- Modify: `docs/troubleshooting/doctor.md`
- Modify as needed: `README.md`**Interfaces:**
- Docs describe the exact implemented command names, dashboard flow, rate-limit semantics, hierarchy behavior, warning-history permission, and expanded Guarded replacement mapping.
- Completion evidence distinguishes automated tests, non-destructive live checks, and any real destructive smoke that was actually exercised.

- [ ] **Step 1: Update operator/user docs**

Document profile creation in the dashboard, existing-role mapping, rank meaning, per-action limits, warning history, timeout duration examples, and why lower-ranked staff cannot mutate equal/higher staff. Explain that warning-history lookup is the deliberate read-only exception.

- [ ] **Step 2: Run full automated gates against disposable services**

Use disposable PostgreSQL/Redis ports and command-local URLs. Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
docker build --tag knight-ci .
```

- [ ] **Step 3: Run the Docker non-root/runtime import gate**

Verify the final image runs as non-root, workspace/lock files are readable, database tooling executes, and bot/worker workspace TypeScript imports load exactly as CI expects.

- [ ] **Step 4: Rebuild Compose from the exact final tree**

Run `docker compose up -d --build`; verify migrate exits successfully, postgres/redis/web are healthy, bot/worker remain running without restart loops, `/api/health/live` is live, and `/api/health/ready` reports PostgreSQL/Redis OK.

- [ ] **Step 5: Verify command registration without destructive mutations**

Confirm global/application command JSON includes member warn/warnings/timeout/kick/ban/unban and message purge with exact option shapes. Run `/doctor` and `/setup`; confirm no secrets appear.

- [ ] **Step 6: Private-guild smoke within safe boundaries**

Use disposable roles/accounts/messages only. Verify dashboard profile create/edit, action-specific limits, warning persistence/history, lower-rank moderation denial, command wiring, Guarded four-bit preview, snapshot-before-enable, and exact rollback. If no disposable member is available, simulate final destructive mutation ports and explicitly report that real kick/timeout/ban was not exercised.

- [ ] **Step 7: Final repository state check**

Confirm worktree contains only intended changes, generated build artifacts are absent, and `git diff --check` is clean. Commit any final docs/fixes with a focused message.

- [ ] **Step 8: Do not push without explicit user instruction**

Report local commit SHAs and verification results. Push and exact-SHA GitHub Actions verification only after the user explicitly asks for or authorizes the push.

---## Final verification checklist

- [ ] Existing Staff Profiles retain their exact permission/action-policy state after migration.
- [ ] `member.warnings.view` is the only newly added canonical capability and is not silently granted.
- [ ] Warn, timeout, kick, ban, unban, and purge use shared Knight authorization/rate/decision machinery.
- [ ] Non-owner moderation denies equal/higher Knight-ranked targets and protects the guild owner.
- [ ] Warning-history lookup ignores target rank but still requires owner or explicit `member.warnings.view` authority.
- [ ] Warning persistence survives DM delivery failure and records delivery status.
- [ ] Unban hierarchy uses durable Knight assignment/profile state for banned users.
- [ ] Purge cannot delete messages authored by protected equal/higher staff or the guild owner.
- [ ] Each rate-limited action has an independent Redis budget and supports unlimited or up to three finite windows.
- [ ] Dashboard can create Staff Profiles mapped only to existing manageable Discord roles.
- [ ] Profile name, mapped role, rank, permissions, and action policies are immutable-versioned.
- [ ] Security Managers cannot self-escalate, edit/create peer-or-higher authority, or exceed their grant ceiling.
- [ ] Profile create/remap is denied while the guild is in `GUARDED`.
- [ ] Guarded strips only Ban Members, Kick Members, Moderate Members, and Manage Messages from mapped staff roles.
- [ ] Guarded preview unions bits per role, snapshots once before mutations, blocks unsafe hierarchy, and rollback restores exact bigints.
- [ ] Dashboard has persistent Overview / Staff Profiles / Setup navigation.
- [ ] Dashboard CSS contains no gradients and remains responsive/keyboard-accessible.
- [ ] Full lint/typecheck/test/build, Docker build/runtime gate, Compose health, and `git diff --check` pass.
- [ ] Live-smoke report clearly separates real Discord mutations from simulations/non-destructive checks.

## Execution order

Tasks are intentionally ordered so every later surface consumes already-tested lower-level behavior: contracts → durable data → pure security → shared executor → Discord primitives → commands → routing → Guarded → dashboard services → dashboard policy UI → visual shell → rollout. Do not skip forward to UI wiring before the underlying policy/data task is green.