# Lockdown and Panic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, simple emergency privilege freeze with fixed lockdown scopes and Panic controls in Discord and the dashboard.

**Architecture:** One PostgreSQL row per guild stores `NORMAL`, `LOCKDOWN`, or `PANIC` plus fixed scopes. The existing authorization context reads this state and denies covered actions before grants/rate limits. Panic records to the Security Ledger and blocks privileged Knight mutations; it does not perform broad role stripping.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, discord.js slash commands, Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-local-security-platform-completion-design.md`

## Global Constraints

- Fixed scopes only: `MEMBER_MODERATION`, `ROLES`, `CHANNELS`, `BOTS_WEBHOOKS`, `SECURITY_CONFIG`, `FULL`.
- No generic rule engine or arbitrary scope expressions.
- Panic is a reliable privilege freeze, not automatic server-wide mutation.
- Status/read-only operations remain available during Panic.
- Owner and explicit Knight Security Managers may operate emergency controls; Panic requires explicit confirmation.
- All emergency-state changes are durable and ledgered before user-facing success is reported.

---

### Task 1: Add emergency-state contracts and persistence

**Files:**
- Create: `packages/contracts/src/emergency.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/database/src/schema/security.ts`
- Modify: `packages/database/src/repositories/security-repository.ts`
- Modify: `packages/database/src/repositories/security-repository.test.ts`
- Generate additive migration under `packages/database/migrations/`.

**Interfaces:**
- `SecurityStateMode = 'NORMAL' | 'LOCKDOWN' | 'PANIC'`.
- `SecurityLockdownScope` is the six-value union above.
- `SecurityRepository.getSecurityState(guildId)` returns neutral Normal when no row exists.
- `SecurityRepository.setSecurityState(input)` persists mode, scopes, reason, actor, and timestamp.

- [ ] **Step 1: Write failing repository tests**

Assert a missing row reads as Normal, Lockdown persists one or more valid scopes, Panic ignores/clears ordinary scopes, and guild state cannot leak across guild IDs.

- [ ] **Step 2: Run database tests and confirm RED**

Run: `pnpm --filter @knight/database test -- security-repository.test.ts`
Expected: FAIL because emergency persistence is missing.

- [ ] **Step 3: Implement contracts, table, and repository methods**

Store scopes as a small JSON string array with a database check on mode. `setSecurityState()` replaces the complete state atomically; do not accumulate hidden prior scopes.

- [ ] **Step 4: Generate migration and rerun tests**

Run: `pnpm --filter @knight/database exec drizzle-kit generate`
Run: `pnpm --filter @knight/database test -- security-repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/database
git commit -m "feat: persist emergency security state"
```

### Task 2: Enforce Lockdown/Panic in the central policy path

**Files:**
- Modify: `packages/security/src/authorization/types.ts`
- Modify: `packages/security/src/authorization/evaluate-policy.ts`
- Modify: `packages/security/src/authorization/evaluate-policy.test.ts`
- Modify: `apps/bot/src/moderation/staff-state-port.ts`
- Modify: `apps/bot/src/index.ts`

**Interfaces:**
- `AuthorizationEmergencyState` becomes `{ mode: SecurityStateMode; lockedScopes: readonly SecurityLockdownScope[] }`.
- `ModerationStaffStateDependencies` consumes `security.getSecurityState(guildId)`.

- [ ] **Step 1: Write failing pure-policy tests**

Cover: member moderation blocked by `MEMBER_MODERATION`; staff/profile/policy/security-manager changes blocked by `SECURITY_CONFIG`; `FULL` blocks all privileged actions; `PANIC` blocks all mutating action IDs; Normal preserves current behavior.

- [ ] **Step 2: Implement a fixed action-to-scope map**

Use small sets in `evaluate-policy.ts`; do not add configurable mappings. Run emergency checks before temporary grants, permission grants, or rate limits.

- [ ] **Step 3: Load real state in `staff-state-port.ts`**

Fetch `getSecurityState()` alongside actor/target state and remove the current hard-coded `memberModerationLocked: false` value.

- [ ] **Step 4: Run security and bot tests**

Run: `pnpm --filter @knight/security test && pnpm --filter @knight/bot test -- staff-state-port.test.ts moderation-executor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/security apps/bot/src/moderation apps/bot/src/index.ts
git commit -m "feat: enforce emergency security state"
```

### Task 3: Add emergency service and Discord commands

**Files:**
- Create: `apps/bot/src/security/emergency-service.ts`
- Create: `apps/bot/src/security/emergency-service.test.ts`
- Create: `apps/bot/src/commands/security/emergency.ts`
- Modify: `apps/bot/src/register-commands.ts`
- Modify: `apps/bot/src/register-commands.test.ts`
- Modify: `apps/bot/src/commands/router.ts`
- Modify: `apps/bot/src/commands/router.test.ts`
- Modify: `apps/bot/src/index.ts`

**Interfaces:**
- `EmergencyService.status(guildId)` returns current mode/scopes/reason.
- `lockdown({ guildId, actorUserId, scopes, reason })`, `unlock(...)`, `panic(..., confirmed)`, and `clearPanic(...)` authorize owner/Security Manager, persist state, then ledger the change.

- [ ] **Step 1: Write failing service authorization/state tests**

Assert ordinary staff cannot change emergency state, Security Managers can Lockdown/Panic, Panic without `confirmed: true` is rejected, and every successful transition records a SECURITY ledger entry.

- [ ] **Step 2: Register exact command shapes**

Add `/security status`, `/security lockdown scope:<choice> reason:<text>`, `/security unlock reason:<text>`, `/security panic reason:<text> confirm:<boolean>`, and `/security panic-clear reason:<text>`. Keep existing manager-add/remove subcommands.

- [ ] **Step 3: Route commands to `EmergencyService`**

All replies stay ephemeral. `status` is read-only; mutation failures use safe messages and never claim state changed when persistence failed.

- [ ] **Step 4: Run registration/router/service tests and commit**

Run: `pnpm --filter @knight/bot test`
Expected: PASS.

```bash
git add apps/bot
git commit -m "feat: add lockdown and panic commands"
```

### Task 4: Add simple emergency controls to the Security dashboard

**Files:**
- Modify: `apps/web/app/guilds/[guildId]/security/page.tsx`
- Modify: `apps/web/app/guilds/[guildId]/security/actions.ts`
- Modify: `apps/web/app/guilds/[guildId]/security/actions.test.ts`
- Modify: `apps/web/lib/server-dependencies.ts`

**Interfaces:**
- Reuse `EmergencyService` semantics: current state, fixed scope select, reason, explicit Panic checkbox.

- [ ] **Step 1: Write failing dashboard action tests**

Cover owner/Security-Manager access, fixed scope validation, Panic confirmation, and current-state rendering. Reject arbitrary scope strings.

- [ ] **Step 2: Implement the controls**

Show one compact current-state panel. Use separate forms for Lockdown, Unlock, Panic, and Panic Clear; require a reason on every mutation and a checkbox on Panic.

- [ ] **Step 3: Make firewall enforcement respect emergency state**

In Slice-2 `FirewallService`, read current security state before a destructive ENFORCE removal. Panic may continue removing entries already marked `BLOCKED`; ordinary Lockdown with `BOTS_WEBHOOKS` blocks configuration changes but does not invent new removal rules.

- [ ] **Step 4: Run full slice verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && git diff --check`
Expected: all exit 0. Rebuild Docker/Compose and confirm health endpoints and zero restart loops.

- [ ] **Step 5: Update operational docs and commit**

Update `docs/setup/06-first-run.md` and add a concise emergency section under `docs/security/` describing scopes, Panic behavior, and recovery/status availability.

```bash
git add apps/web apps/bot/src/security docs/security docs/setup/06-first-run.md
git commit -m "feat: manage emergency security controls"
```
