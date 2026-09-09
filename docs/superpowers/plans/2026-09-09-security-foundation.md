# Knight Security Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Knight's first working security milestone: the self-hosted monorepo/runtime, PostgreSQL + Redis state, custom Staff Profiles, shared Guarded authorization, a guarded `/member ban` vertical slice, Discord OAuth dashboard authorization, explicit Security Managers, and Observe → Test → Guarded setup for bans.

**Architecture:** `packages/security` owns pure security decisions; `packages/database` owns durable state; `packages/redis` owns ephemeral counters, locks, and execution correlations; `packages/discord` is the discord.js adapter. Bot and web surfaces call shared services and never duplicate security rules.

**Tech Stack:** Node.js 24 LTS, pnpm 12.4, TypeScript, discord.js 14.27.x, Next.js 16.3.x, React, Auth.js/NextAuth Discord provider, Drizzle ORM 0.44.7, PostgreSQL, Redis, Zod, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-09-knight-security-platform-design.md`

## Global Constraints

- Self-hosted only; one instance may protect multiple guilds.
- Dashboard authentication is Discord OAuth only.
- Discord `Administrator` does not automatically grant Knight security access.
- PostgreSQL is authoritative; Redis is disposable operational state.
- Destructive Guarded actions fail closed when policy/rate state cannot be established.
- Knight staff assignment is authority; mapped Discord role possession alone is not.
- No direct or indirect self-escalation.
- Restrictions, quarantine/protected-target state, and emergency locks override grants.
- Guild owner retains ultimate Knight authority.
- Entering Guarded requires explicit guild-owner approval and a permission snapshot.
- This milestone guards **only `member.ban`**. Never strip a Discord permission until Knight has a replacement action for it.
- Message Content intent is not required in this milestone.
- Node.js runtime: `>=24.17.0 <25`.
- Stable Drizzle 0.44.7; do not use Drizzle 1.0 beta.
- Every guild-scoped repository method takes and filters on `guildId`.
- Slash handlers, route handlers, and React components contain no independent security-policy logic.

## Milestone completion boundary

A completed foundation can:

1. Start bot/web/worker with PostgreSQL + Redis.
2. Authenticate dashboard users with Discord OAuth database sessions.
3. Authorize the guild owner and explicitly granted Security Managers while denying an arbitrary Discord Administrator.
4. Create/version Staff Profiles mapped to real Discord roles.
5. Assign/remove staff and synchronize the mapped role without treating the role itself as authority.
6. Evaluate `member.ban` using one shared policy engine with permission, hierarchy, protected-target, rate-window, and emergency-state checks.
7. Deny unauthorized/rate-limited bans before Discord mutation.
8. Store durable decisions in PostgreSQL and short-lived execution correlations in Redis.
9. Persist Observe → Test state.
10. Preview Test → Guarded, snapshot affected role permissions, remove only native `Ban Members`, and roll back.
11. Expose the same setup/health facts in Discord and the web dashboard.
12. Provide beginner setup docs from Discord application creation through Guarded ban mode.

Full native anti-nuke incidents, Security Ledger, backups/recovery, bot/webhook firewall, raid protection, anomaly scoring, and full dashboard pages are separate follow-up plans.

---

### Task 1: Bootstrap workspace and quality gates

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `prettier.config.mjs`, `.gitignore`, `.env.example`, `vitest.workspace.ts`
- Create manifests/tsconfigs: `apps/bot`, `apps/web`, `apps/worker`, `packages/config`, `packages/contracts`, `packages/database`, `packages/redis`, `packages/security`, `packages/discord`

**Produces:** workspace packages `@knight/bot`, `@knight/web`, `@knight/worker`, `@knight/config`, `@knight/contracts`, `@knight/database`, `@knight/redis`, `@knight/security`, `@knight/discord` and root scripts `lint`, `typecheck`, `test`, `build`.

- [ ] **Step 1: Create root package/workspace files**

```json
{
  "name": "knight",
  "private": true,
  "packageManager": "pnpm@12.4.0",
  "engines": { "node": ">=24.17.0 <25" },
  "scripts": {
    "build": "pnpm -r --if-present build",
    "dev": "pnpm -r --parallel --if-present dev",
    "lint": "pnpm -r --if-present lint",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "vitest run --workspace vitest.workspace.ts"
  }
}
```

```yaml
packages:
  - "apps/*"
  - "packages/*"
minimumReleaseAge: 1440
```

- [ ] **Step 2: Add strict shared TypeScript/tooling**

`tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `resolveJsonModule`, and ES2023. Library packages are ESM; bot/worker use NodeNext; web uses Next.js app-compatible TS settings.

```bash
corepack enable
pnpm add -Dw typescript eslint @eslint/js typescript-eslint prettier vitest zod
```

Every library manifest has `lint`, `typecheck`, `test`; bot/worker also have `build/dev/start`; web has `next dev/build/start`.

- [ ] **Step 3: Add secret-safe environment template**

```dotenv
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
AUTH_SECRET=
APP_URL=http://localhost:3000
DATABASE_URL=postgres://knight:knight@localhost:5432/knight
REDIS_URL=redis://:knight@localhost:6379
POSTGRES_PASSWORD=knight
REDIS_PASSWORD=knight
```

`.gitignore` ignores `.env`, `.env.*` except `.env.example`, build output, logs, coverage, and node modules.

- [ ] **Step 4: Verify scaffold**

```bash
node --version
pnpm --version
pnpm install
pnpm typecheck
```

Expected: Node satisfies the engine; pnpm is 12.4.x; install/typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: bootstrap Knight monorepo"
```

---

### Task 2: Canonical env/security contracts

**Files:**
- Create: `packages/config/src/env.ts`, `env.test.ts`, `index.ts`
- Create: `packages/contracts/src/actions.ts`, `policy.ts`, `staff.ts`, `setup.ts`, `index.ts`, `contracts.test.ts`

**Produces:** `KnightEnv`, `ActionId`, `ACTION_IDS`, `PolicyDecision`, `SecurityDecision`, `RateWindow`, `ActionPolicy`, `GuildMode`, `SetupStep`, `ProtectionLevel`, `StaffProfileSnapshot`.

- [ ] **Step 1: Write failing env test**

```ts
expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
expect(parseEnv({
  NODE_ENV: "test", DISCORD_TOKEN: "t", DISCORD_CLIENT_ID: "1",
  DISCORD_CLIENT_SECRET: "s", AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://knight:knight@localhost:5432/knight",
  REDIS_URL: "redis://localhost:6379"
}).NODE_ENV).toBe("test");
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @knight/config test
```

- [ ] **Step 3: Implement Zod env schema**

Required: `NODE_ENV`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `AUTH_SECRET(min 32)`, `APP_URL(url)`, `DATABASE_URL(url)`, `REDIS_URL(url)`.

- [ ] **Step 4: Write failing contract test and implement contracts**

```ts
export const ACTION_IDS = [
  "member.warn", "member.timeout", "member.kick", "member.ban", "member.unban",
  "message.purge", "security.staff.assign", "security.staff.remove",
  "security.staff.manage_profiles", "security.security_managers.manage",
  "security.policy.view", "security.policy.edit", "security.approvals.approve",
  "security.lockdown", "security.panic"
] as const;

export type ActionId = (typeof ACTION_IDS)[number];
export enum PolicyDecision { Allow = "ALLOW", Deny = "DENY", RequireApproval = "REQUIRE_APPROVAL", Contain = "CONTAIN" }
export enum GuildMode { Observe = "OBSERVE", Test = "TEST", Guarded = "GUARDED" }
export enum ProtectionLevel { Normal = "NORMAL", Important = "IMPORTANT", Critical = "CRITICAL", Immutable = "IMMUTABLE" }
export type RateWindow = Readonly<{ max: number; windowMs: number }>;
export type ActionPolicy = Readonly<{ enabled: boolean; unlimited: boolean; rateWindows: readonly RateWindow[] }>;
```

`SecurityDecision` carries decision/code/reason/policyVersionId/metadata. `StaffProfileSnapshot` carries guild/profile/version/role IDs, rank, permissions, action policies. `SetupStep`: `WELCOME|HEALTH|STAFF|POLICIES|LOGGING|PROTECTION|BACKUPS|OBSERVE|COMPLETE`.

- [ ] **Step 5: Verify GREEN**

```bash
pnpm --filter @knight/config test
pnpm --filter @knight/contracts test
pnpm --filter @knight/config typecheck
pnpm --filter @knight/contracts typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/config packages/contracts
git commit -m "feat: define Knight security contracts"
```

---

### Task 3: PostgreSQL schema + guild-scoped repositories

**Files:**
- Create: `packages/database/drizzle.config.ts`, `src/client.ts`
- Create schema: `src/schema/guilds.ts`, `staff.ts`, `policies.ts`, `auth.ts`, `index.ts`
- Create repos: `guild-repository.ts`, `staff-repository.ts`, `security-manager-repository.ts`, `policy-decision-repository.ts`
- Create: `packages/database/src/index.ts`
- Test: `tests/integration/database/staff-repository.test.ts`

**Produces:** `GuildRepository`, `StaffRepository`, `SecurityManagerRepository`, `PolicyDecisionRepository`.

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @knight/database add drizzle-orm@0.44.7 pg @knight/contracts@workspace:*
pnpm --filter @knight/database add -D drizzle-kit @types/pg
```

- [ ] **Step 2: Write failing isolation/version tests**

Test that a `guildId=200` lookup never returns guild 100's assignment, and that two profile edits create immutable versions 1 and 2 while version 1 remains unchanged.

- [ ] **Step 3: Verify RED**

```bash
DATABASE_URL=postgres://knight:knight@localhost:5432/knight_test pnpm vitest run tests/integration/database/staff-repository.test.ts
```

- [ ] **Step 4: Implement schema**

Required tables:

```text
guilds(id text PK, owner_id text, mode text, created_at, updated_at)
setup_states(guild_id PK/FK, step text, completed_steps jsonb, updated_at)
staff_profiles(id uuid PK, guild_id, name, discord_role_id, rank, enabled, current_version_id, sync_mode)
staff_profile_versions(id uuid PK, guild_id, profile_id, version, permissions jsonb, action_policies jsonb, created_by, created_at)
staff_assignments(id uuid PK, guild_id, user_id, profile_id, active, sync_status, assigned_by, assigned_at, ended_at)
security_managers(guild_id, user_id, granted_by, granted_at)
staff_overrides(id uuid PK, guild_id, user_id, payload jsonb, created_by, created_at)
temporary_access(id uuid PK, guild_id, user_id, payload jsonb, expires_at, created_by)
guarded_categories(guild_id, category, enabled, updated_by, updated_at)
role_permission_snapshots(id uuid PK, guild_id, migration_id, role_id, permissions text, created_at)
policy_decisions(id uuid PK, guild_id, actor_user_id, action, target_id, decision, code, profile_version_id, metadata jsonb, created_at)
```

Constraints: unique profile `(guild_id,name)`, unique `(profile_id,version)`, partial unique active assignment `(guild_id,user_id)`, manager PK `(guild_id,user_id)`, non-negative rank/version.

Add Auth.js `users`, `accounts`, `sessions`, `verification_tokens` tables for `@auth/drizzle-adapter`; OAuth tokens never leave server code.

- [ ] **Step 5: Implement repository contracts**

```ts
StaffRepository.createProfile(input)
StaffRepository.createProfileVersion(input)
StaffRepository.assign(input)
StaffRepository.deactivateAssignment(input)
StaffRepository.getEffectiveProfile(guildId, userId)
StaffRepository.listProfiles(guildId)
SecurityManagerRepository.grant/revoke/isSecurityManager
GuildRepository.get/createOrUpdateOwner/setMode/getSetupState
PolicyDecisionRepository.record
```

All queries include guild scope. `createProfileVersion` transactionally inserts next immutable version then moves `current_version_id`.

- [ ] **Step 6: Generate/apply migration and verify GREEN**

```bash
pnpm --filter @knight/database drizzle-kit generate
pnpm --filter @knight/database drizzle-kit migrate
pnpm --filter @knight/database typecheck
DATABASE_URL=postgres://knight:knight@localhost:5432/knight_test pnpm vitest run tests/integration/database/staff-repository.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/database tests/integration/database
git commit -m "feat: add guild-scoped security database"
```

---

### Task 4: Redis atomic state

**Files:**
- Create: `packages/redis/src/client.ts`, `rate-limit-store.ts`, `lock-store.ts`, `execution-correlation-store.ts`, `index.ts`
- Tests: `rate-limit-store.test.ts`, `execution-correlation-store.test.ts`

**Produces:** `RateLimitStore`, `LockStore`, `ExecutionCorrelationStore`.

- [ ] **Step 1: Add Redis and write failing tests**

```bash
pnpm --filter @knight/redis add ioredis @knight/contracts@workspace:*
```

Test: third action in `{max:2,windowMs:60000}` is denied; two simultaneous attempts competing for one slot yield exactly one allow; correlation record expires and `consume()` returns it only once.

- [ ] **Step 2: Verify RED**

```bash
REDIS_URL=redis://localhost:6379 pnpm --filter @knight/redis test
```

- [ ] **Step 3: Implement rate limits atomically**

One Lua script removes expired sorted-set entries, checks every window, adds the event to all windows only if all pass, and sets expiry. Event member: `${nowMs}:${crypto.randomUUID()}`.

```ts
export type RateLimitResult = Readonly<{
  allowed: boolean;
  windows: readonly { max:number; windowMs:number; used:number; remaining:number; resetAtMs:number }[];
}>;
```

- [ ] **Step 4: Implement safe locks and correlations**

Lock: `SET key token NX PX ttl`; release Lua deletes only matching token.

```ts
export type ExecutionCorrelation = Readonly<{
  id: string; guildId: string; requestedByUserId: string; action: ActionId;
  targetId: string; expectedAuditActorBotId: string; createdAtMs: number;
}>;
```

Correlation default TTL is 60 seconds and lives only in Redis.

- [ ] **Step 5: Verify GREEN and commit**

```bash
REDIS_URL=redis://localhost:6379 pnpm --filter @knight/redis test
pnpm --filter @knight/redis typecheck
git add packages/redis
git commit -m "feat: add atomic security state in Redis"
```

---

### Task 5: Pure Staff Profile authorization + self-escalation

**Files:**
- Create: `packages/security/src/authorization/types.ts`, `effective-access.ts`, `evaluate-policy.ts`, `self-escalation.ts`
- Tests: `evaluate-policy.test.ts`, `self-escalation.test.ts`
- Create: `packages/security/src/index.ts`

**Produces:** `evaluatePolicy(context): SecurityDecision`, `wouldIncreaseOwnAuthority(input): boolean`.

- [ ] **Step 1: Write failing policy table tests**

Cases: Moderator with `member.ban` → lower member ALLOW; higher Knight rank DENY; missing permission DENY; emergency member-moderation lock DENY; temporary restriction overrides grant; guild owner target denied; elevated unregistered Discord target is never ordinary rank 0; protected target may REQUIRE_APPROVAL.

- [ ] **Step 2: Write failing self-escalation tests**

Cases: self-promotion; own-profile limit increase `2/30m -> 5/30m`; removing own restriction. All return `true` from `wouldIncreaseOwnAuthority`.

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @knight/security test
```

- [ ] **Step 4: Implement policy precedence**

```text
active assignment/owner authority
→ owner-target invariant
→ quarantine/emergency locks
→ temporary restrictions
→ effective canonical permission
→ target hierarchy/elevated-unregistered rule
→ protected-target approval
→ ALLOW
```

Stable codes include `NO_ACTIVE_STAFF_ASSIGNMENT`, `OWNER_TARGET_PROTECTED`, `LOCKDOWN_ACTIVE`, `TEMPORARILY_RESTRICTED`, `PERMISSION_MISSING`, `TARGET_OUTRANKS_ACTOR`, `APPROVAL_REQUIRED`, `ALLOWED`.

- [ ] **Step 5: Implement authority diff**

An increase is: higher rank, added canonical permission, higher finite action maximum, finite → unlimited, or removal of an active restriction affecting the actor.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm --filter @knight/security test
pnpm --filter @knight/security typecheck
git add packages/security
git commit -m "feat: add Staff Profile authorization engine"
```

---

### Task 6: Guarded orchestration + durable decision evidence

**Files:**
- Create: `packages/security/src/guarded/ports.ts`, `authorize-guarded-action.ts`, `authorize-guarded-action.test.ts`
- Modify: `packages/security/src/index.ts`, `packages/database/src/repositories/policy-decision-repository.ts`

**Produces:** `authorizeGuardedAction(request, ports): Promise<SecurityDecision>` using `StaffStatePort`, `RateLimitPort`, `DecisionLogPort`.

- [ ] **Step 1: Write failing orchestration tests**

Rate exhausted → `DENY/RATE_LIMIT_EXCEEDED` + one durable decision. Base permission/hierarchy denial → rate store not called. Redis/rate dependency throws → `DENY/DEPENDENCY_UNAVAILABLE`.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @knight/security test
```

- [ ] **Step 3: Implement orchestration**

```ts
const base = evaluatePolicy(context);
if (base.decision !== PolicyDecision.Allow) {
  await ports.decisions.record(request, base);
  return base;
}
try {
  const rate = await ports.rateLimits.consume(rateKey(request), context.actionPolicy.rateWindows, request.nowMs);
  const decision = rate.allowed
    ? makeDecision(PolicyDecision.Allow, "ALLOWED", { rate })
    : makeDecision(PolicyDecision.Deny, "RATE_LIMIT_EXCEEDED", { rate });
  await ports.decisions.record(request, decision);
  return decision;
} catch {
  const decision = makeDecision(PolicyDecision.Deny, "DEPENDENCY_UNAVAILABLE", {});
  await ports.decisions.record(request, decision);
  return decision;
}
```

Execution correlation is **not** persisted here; the bot creates it in Redis immediately before the actual Discord mutation.

- [ ] **Step 4: Verify GREEN and commit**

```bash
pnpm --filter @knight/security test
pnpm --filter @knight/security typecheck
git add packages/security packages/database/src/repositories/policy-decision-repository.ts
git commit -m "feat: orchestrate guarded policy decisions"
```

---

### Task 7: Discord adapter + bot shell

**Files:**
- Create: `packages/discord/src/port.ts`, `discord-js-adapter.ts`, `index.ts`
- Create: `apps/bot/src/discord-client.ts`, `register-commands.ts`, `index.ts`
- Create/test: `apps/bot/src/doctor/discord-health.ts`, `discord-health.test.ts`

**Produces:** `DiscordActionPort` and bot startup/command shell.

- [ ] **Step 1: Add discord.js**

```bash
pnpm --filter @knight/discord add discord.js@14.27.0 @knight/contracts@workspace:*
pnpm --filter @knight/bot add discord.js@14.27.0 @knight/config@workspace:* @knight/contracts@workspace:* @knight/database@workspace:* @knight/redis@workspace:* @knight/security@workspace:* @knight/discord@workspace:*
```

- [ ] **Step 2: Write failing role-hierarchy health test**

Knight role position 40 with managed staff positions `[20,50]` → unhealthy because position 50 cannot be managed.

- [ ] **Step 3: Define adapter**

```ts
export interface DiscordActionPort {
  banMember(input:{guildId:string;targetUserId:string;reason:string}):Promise<void>;
  addRole(input:{guildId:string;userId:string;roleId:string;reason:string}):Promise<void>;
  removeRole(input:{guildId:string;userId:string;roleId:string;reason:string}):Promise<void>;
  getMemberState(guildId:string,userId:string):Promise<DiscordMemberState|null>;
  getGuildState(guildId:string):Promise<DiscordGuildState>;
  setRolePermissions(input:{guildId:string;roleId:string;permissions:bigint;reason:string}):Promise<void>;
}
```

Core intents: `Guilds`, `GuildMembers`, `GuildModeration`; no Message Content.

- [ ] **Step 4: Register shell commands**

`/doctor`, `/setup`, `/member ban`, `/staff create-profile`, `/staff assign`, `/staff remove`, `/staff inspect`, `/security manager-add`, `/security manager-remove`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --filter @knight/discord typecheck
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
git add packages/discord apps/bot
git commit -m "feat: add Discord adapter and bot shell"
```

---

### Task 8: First Guarded action — `/member ban`

**Files:**
- Create: `apps/bot/src/commands/member/ban.ts`, `ban.test.ts`, `apps/bot/src/commands/router.ts`
- Modify: `apps/bot/src/index.ts`

**Consumes:** `authorizeGuardedAction`, `DiscordActionPort`, `ExecutionCorrelationStore`.

- [ ] **Step 1: Write failing command tests**

DENY → `discord.banMember` never called. ALLOW → correlation `create` invocation order is less than Discord ban invocation order.

```ts
const correlationOrder = correlations.create.mock.invocationCallOrder[0]!;
const discordOrder = discord.banMember.mock.invocationCallOrder[0]!;
expect(correlationOrder).toBeLessThan(discordOrder);
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @knight/bot test -- ban.test.ts
```

- [ ] **Step 3: Implement target resolution + execution order**

```text
resolve actor and target
→ mark non-Knight elevated Discord targets as elevatedUnregistered
→ authorizeGuardedAction
→ DENY/APPROVAL: reply, no mutation
→ ALLOW: create 60s Redis correlation
→ DiscordActionPort.banMember
→ reply success
```

Rate attempts remain counted even if Discord later rejects the mutation; the security budget protects attempted destructive use too.

- [ ] **Step 4: Implement readable failures**

Rate denial shows usage/reset; missing permission names `member.ban`; hierarchy denial explains target authority; dependency/Discord errors are actionable but never leak stack traces/secrets.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
git add apps/bot/src/commands
git commit -m "feat: add guarded member ban command"
```

---

### Task 9: Staff Profiles, mapped-role sync, Security Managers

**Files:**
- Create commands: `apps/bot/src/commands/staff/create-profile.ts`, `assign.ts`, `remove.ts`, `inspect.ts`
- Create commands: `apps/bot/src/commands/security/manager-add.ts`, `manager-remove.ts`
- Create/service tests: `apps/bot/src/staff/role-sync-service.ts`, `role-sync-service.test.ts`
- Create/service tests: `apps/bot/src/security/security-manager-service.ts`, `security-manager-service.test.ts`

**Produces:** `RoleSyncService`, `SecurityManagerService`.

- [ ] **Step 1: Write failing tests**

Cover: assignment persists + adds role; removal deactivates + removes role; manual mapped-role addition grants no Knight authority; self-assign higher profile denied; arbitrary non-owner/non-Security-Manager cannot create profile; explicit Security Manager can create a zero-dangerous-permission profile; owner grants/revokes Security Manager; manager cannot grant themselves manager status.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @knight/bot test -- role-sync-service.test.ts security-manager-service.test.ts
```

- [ ] **Step 3: Implement command surfaces**

```text
/staff create-profile name:<text> role:<role> rank:<integer>
/staff assign user:<member> profile:<profile>
/staff remove user:<member>
/staff inspect user:<member>
/security manager-add user:<member>
/security manager-remove user:<member>
```

Profile creation v1 has no dangerous permissions by default. Owner or current Security Manager may create/manage profiles, but the shared self-escalation check applies. Grant/revoke Security Manager is owner-only in this milestone.

- [ ] **Step 4: Implement role-sync repair state**

DB success + Discord role failure → assignment remains durable with `sync_status=NEEDS_REPAIR`; `/staff inspect` surfaces it.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
git add apps/bot/src/commands/staff apps/bot/src/commands/security apps/bot/src/staff apps/bot/src/security
git commit -m "feat: manage Knight staff and security managers"
```

---

### Task 10: Next.js dashboard + Discord OAuth authorization

**Files:**
- Create: `apps/web/next.config.ts`, `auth.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/layout.tsx`, `app/page.tsx`
- Create/test: `apps/web/lib/authorization.ts`, `authorization.test.ts`
- Create: `apps/web/app/guilds/[guildId]/layout.tsx`

**Produces:** `requireGuildAccess(guildId, session)` returning `OWNER` or `SECURITY_MANAGER`.

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @knight/web add next@16.3.3 react react-dom next-auth@beta @auth/drizzle-adapter @knight/config@workspace:* @knight/contracts@workspace:* @knight/database@workspace:* @knight/security@workspace:*
pnpm --filter @knight/web add -D @types/react @types/react-dom
```

- [ ] **Step 2: Write failing authorization tests**

Owner allowed; explicit Security Manager allowed; arbitrary user denied even if test fixture says they hold native Discord Administrator.

- [ ] **Step 3: Configure Auth.js**

```ts
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: "database" },
  providers: [Discord({ authorization: { params: { scope: "identify guilds" } } })]
});
```

OAuth access tokens stay server-side.

- [ ] **Step 4: Implement live guild authorization**

Read current persisted `owner_id` + `security_managers`. Do not use native Administrator as a shortcut. Guild layouts and every sensitive server action call authorization independently.

- [ ] **Step 5: Minimal dashboard home**

Show accessible configured guilds, current mode, and setup progress.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm --filter @knight/web test
pnpm --filter @knight/web typecheck
pnpm --filter @knight/web build
git add apps/web
git commit -m "feat: add Discord-authenticated Knight dashboard"
```

---

### Task 11: Versioned Staff Profile policy editor

**Files:**
- Create: `apps/web/app/guilds/[guildId]/staff/page.tsx`, `staff/[profileId]/page.tsx`, `staff/actions.ts`
- Create/test: `apps/web/lib/staff-profile-service.ts`, `staff-profile-service.test.ts`

**Produces:** `updateStaffProfilePolicy(input, actor): Promise<StaffProfileVersion>`.

- [ ] **Step 1: Write failing tests**

`2 bans/30m -> 5 bans/30m` creates v2 and preserves v1; Security Manager assigned to edited profile cannot raise their own authority; owner can; cross-guild profile UUID rejected.

- [ ] **Step 2: Implement validated server service**

```ts
const UpdatePolicySchema = z.object({
  guildId: z.string().min(1),
  profileId: z.string().uuid(),
  permissions: z.array(z.enum(ACTION_IDS)),
  banWindows: z.array(z.object({ max:z.number().int().positive(), windowMs:z.number().int().positive() })).max(3)
});
```

Actor comes from Auth.js session, never form input. Every edit creates a new immutable version after authorization/self-escalation checks.

- [ ] **Step 3: Build focused UI**

Show mapped role, Knight rank, current version, active members, `member.ban` toggle, up to three ban windows. Do not show risk/anomaly/incident controls not implemented yet.

- [ ] **Step 4: Verify GREEN and commit**

```bash
pnpm --filter @knight/web test
pnpm --filter @knight/web build
git add apps/web/app/guilds apps/web/lib/staff-profile-service*
git commit -m "feat: edit versioned Staff Profiles"
```

---

### Task 12: Persistent setup + Observe → Test → Guarded ban migration

**Files:**
- Create: `apps/bot/src/commands/setup.ts`
- Create/test: `apps/bot/src/setup/setup-service.ts`, `guarded-migration-service.ts`, `guarded-migration-service.test.ts`
- Create: `apps/web/app/guilds/[guildId]/setup/page.tsx`, `setup/actions.ts`
- Modify: `packages/database/src/repositories/guild-repository.ts`

**Produces:** `SetupService.getState/advanceStep`; `GuardedMigrationService.previewBanGuard/enableBanGuard/rollbackBanGuard`.

- [ ] **Step 1: Write failing migration tests**

Guarded requires TEST; snapshot invocation occurs before `setRolePermissions`; rollback uses saved permission bigint. Compare Vitest `mock.invocationCallOrder` values, not a nonstandard matcher.

- [ ] **Step 2: Implement legal transitions**

```text
OBSERVE -> TEST
TEST -> OBSERVE
TEST -> GUARDED (owner-only + successful preview/snapshot)
GUARDED -> TEST (owner-only rollback/review path)
```

All other transitions return stable errors.

- [ ] **Step 3: Implement `MEMBER_BAN` Guarded category only**

For mapped profiles whose current version grants `member.ban`, preview and remove only Discord `BanMembers`. Preserve Kick Members, Moderate Members, Manage Messages, and every unrelated bit.

Save `(guildId,migrationId,roleId,permissionsBigIntString,createdAt)` before any role mutation.

- [ ] **Step 4: Block unsafe migration**

Preview returns affected profiles/roles/staff count, exact before/after permissions, and Knight manageability. If any affected role cannot be managed due hierarchy/permissions, `blocked=true`; enabling Guarded performs zero mutations.

- [ ] **Step 5: Add Discord + web setup surfaces**

Both read the same persistent state and show hierarchy health, profile readiness, Security Managers, current mode, next action, Test transition, Guarded preview/owner confirmation, rollback.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/web test
pnpm typecheck
git add apps/bot/src/setup apps/bot/src/commands/setup.ts apps/web/app/guilds packages/database/src/repositories/guild-repository.ts
git commit -m "feat: add staged Guarded ban setup"
```

---

### Task 13: Worker, health, Docker, CI, `/doctor`, beginner docs

**Files:**
- Create: `apps/worker/src/index.ts`
- Create: `apps/web/app/api/health/live/route.ts`, `ready/route.ts`
- Create: `apps/bot/src/commands/doctor.ts`
- Create: `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`
- Create docs: `docs/setup/01-requirements.md`, `02-create-discord-app.md`, `03-install-with-docker.md`, `04-configure-environment.md`, `05-invite-knight.md`, `06-first-run.md`, `07-enable-guarded-permissions.md`, `docs/staff/staff-profiles.md`, `docs/staff/limits.md`, `docs/troubleshooting/doctor.md`

- [ ] **Step 1: Worker + health**

Worker validates env, connects PostgreSQL/Redis, supports SIGTERM, and runs no backup/incident jobs yet. `/health/live` tests process; `/health/ready` tests DB+Redis and returns 503 with non-secret component state on failure.

- [ ] **Step 2: Docker deployment**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: knight
      POSTGRES_USER: knight
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: ["knight-postgres:/var/lib/postgresql/data"]
  redis:
    image: redis:8-alpine
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]
  bot:
    build: .
    command: ["pnpm", "--filter", "@knight/bot", "start"]
  web:
    build: .
    command: ["pnpm", "--filter", "@knight/web", "start"]
  worker:
    build: .
    command: ["pnpm", "--filter", "@knight/worker", "start"]
volumes:
  knight-postgres:
```

Add health checks/readiness dependencies; never bake real `.env` into image.

- [ ] **Step 3: `/doctor`**

Report Discord connection, DB+migration, Redis, guild availability, View Audit Log/Ban Members/Manage Roles capability, Knight role vs mapped staff roles, setup mode, dashboard URL. Redact all secrets/URLs containing credentials.

- [ ] **Step 4: Beginner docs**

Exact path:

```text
Install Git + Docker
→ Create Discord app/bot
→ Copy token/client ID/client secret
→ OAuth callback ${APP_URL}/api/auth/callback/discord
→ Enable Guild Members intent; Message Content not required
→ Fill .env
→ docker compose up -d
→ Invite Knight + place role above managed staff roles
→ /doctor then /setup
→ Create Staff Profiles + assign staff
→ Optionally add Security Managers
→ Dashboard: enable member.ban + limits
→ Observe -> Test
→ Test /member ban
→ Preview Guarded (Ban Members only)
→ Owner enables Guarded
→ Verify rate-limit denial
→ Roll back if needed
```

Every major guide explains what/why/how, a concrete example, security implications, and common mistakes.

- [ ] **Step 5: CI**

Provision PostgreSQL+Redis and run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also apply all migrations to an empty CI database.

- [ ] **Step 6: Local verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
docker compose up -d postgres redis
pnpm --filter @knight/database drizzle-kit migrate
```

All exit 0.

- [ ] **Step 7: Private Discord smoke test**

Verify: `/doctor`; persistent `/setup`; profile creation/assignment; explicit Security Manager dashboard access; arbitrary Administrator denied; profile version edit `member.ban + 2/30m`; Observe→Test; two allowed bans then third denied; Guarded preview removes only Ban Members; enable snapshots then strips; rollback restores original bigint.

Any mismatch gets a regression test before milestone completion.

- [ ] **Step 8: Commit**

```bash
git add apps/worker apps/web/app/api/health apps/bot/src/commands/doctor.ts Dockerfile docker-compose.yml .github README.md docs .env.example
git commit -m "docs: ship Knight security foundation setup"
```

---

## Final verification checklist

Run fresh before any completion claim:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
```

Then verify:

- [ ] Two guild IDs cannot read/change each other's profiles.
- [ ] Dashboard uses Discord OAuth database sessions.
- [ ] Owner and explicit Security Manager access work; arbitrary native Administrator is denied.
- [ ] Staff Profiles are custom, versioned, mapped, guild-scoped.
- [ ] Mapped role without Knight assignment grants no Knight authority.
- [ ] Direct/indirect self-escalation tests pass.
- [ ] `/member ban` passes through `@knight/security` before Discord.
- [ ] Rate limiting is atomic under concurrent attempts.
- [ ] Redis/rate failure denies Guarded ban.
- [ ] Policy decisions are durable PostgreSQL records; execution correlations are Redis-only and expire.
- [ ] Observe → Test persists.
- [ ] Test → Guarded is owner-only and blocked on bad role hierarchy.
- [ ] Foundation Guarded strips only Ban Members.
- [ ] Rollback restores saved permissions.
- [ ] `/doctor` exposes health but no secrets.
- [ ] Beginner docs match the actual flow.

## Follow-up plans

1. **Anti-nuke Event & Incident Engine** — audit-event ingestion, native bypass detection, cross-action risk, protected resources, patterns, restriction/quarantine/lockdown/panic.
2. **Security Ledger & Incident UX** — append ledger, hash chain, diffs, alerts, timelines, notes, exports.
3. **Backups & Recovery** — snapshots, selected-channel archive, resource mapping, emergency/point-in-time/incident recovery, resumable jobs.
4. **Bot/Webhook Firewall + Raid Layer** — bot inventory/approval, webhook controls, join bursts, Raid Mode, AutoMod protection.
5. **Anomaly + Shadow Mode + Simulator + Security Score** — advisory baselines, historical replay, score/recommendations.
6. **Dashboard Completion & Documentation Polish** — remaining approved pages, advanced policy editing, incident/recovery UX, distributed/cloud deployment docs.
