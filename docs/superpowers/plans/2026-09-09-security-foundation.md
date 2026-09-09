# Knight Security Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Knight's first working security milestone: the monorepo/runtime foundation, PostgreSQL + Redis state, custom Staff Profiles, a shared Guarded-permission engine, a real guarded `/member ban` vertical slice, Discord OAuth dashboard authorization, explicit Security Managers, and the Observe → Test → Guarded migration skeleton.

**Architecture:** Knight is a pnpm TypeScript monorepo. `packages/security` owns pure security decisions; `packages/database` owns durable guild/security state; `packages/redis` owns ephemeral rate-limit, lock, and execution-correlation state; `packages/discord` is the only package that knows discord.js mutation details. Bot and web surfaces call the same security services and never reimplement authorization rules.

**Tech Stack:** Node.js 24 LTS, pnpm 12.4, TypeScript, discord.js 14.27.x, Next.js 16.3.x, React, Auth.js/NextAuth Discord provider, Drizzle ORM 0.44.7, PostgreSQL, Redis, Zod, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-09-knight-security-platform-design.md`

## Global Constraints

- Self-hosted only; one deployment may protect multiple guilds.
- Dashboard authentication is Discord OAuth only.
- Native Discord `Administrator` never automatically grants Knight security-management access.
- PostgreSQL is authoritative; Redis contains only disposable operational state.
- Destructive Guarded actions fail closed when current policy/rate state cannot be established.
- Discord role membership is representation; an active Knight staff assignment is authority.
- No direct or indirect self-escalation.
- Restrictions, quarantine, protected-target rules, and emergency locks override grants.
- Guild owner retains ultimate Knight authority.
- Anomaly detection is advisory-only and is not implemented in this milestone.
- Guarded migration is staged: Observe → Test → Guarded.
- Entering Guarded requires explicit guild-owner confirmation and a role-permission snapshot.
- This milestone guards only `member.ban`; Knight must never strip a native Discord permission until a Knight replacement action exists.
- Core anti-nuke does not require Message Content intent.
- Use Node.js `>=24.17.0 <25`.
- Use stable Drizzle 0.44.7, not Drizzle 1.0 beta.
- Every guild-scoped repository method takes `guildId` explicitly and includes it in the query predicate.
- No security decisions inside slash-command handlers, React components, or route handlers.

---

## Milestone boundary

This plan implements only the **Security Foundation**. Separate plans will cover native audit-event anti-nuke detection, incident correlation/containment, Security Ledger, backups/recovery, bot/webhook firewall, raid protection, anomaly scoring, and the full dashboard.

The milestone is complete when a self-hosted instance can:

1. Start bot, web, and worker against PostgreSQL + Redis.
2. Authenticate dashboard users with Discord OAuth database sessions.
3. Authorize the guild owner and explicitly assigned Security Managers while denying an arbitrary Discord Administrator.
4. Create and version custom Staff Profiles mapped to real Discord roles.
5. Assign/remove staff and synchronize the mapped role without treating role possession itself as authority.
6. Evaluate `member.ban` through one shared security engine with hierarchy, permission, protected-target, rate-window, and emergency-state checks.
7. Deny a rate-limited or unauthorized ban before Discord is called.
8. Persist durable policy decisions in PostgreSQL and short-lived Knight execution correlations in Redis.
9. Persist setup state and move Observe → Test.
10. Preview Test → Guarded for `member.ban`, snapshot role permissions, remove only native `Ban Members`, and roll back from that snapshot.
11. Show the same setup/health state in Discord and the web dashboard.
12. Provide beginner docs from Discord application creation through Guarded mode.

## Target structure

```text
apps/
├── bot/src/
├── web/app/
└── worker/src/

packages/
├── config/src/
├── contracts/src/
├── database/src/
├── redis/src/
├── security/src/
└── discord/src/

tests/integration/
```

---

### Task 1: Bootstrap the workspace and quality gates

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `vitest.workspace.ts`
- Create: package manifests and `tsconfig.json` files for `apps/bot`, `apps/web`, `apps/worker`, `packages/config`, `packages/contracts`, `packages/database`, `packages/redis`, `packages/security`, `packages/discord`

**Interfaces:**
- Package names: `@knight/bot`, `@knight/web`, `@knight/worker`, `@knight/config`, `@knight/contracts`, `@knight/database`, `@knight/redis`, `@knight/security`, `@knight/discord`.
- Root commands required by all later tasks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

- [ ] **Step 1: Create the root manifest**

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
    "test": "vitest run --workspace vitest.workspace.ts",
    "test:watch": "vitest --workspace vitest.workspace.ts"
  }
}
```

- [ ] **Step 2: Create workspace/toolchain configuration**

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
minimumReleaseAge: 1440
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true
  }
}
```

`vitest.workspace.ts` includes `packages/*`, `apps/*`, and `tests/integration` as projects. Library packages use ESM and expose `./src/index.ts`. Bot/worker use NodeNext module resolution; web uses the Next.js generated/app-compatible TypeScript settings.

- [ ] **Step 3: Install root developer tooling**

```bash
corepack enable
pnpm add -Dw typescript eslint @eslint/js typescript-eslint prettier vitest zod
```

Each library manifest must contain `lint`, `typecheck`, and `test` scripts. Bot and worker also define `build`, `dev`, and `start`; web defines `dev: next dev`, `build: next build`, `start: next start`.

- [ ] **Step 4: Create secret-safe ignore/environment files**

```gitignore
node_modules/
.next/
dist/
coverage/
.env
.env.*
!.env.example
*.log
.DS_Store
```

```dotenv
# Discord bot token from the Developer Portal. Never commit the real value.
DISCORD_TOKEN=
# Discord application/client ID.
DISCORD_CLIENT_ID=
# Discord OAuth client secret. Never commit the real value.
DISCORD_CLIENT_SECRET=
# Auth.js session secret; use at least 32 random characters.
AUTH_SECRET=
# Public dashboard URL, e.g. http://localhost:3000
APP_URL=http://localhost:3000
# PostgreSQL connection string.
DATABASE_URL=postgres://knight:knight@localhost:5432/knight
# Redis connection string.
REDIS_URL=redis://:knight@localhost:6379
# Docker-only database password used by docker-compose.yml.
POSTGRES_PASSWORD=knight
# Docker-only Redis password used by docker-compose.yml.
REDIS_PASSWORD=knight
```

- [ ] **Step 5: Verify the workspace resolves**

```bash
node --version
pnpm --version
pnpm install
pnpm typecheck
```

Expected: Node satisfies the engine, pnpm is 12.4.x, install succeeds, and the empty/scaffold packages typecheck.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: bootstrap Knight monorepo"
```

---

### Task 2: Define validated environment and canonical security contracts

**Files:**
- Create: `packages/config/src/env.ts`
- Create: `packages/config/src/env.test.ts`
- Create: `packages/config/src/index.ts`
- Create: `packages/contracts/src/actions.ts`
- Create: `packages/contracts/src/policy.ts`
- Create: `packages/contracts/src/staff.ts`
- Create: `packages/contracts/src/setup.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Produces `KnightEnv`, `ActionId`, `ACTION_IDS`, `PolicyDecision`, `SecurityDecision`, `RateWindow`, `ActionPolicy`, `GuildMode`, `SetupStep`, `ProtectionLevel`, `StaffProfileSnapshot`.

- [ ] **Step 1: Write failing config tests**

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("rejects missing security-critical variables", () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
  });

  it("accepts a complete test configuration", () => {
    expect(parseEnv({
      NODE_ENV: "test",
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "123",
      DISCORD_CLIENT_SECRET: "secret",
      AUTH_SECRET: "x".repeat(32),
      APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://knight:knight@localhost:5432/knight",
      REDIS_URL: "redis://localhost:6379"
    }).NODE_ENV).toBe("test");
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @knight/config test
```

Expected: FAIL because `parseEnv` does not exist.

- [ ] **Step 3: Implement config parsing**

```ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url()
});

export type KnightEnv = z.infer<typeof EnvSchema>;
export const parseEnv = (input: Record<string, string | undefined>) => EnvSchema.parse(input);
```

- [ ] **Step 4: Write failing contract tests**

```ts
import { expect, it } from "vitest";
import { ACTION_IDS, GuildMode, PolicyDecision } from "./index.js";

it("contains member.ban and explicit Guarded mode", () => {
  expect(ACTION_IDS).toContain("member.ban");
  expect(GuildMode.Guarded).toBe("GUARDED");
  expect(PolicyDecision.Deny).toBe("DENY");
});
```

- [ ] **Step 5: Implement canonical types**

```ts
export const ACTION_IDS = [
  "member.warn",
  "member.timeout",
  "member.kick",
  "member.ban",
  "member.unban",
  "message.purge",
  "security.staff.assign",
  "security.staff.remove",
  "security.staff.manage_profiles",
  "security.security_managers.manage",
  "security.policy.view",
  "security.policy.edit",
  "security.approvals.approve",
  "security.lockdown",
  "security.panic"
] as const;

export type ActionId = (typeof ACTION_IDS)[number];
export enum PolicyDecision { Allow = "ALLOW", Deny = "DENY", RequireApproval = "REQUIRE_APPROVAL", Contain = "CONTAIN" }
export enum GuildMode { Observe = "OBSERVE", Test = "TEST", Guarded = "GUARDED" }
export enum ProtectionLevel { Normal = "NORMAL", Important = "IMPORTANT", Critical = "CRITICAL", Immutable = "IMMUTABLE" }
export type RateWindow = Readonly<{ max: number; windowMs: number }>;
export type ActionPolicy = Readonly<{ enabled: boolean; unlimited: boolean; rateWindows: readonly RateWindow[] }>;
export type SecurityDecision = Readonly<{
  decision: PolicyDecision;
  code: string;
  reason: string;
  policyVersionId: string | null;
  metadata: Readonly<Record<string, unknown>>;
}>;
```

`SetupStep` is `WELCOME | HEALTH | STAFF | POLICIES | LOGGING | PROTECTION | BACKUPS | OBSERVE | COMPLETE`. `StaffProfileSnapshot` contains profile/version/guild/role IDs, rank, `permissions: readonly ActionId[]`, and `actionPolicies: Readonly<Partial<Record<ActionId, ActionPolicy>>>`.

- [ ] **Step 6: Run tests/typecheck**

```bash
pnpm --filter @knight/config test
pnpm --filter @knight/contracts test
pnpm --filter @knight/config typecheck
pnpm --filter @knight/contracts typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/config packages/contracts
git commit -m "feat: define Knight security contracts"
```

---

### Task 3: Create the durable PostgreSQL schema and guild-scoped repositories

**Files:**
- Create: `packages/database/drizzle.config.ts`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/schema/guilds.ts`
- Create: `packages/database/src/schema/staff.ts`
- Create: `packages/database/src/schema/policies.ts`
- Create: `packages/database/src/schema/auth.ts`
- Create: `packages/database/src/schema/index.ts`
- Create: `packages/database/src/repositories/guild-repository.ts`
- Create: `packages/database/src/repositories/staff-repository.ts`
- Create: `packages/database/src/repositories/security-manager-repository.ts`
- Create: `packages/database/src/repositories/policy-decision-repository.ts`
- Create: `packages/database/src/index.ts`
- Create: `tests/integration/database/staff-repository.test.ts`

**Interfaces:**
- `GuildRepository.get(guildId)`, `createOrUpdateOwner(guildId, ownerId)`, `setMode(guildId, mode)`, `getSetupState(guildId)`.
- `StaffRepository.createProfile`, `createProfileVersion`, `assign`, `deactivateAssignment`, `getEffectiveProfile(guildId, userId)`, `listProfiles(guildId)`.
- `SecurityManagerRepository.grant`, `revoke`, `isSecurityManager`.
- `PolicyDecisionRepository.record` persists durable decision evidence.

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @knight/database add drizzle-orm@0.44.7 pg @knight/contracts@workspace:*
pnpm --filter @knight/database add -D drizzle-kit @types/pg
```

- [ ] **Step 2: Write failing guild-isolation/version tests**

```ts
it("never returns another guild's assignment", async () => {
  await guilds.createOrUpdateOwner("100", "1");
  await guilds.createOrUpdateOwner("200", "2");
  const p = await staff.createProfile({ guildId: "100", name: "Moderator", discordRoleId: "900", rank: 20 });
  await staff.createProfileVersion({ guildId: "100", profileId: p.id, permissions: ["member.ban"], actionPolicies: {} });
  await staff.assign({ guildId: "100", userId: "42", profileId: p.id, actorUserId: "1" });
  expect(await staff.getEffectiveProfile("200", "42")).toBeNull();
});

it("preserves immutable numbered profile versions", async () => {
  const p = await staff.createProfile({ guildId: "100", name: "Moderator", discordRoleId: "900", rank: 20 });
  const v1 = await staff.createProfileVersion({ guildId: "100", profileId: p.id, permissions: ["member.ban"], actionPolicies: {} });
  const v2 = await staff.createProfileVersion({ guildId: "100", profileId: p.id, permissions: [], actionPolicies: {} });
  expect([v1.version, v2.version]).toEqual([1, 2]);
});
```

- [ ] **Step 3: Verify failure**

```bash
DATABASE_URL=postgres://knight:knight@localhost:5432/knight_test pnpm vitest run tests/integration/database/staff-repository.test.ts
```

Expected: FAIL because schema/repositories are missing.

- [ ] **Step 4: Implement the milestone schema**

Required tables:

```text
guilds(id text PK, owner_id text, mode text, created_at, updated_at)
setup_states(guild_id text PK/FK, step text, completed_steps jsonb, updated_at)
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

Constraints:

- unique `(guild_id, name)` on staff profiles;
- unique `(profile_id, version)` on versions;
- partial unique active assignment for `(guild_id, user_id)`;
- security-manager primary key `(guild_id, user_id)`;
- non-negative ranks and profile version numbers.

`permissions` and `action_policies` are immutable JSONB on version rows. Never update an old version in place.

- [ ] **Step 5: Add Auth.js adapter tables**

Create `users`, `accounts`, `sessions`, `verification_tokens` with fields expected by `@auth/drizzle-adapter`. OAuth tokens are server-only data and are never included in browser/API response DTOs.

- [ ] **Step 6: Generate/apply migration**

```bash
pnpm --filter @knight/database drizzle-kit generate
pnpm --filter @knight/database drizzle-kit migrate
```

- [ ] **Step 7: Implement guild-scoped repositories**

Every method receives `guildId`; even UUID lookup methods include `guildId` in SQL predicates. `createProfileVersion` runs transactionally: determine next version, insert immutable row, update `current_version_id`.

- [ ] **Step 8: Run tests/typecheck**

```bash
pnpm --filter @knight/database typecheck
DATABASE_URL=postgres://knight:knight@localhost:5432/knight_test pnpm vitest run tests/integration/database/staff-repository.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/database tests/integration/database
git commit -m "feat: add guild-scoped security database"
```

---

### Task 4: Implement Redis rate limits, ownership locks, and execution correlations

**Files:**
- Create: `packages/redis/src/client.ts`
- Create: `packages/redis/src/rate-limit-store.ts`
- Create: `packages/redis/src/lock-store.ts`
- Create: `packages/redis/src/execution-correlation-store.ts`
- Create: `packages/redis/src/index.ts`
- Create: `packages/redis/src/rate-limit-store.test.ts`
- Create: `packages/redis/src/execution-correlation-store.test.ts`

**Interfaces:**
- `RateLimitStore.consume({ key, windows, nowMs }): Promise<RateLimitResult>`.
- `LockStore.acquire(key, ttlMs): Promise<LockLease | null>`.
- `ExecutionCorrelationStore.create/get/consume` stores short-lived expected Knight Discord mutations only; durable decisions remain in PostgreSQL.

- [ ] **Step 1: Add Redis dependency and write failing tests**

```bash
pnpm --filter @knight/redis add ioredis @knight/contracts@workspace:*
```

```ts
it("atomically denies a third action in a 2-action window", async () => {
  const w = [{ max: 2, windowMs: 60_000 }];
  expect((await store.consume({ key: "g:1:u:2:member.ban", windows: w, nowMs: 1000 })).allowed).toBe(true);
  expect((await store.consume({ key: "g:1:u:2:member.ban", windows: w, nowMs: 1001 })).allowed).toBe(true);
  expect((await store.consume({ key: "g:1:u:2:member.ban", windows: w, nowMs: 1002 })).allowed).toBe(false);
});
```

Also test two simultaneous consumers competing for one remaining slot and execution-correlation expiry/consume-once behavior.

- [ ] **Step 2: Verify failure**

```bash
REDIS_URL=redis://localhost:6379 pnpm --filter @knight/redis test
```

- [ ] **Step 3: Implement atomic multi-window rate limiting**

Use one Lua script that removes expired timestamps, validates every window first, inserts the event into every window only if all pass, and sets expiry. Event members use `${nowMs}:${crypto.randomUUID()}`.

```ts
export type RateLimitResult = Readonly<{
  allowed: boolean;
  windows: readonly {
    max: number;
    windowMs: number;
    used: number;
    remaining: number;
    resetAtMs: number;
  }[];
}>;
```

- [ ] **Step 4: Implement ownership-token locks**

Acquire with `SET key token NX PX ttl`. Release with Lua that deletes only if the stored token still matches the lease token.

- [ ] **Step 5: Implement short-lived execution correlations**

```ts
export type ExecutionCorrelation = Readonly<{
  id: string;
  guildId: string;
  requestedByUserId: string;
  action: ActionId;
  targetId: string;
  expectedAuditActorBotId: string;
  createdAtMs: number;
}>;
```

Store serialized records under a namespaced Redis key with a short TTL (default 60 seconds). `consume(id)` atomically returns and deletes the record.

- [ ] **Step 6: Run tests/typecheck**

```bash
REDIS_URL=redis://localhost:6379 pnpm --filter @knight/redis test
pnpm --filter @knight/redis typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/redis
git commit -m "feat: add atomic security state in Redis"
```

---

### Task 5: Implement pure Staff Profile authorization and self-escalation checks

**Files:**
- Create: `packages/security/src/authorization/types.ts`
- Create: `packages/security/src/authorization/effective-access.ts`
- Create: `packages/security/src/authorization/evaluate-policy.ts`
- Create: `packages/security/src/authorization/self-escalation.ts`
- Create: `packages/security/src/authorization/evaluate-policy.test.ts`
- Create: `packages/security/src/authorization/self-escalation.test.ts`
- Create: `packages/security/src/index.ts`

**Interfaces:**
- `evaluatePolicy(context): SecurityDecision` is pure and synchronous.
- `wouldIncreaseOwnAuthority(input): boolean` is pure and synchronous.
- No SQL, Redis, Discord, or HTTP imports in `packages/security/src/authorization`.

- [ ] **Step 1: Write failing policy tests**

```ts
it.each([
  ["allows moderator ban on lower target", makeContext({ actorRank: 20, targetRank: 0, permissions: ["member.ban"] }), "ALLOW"],
  ["denies higher-ranked target", makeContext({ actorRank: 20, targetRank: 50, permissions: ["member.ban"] }), "DENY"],
  ["denies missing permission", makeContext({ actorRank: 20, targetRank: 0, permissions: [] }), "DENY"],
  ["emergency restriction wins", makeContext({ actorRank: 20, targetRank: 0, permissions: ["member.ban"], memberModerationLocked: true }), "DENY"]
])("%s", (_name, context, expected) => {
  expect(evaluatePolicy(context).decision).toBe(expected);
});
```

Add tests proving temporary restriction beats grant, guild owner cannot be targeted, protected target can require approval, inactive assignment is denied, and elevated unregistered Discord target is not treated as rank 0.

- [ ] **Step 2: Write failing self-escalation tests**

Direct case: Alice cannot assign herself a higher profile. Indirect case: Alice is Moderator and cannot edit Moderator from `2 bans / 30m` to `5 bans / 30m`. Restriction-removal case: Alice cannot remove a restriction that applies to Alice.

- [ ] **Step 3: Verify failure**

```bash
pnpm --filter @knight/security test
```

- [ ] **Step 4: Implement fixed precedence**

```text
1. active Knight assignment / owner authority
2. owner-target invariant
3. quarantine/emergency locks
4. explicit temporary restrictions
5. effective canonical permission
6. target hierarchy/elevated-unregistered rule
7. protected-target approval rule
8. ALLOW
```

Stable deny codes: `NO_ACTIVE_STAFF_ASSIGNMENT`, `OWNER_TARGET_PROTECTED`, `LOCKDOWN_ACTIVE`, `TEMPORARILY_RESTRICTED`, `PERMISSION_MISSING`, `TARGET_OUTRANKS_ACTOR`, `ELEVATED_TARGET_REQUIRES_APPROVAL`, `ALLOWED`.

- [ ] **Step 5: Implement authority-diff comparison**

Normalize pre/post authority to rank, canonical permission set, and per-action maximums. `wouldIncreaseOwnAuthority` returns true if the proposed change raises the actor's rank, adds a permission, increases a finite action maximum, changes finite → unlimited, or removes an active restriction that reduced the actor.

- [ ] **Step 6: Run tests/typecheck**

```bash
pnpm --filter @knight/security test
pnpm --filter @knight/security typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/security
git commit -m "feat: add Staff Profile authorization engine"
```

---

### Task 6: Orchestrate Guarded decisions with rate limiting and durable decision evidence

**Files:**
- Create: `packages/security/src/guarded/ports.ts`
- Create: `packages/security/src/guarded/authorize-guarded-action.ts`
- Create: `packages/security/src/guarded/authorize-guarded-action.test.ts`
- Modify: `packages/security/src/index.ts`
- Modify: `packages/database/src/repositories/policy-decision-repository.ts`

**Interfaces:**
- `authorizeGuardedAction(request, ports): Promise<SecurityDecision>`.
- Ports: `StaffStatePort`, `RateLimitPort`, `DecisionLogPort`.
- Execution correlation is intentionally **not** part of this function; it is created immediately before a real Discord mutation in the bot command layer/service.

- [ ] **Step 1: Write failing orchestration tests**

```ts
it("denies a ban when the rate window is exhausted", async () => {
  const decision = await authorizeGuardedAction(request, makePorts({ rateAllowed: false }));
  expect(decision.decision).toBe("DENY");
  expect(decision.code).toBe("RATE_LIMIT_EXCEEDED");
  expect(decisionLog.entries).toHaveLength(1);
});

it("does not consume rate budget when base authorization already denies", async () => {
  await authorizeGuardedAction(unauthorizedRequest, ports);
  expect(rateLimits.consume).not.toHaveBeenCalled();
});
```

Also test Redis/rate dependency failure returns `DENY / DEPENDENCY_UNAVAILABLE`.

- [ ] **Step 2: Verify failure**

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
  if (!rate.allowed) {
    const denied = makeDecision(PolicyDecision.Deny, "RATE_LIMIT_EXCEEDED", { rate });
    await ports.decisions.record(request, denied);
    return denied;
  }
  const allowed = makeDecision(PolicyDecision.Allow, "ALLOWED", { rate });
  await ports.decisions.record(request, allowed);
  return allowed;
} catch {
  const denied = makeDecision(PolicyDecision.Deny, "DEPENDENCY_UNAVAILABLE", {});
  await ports.decisions.record(request, denied);
  return denied;
}
```

- [ ] **Step 4: Wire the PostgreSQL decision repository to `DecisionLogPort`**

Persist guild, actor, action, target, decision/code, profile version, metadata, timestamp. Do not persist Discord OAuth tokens or Redis execution-correlation payloads in this table.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @knight/security test
pnpm --filter @knight/security typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/security packages/database/src/repositories/policy-decision-repository.ts
git commit -m "feat: orchestrate guarded policy decisions"
```

---

### Task 7: Build the Discord adapter and bot shell

**Files:**
- Create: `packages/discord/src/port.ts`
- Create: `packages/discord/src/discord-js-adapter.ts`
- Create: `packages/discord/src/index.ts`
- Create: `apps/bot/src/discord-client.ts`
- Create: `apps/bot/src/register-commands.ts`
- Create: `apps/bot/src/doctor/discord-health.ts`
- Create: `apps/bot/src/doctor/discord-health.test.ts`
- Create: `apps/bot/src/index.ts`

**Interfaces:**
- `DiscordActionPort`: `banMember`, `addRole`, `removeRole`, `getMemberState`, `getGuildState`, `setRolePermissions`.
- Core bot intents for this milestone: `Guilds`, `GuildMembers`, `GuildModeration`. Message Content is not requested.

- [ ] **Step 1: Add discord.js**

```bash
pnpm --filter @knight/discord add discord.js@14.27.0 @knight/contracts@workspace:*
pnpm --filter @knight/bot add discord.js@14.27.0 @knight/config@workspace:* @knight/contracts@workspace:* @knight/database@workspace:* @knight/redis@workspace:* @knight/security@workspace:* @knight/discord@workspace:*
```

- [ ] **Step 2: Write failing hierarchy-health test**

```ts
it("reports degraded protection when Knight is below a protected staff role", () => {
  expect(checkHierarchyHealth({ knightRolePosition: 40, managedRolePositions: [20, 50] }).healthy).toBe(false);
});
```

- [ ] **Step 3: Verify failure**

```bash
pnpm --filter @knight/bot test
```

- [ ] **Step 4: Define Discord port**

```ts
export interface DiscordActionPort {
  banMember(input: { guildId: string; targetUserId: string; reason: string }): Promise<void>;
  addRole(input: { guildId: string; userId: string; roleId: string; reason: string }): Promise<void>;
  removeRole(input: { guildId: string; userId: string; roleId: string; reason: string }): Promise<void>;
  getMemberState(guildId: string, userId: string): Promise<DiscordMemberState | null>;
  getGuildState(guildId: string): Promise<DiscordGuildState>;
  setRolePermissions(input: { guildId: string; roleId: string; permissions: bigint; reason: string }): Promise<void>;
}
```

- [ ] **Step 5: Implement startup and slash-command registration shell**

Register `/doctor`, `/setup`, `/member ban`, `/staff create-profile`, `/staff assign`, `/staff remove`, `/staff inspect`, `/security manager-add`, `/security manager-remove`. Parse env before connecting; invalid critical configuration exits non-zero.

- [ ] **Step 6: Run tests/typecheck**

```bash
pnpm --filter @knight/discord typecheck
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
```

Expected: PASS without a live Discord token.

- [ ] **Step 7: Commit**

```bash
git add packages/discord apps/bot
git commit -m "feat: add Discord adapter and bot shell"
```

---

### Task 8: Implement `/member ban` as the first real Guarded action

**Files:**
- Create: `apps/bot/src/commands/member/ban.ts`
- Create: `apps/bot/src/commands/member/ban.test.ts`
- Create: `apps/bot/src/commands/router.ts`
- Modify: `apps/bot/src/index.ts`

**Interfaces:**
- `/member ban user:<member> reason:<text>` calls `authorizeGuardedAction` first.
- After ALLOW and before Discord mutation, create a Redis execution correlation with 60-second TTL.

- [ ] **Step 1: Write failing command tests**

```ts
it("never calls Discord when policy denies", async () => {
  security.authorizeGuardedAction.mockResolvedValue(deny("RATE_LIMIT_EXCEEDED"));
  await handleBan(interaction, deps);
  expect(discord.banMember).not.toHaveBeenCalled();
});

it("creates correlation before the Discord mutation", async () => {
  security.authorizeGuardedAction.mockResolvedValue(allow());
  await handleBan(interaction, deps);
  const correlationOrder = correlations.create.mock.invocationCallOrder[0]!;
  const discordOrder = discord.banMember.mock.invocationCallOrder[0]!;
  expect(correlationOrder).toBeLessThan(discordOrder);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/bot test -- ban.test.ts
```

- [ ] **Step 3: Resolve target conservatively**

Build policy target state from Knight assignment, protected status, and Discord roles. If a non-Knight target holds elevated Discord roles/permissions, set `elevatedUnregistered = true`; never silently treat that target as an ordinary rank-0 member.

- [ ] **Step 4: Implement execution order**

```text
resolve actor/target
→ authorizeGuardedAction
→ if DENY/APPROVAL: respond, no Discord mutation
→ create Redis execution correlation
→ DiscordActionPort.banMember
→ respond success
```

If `banMember` fails, return an actionable Discord error and leave the durable policy decision intact. The rate attempt remains counted; security limits protect attempts as well as successful mutations.

- [ ] **Step 5: Implement readable responses**

Rate denial shows current usage/reset metadata. Missing permission names `member.ban`. Hierarchy denial states that the target is outside the actor's Knight authority. Never expose stack traces.

- [ ] **Step 6: Run tests/typecheck**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/commands
git commit -m "feat: add guarded member ban command"
```

---

### Task 9: Implement Staff Profiles, role sync, and explicit Security Manager management

**Files:**
- Create: `apps/bot/src/commands/staff/create-profile.ts`
- Create: `apps/bot/src/commands/staff/assign.ts`
- Create: `apps/bot/src/commands/staff/remove.ts`
- Create: `apps/bot/src/commands/staff/inspect.ts`
- Create: `apps/bot/src/commands/security/manager-add.ts`
- Create: `apps/bot/src/commands/security/manager-remove.ts`
- Create: `apps/bot/src/staff/role-sync-service.ts`
- Create: `apps/bot/src/staff/role-sync-service.test.ts`
- Create: `apps/bot/src/security/security-manager-service.test.ts`

**Interfaces:**
- `RoleSyncService.assign/remove` coordinates Knight assignment and mapped Discord role.
- `SecurityManagerService.grant/revoke` is owner-only in this milestone.
- Profile creation defaults to zero dangerous permissions; policy editing happens in Task 11.

- [ ] **Step 1: Write failing staff/manager tests**

Cover:

1. Assignment persists and adds mapped role.
2. Removal deactivates assignment and removes role.
3. Manually adding a mapped role does not create Knight authority.
4. User cannot self-assign a higher profile.
5. Non-owner cannot create a profile in this milestone.
6. Owner can grant/revoke Security Manager.
7. Security Manager cannot grant themselves Security Manager status.

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/bot test -- role-sync-service.test.ts security-manager-service.test.ts
```

- [ ] **Step 3: Implement command shapes**

```text
/staff create-profile name:<text> role:<role> rank:<integer>
/staff assign user:<member> profile:<profile>
/staff remove user:<member>
/staff inspect user:<member>
/security manager-add user:<member>
/security manager-remove user:<member>
```

- [ ] **Step 4: Implement repair state**

If Knight persistence succeeds but Discord role mutation fails, mark assignment `sync_status = NEEDS_REPAIR`. `/staff inspect` surfaces this. Never delete the durable assignment simply to hide a Discord mutation failure.

- [ ] **Step 5: Run tests/typecheck**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/commands/staff apps/bot/src/commands/security apps/bot/src/staff
git commit -m "feat: manage Knight staff and security managers"
```

---

### Task 10: Add Next.js dashboard with Discord OAuth and live Knight authorization

**Files:**
- Create: `apps/web/next.config.ts`
- Create: `apps/web/auth.ts`
- Create: `apps/web/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/lib/authorization.ts`
- Create: `apps/web/lib/authorization.test.ts`
- Create: `apps/web/app/guilds/[guildId]/layout.tsx`

**Interfaces:**
- `requireGuildAccess(guildId, session): Promise<{ role: "OWNER" | "SECURITY_MANAGER"; userId: string }>`.
- Sensitive server actions re-run authorization; authenticated layout access is not sufficient by itself.

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @knight/web add next@16.3.3 react react-dom next-auth@beta @auth/drizzle-adapter @knight/config@workspace:* @knight/contracts@workspace:* @knight/database@workspace:* @knight/security@workspace:*
pnpm --filter @knight/web add -D @types/react @types/react-dom
```

- [ ] **Step 2: Write failing authorization tests**

```ts
it("allows owner", async () => {
  await guilds.createOrUpdateOwner("100", "42");
  await expect(requireGuildAccess("100", session("42"))).resolves.toMatchObject({ role: "OWNER" });
});

it("allows explicit Security Manager", async () => {
  await managers.grant({ guildId: "100", userId: "43", actorUserId: "42" });
  await expect(requireGuildAccess("100", session("43"))).resolves.toMatchObject({ role: "SECURITY_MANAGER" });
});

it("denies arbitrary Discord Administrator", async () => {
  await expect(requireGuildAccess("100", session("44"))).rejects.toThrow(/not authorized/i);
});
```

- [ ] **Step 3: Verify failure**

```bash
pnpm --filter @knight/web test
```

- [ ] **Step 4: Configure Auth.js Discord provider**

Use `@auth/drizzle-adapter`, database sessions, and Discord scope `identify guilds`.

```ts
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: "database" },
  providers: [Discord({ authorization: { params: { scope: "identify guilds" } } })]
});
```

Stored Discord OAuth access tokens remain server-only.

- [ ] **Step 5: Implement live Knight authorization**

`requireGuildAccess` reads current `guilds.owner_id` and current `security_managers`. It does not inspect Discord `Administrator` as an authorization shortcut. Guild server layouts and every sensitive server action call it.

- [ ] **Step 6: Build minimal authenticated home**

Show configured Knight guilds the current user can access, current guild mode, and setup progress. Do not build unrelated dashboard pages.

- [ ] **Step 7: Run tests/build**

```bash
pnpm --filter @knight/web test
pnpm --filter @knight/web typecheck
pnpm --filter @knight/web build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat: add Discord-authenticated Knight dashboard"
```

---

### Task 11: Add versioned Staff Profile policy editing in the dashboard

**Files:**
- Create: `apps/web/app/guilds/[guildId]/staff/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/staff/[profileId]/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/staff/actions.ts`
- Create: `apps/web/lib/staff-profile-service.ts`
- Create: `apps/web/lib/staff-profile-service.test.ts`

**Interfaces:**
- `updateStaffProfilePolicy(input, actor): Promise<StaffProfileVersion>`.
- Every update creates a new version and runs self-escalation/grant-ceiling checks first.

- [ ] **Step 1: Write failing tests**

Cover:

- `2 bans / 30m` → `5 bans / 30m` creates v2 and preserves v1;
- a Security Manager assigned to the edited profile cannot raise their own ban authority;
- guild owner can perform the same edit;
- cross-guild profile UUID is rejected.

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/web test -- staff-profile-service.test.ts
```

- [ ] **Step 3: Implement validated server-only edit service**

```ts
const UpdatePolicySchema = z.object({
  guildId: z.string().min(1),
  profileId: z.string().uuid(),
  permissions: z.array(z.enum(ACTION_IDS)),
  banWindows: z.array(z.object({
    max: z.number().int().positive(),
    windowMs: z.number().int().positive()
  })).max(3)
});
```

The actor user ID comes from the authenticated session, never from form input.

- [ ] **Step 4: Build focused Staff Profile UI**

Show profile name, mapped Discord role, Knight rank, current version, active members, `member.ban` toggle, and up to three rate windows. Do not expose unsupported risk/anomaly/incident controls in this milestone.

- [ ] **Step 5: Run tests/build**

```bash
pnpm --filter @knight/web test
pnpm --filter @knight/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/guilds apps/web/lib/staff-profile-service*
git commit -m "feat: edit versioned Staff Profiles"
```

---

### Task 12: Implement persistent setup and Observe → Test → Guarded ban migration

**Files:**
- Create: `apps/bot/src/commands/setup.ts`
- Create: `apps/bot/src/setup/setup-service.ts`
- Create: `apps/bot/src/setup/guarded-migration-service.ts`
- Create: `apps/bot/src/setup/guarded-migration-service.test.ts`
- Create: `apps/web/app/guilds/[guildId]/setup/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/setup/actions.ts`
- Modify: `packages/database/src/repositories/guild-repository.ts`

**Interfaces:**
- `SetupService.getState/advanceStep`.
- `GuardedMigrationService.previewBanGuard`, `enableBanGuard`, `rollbackBanGuard`.
- Entering Guarded is owner-only.

- [ ] **Step 1: Write failing migration tests**

```ts
it("requires TEST before Guarded", async () => {
  await expect(service.enableBanGuard({ guildId: "1", actorUserId: "owner" })).rejects.toThrow(/TEST mode/);
});

it("snapshots before changing role permissions", async () => {
  await service.enableBanGuard({ guildId: "1", actorUserId: "owner" });
  const snapshotOrder = snapshots.create.mock.invocationCallOrder[0]!;
  const mutateOrder = discord.setRolePermissions.mock.invocationCallOrder[0]!;
  expect(snapshotOrder).toBeLessThan(mutateOrder);
});

it("rollback restores captured permissions", async () => {
  await service.rollbackBanGuard({ guildId: "1", actorUserId: "owner", migrationId: "m1" });
  expect(discord.setRolePermissions).toHaveBeenCalledWith(expect.objectContaining({ permissions: originalPermissions }));
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/bot test -- guarded-migration-service.test.ts
```

- [ ] **Step 3: Implement allowed mode transitions**

```text
OBSERVE -> TEST
TEST -> OBSERVE
TEST -> GUARDED (owner only + successful preview + snapshots)
GUARDED -> TEST (owner only + rollback/review)
```

All other transitions return stable error codes.

- [ ] **Step 4: Implement foundation Guarded category: `MEMBER_BAN` only**

For every selected mapped staff role whose current Knight profile grants `member.ban`, preview and remove only the Discord `BanMembers` bit. Preserve Kick Members, Moderate Members, Manage Messages, and every unrelated permission because Knight does not yet replace them in this milestone.

Snapshot `(guildId, migrationId, roleId, permissionsBigIntString, createdAt)` before the first role mutation.

- [ ] **Step 5: Block unsafe migrations**

`previewBanGuard` returns affected profiles/roles/staff counts, whether Knight can manage each role, and exact before/after permission values. If Knight's highest role cannot manage any affected role, preview returns `blocked: true` and enabling Guarded fails without mutating any role.

- [ ] **Step 6: Add setup surfaces**

Discord `/setup` and the web setup page read the same persistent state. Show role-hierarchy health, staff/profile readiness, Security Managers, current mode, and next action. Web exposes Observe → Test, Guarded preview, owner confirmation, and rollback.

- [ ] **Step 7: Run tests/typecheck**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/web test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/bot/src/setup apps/bot/src/commands/setup.ts apps/web/app/guilds packages/database/src/repositories/guild-repository.ts
git commit -m "feat: add staged Guarded ban setup"
```

---

### Task 13: Add worker shell, health checks, Docker, CI, `/doctor`, and beginner docs

**Files:**
- Create: `apps/worker/src/index.ts`
- Create: `apps/web/app/api/health/live/route.ts`
- Create: `apps/web/app/api/health/ready/route.ts`
- Create: `apps/bot/src/commands/doctor.ts`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `docs/setup/01-requirements.md`
- Create: `docs/setup/02-create-discord-app.md`
- Create: `docs/setup/03-install-with-docker.md`
- Create: `docs/setup/04-configure-environment.md`
- Create: `docs/setup/05-invite-knight.md`
- Create: `docs/setup/06-first-run.md`
- Create: `docs/setup/07-enable-guarded-permissions.md`
- Create: `docs/staff/staff-profiles.md`
- Create: `docs/staff/limits.md`
- Create: `docs/troubleshooting/doctor.md`

**Interfaces:**
- Docker services: `bot`, `web`, `worker`, `postgres`, `redis`.
- Beginner docs follow the implemented setup flow exactly.

- [ ] **Step 1: Implement worker shell and health endpoints**

Worker validates env, connects to PostgreSQL/Redis, emits ready state, and supports graceful SIGTERM. It runs no backup/incident jobs yet.

`/api/health/live` returns 200 when web is alive. `/api/health/ready` checks PostgreSQL + Redis and returns 503 with non-secret component status if either is unavailable.

- [ ] **Step 2: Create Docker deployment**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: knight
      POSTGRES_USER: knight
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - knight-postgres:/var/lib/postgresql/data
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

Add health checks/dependency readiness. The Docker image never copies a real `.env`.

- [ ] **Step 3: Implement `/doctor`**

Report:

```text
Discord connection
PostgreSQL + migration health
Redis health
Guild availability
View Audit Log / Ban Members / Manage Roles capability
Knight role vs mapped staff roles
Current Observe/Test/Guarded mode
Dashboard APP_URL
```

Never echo credentials, tokens, connection strings, or OAuth secrets.

- [ ] **Step 4: Write beginner setup docs**

The docs must walk a first-time user through:

1. Install Git + Docker.
2. Create Discord application/bot.
3. Copy token, client ID, client secret.
4. Configure OAuth callback `${APP_URL}/api/auth/callback/discord`.
5. Enable Guild Members intent; explain Message Content is not needed yet.
6. Fill `.env` from `.env.example`.
7. Run `docker compose up -d`.
8. Invite Knight with required permissions and place Knight above staff roles it must manage.
9. Run `/doctor` then `/setup`.
10. Create/import Staff Profiles and assign staff.
11. Add Security Managers if desired.
12. Use the dashboard to grant `member.ban` and configure its rate windows.
13. Enter Test and test `/member ban`.
14. Preview Guarded mode; explain that this foundation removes **only** native Ban Members.
15. Enable Guarded and test rate-limit denial.
16. Roll back Guarded if needed.

Every major guide includes what the feature does, why it matters, concrete steps/example, security implications, and common mistakes.

- [ ] **Step 5: Add CI**

CI provisions PostgreSQL + Redis and runs:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also apply migrations to an empty CI database.

- [ ] **Step 6: Run full local verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
docker compose up -d postgres redis
pnpm --filter @knight/database drizzle-kit migrate
```

Expected: every command exits 0.

- [ ] **Step 7: Run private Discord smoke test**

Verify:

```text
/doctor -> healthy or actionable hierarchy warning
/setup -> persistent Observe state
/staff create-profile -> mapped test role
/staff assign -> Knight assignment + role
/security manager-add -> explicit manager gains dashboard access
arbitrary Discord Administrator -> denied dashboard security access
profile editor -> member.ban + 2/30m policy becomes a new version
Observe -> Test
/member ban -> allowed against lower target
third ban after configured limit -> denied before Discord mutation
Guarded preview -> exact Ban Members removal only
Guarded enable -> snapshot then strips Ban Members
rollback -> restores original permission bigint
```

Any Discord-specific mismatch becomes a regression test before milestone completion.

- [ ] **Step 8: Commit**

```bash
git add apps/worker apps/web/app/api/health apps/bot/src/commands/doctor.ts Dockerfile docker-compose.yml .github README.md docs .env.example
git commit -m "docs: ship Knight security foundation setup"
```

---

## Final milestone verification

Before claiming completion, run fresh:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
```

Then verify each requirement:

- [ ] Two test guild IDs cannot read/change each other's Staff Profiles.
- [ ] Dashboard uses Discord OAuth database sessions.
- [ ] Guild owner and explicit Security Manager access work.
- [ ] Arbitrary native Discord Administrator access is denied.
- [ ] Staff Profiles are custom, versioned, role-mapped, and guild-scoped.
- [ ] Mapped Discord role possession without Knight assignment grants no Knight authority.
- [ ] Direct/indirect self-escalation tests pass.
- [ ] `/member ban` always passes through `@knight/security` before Discord.
- [ ] Rate-limit state is atomic under simultaneous attempts.
- [ ] Redis/rate-state failure fails the Guarded ban closed.
- [ ] Durable policy decisions are PostgreSQL; execution correlations are Redis-only and expire.
- [ ] Observe → Test persists.
- [ ] Test → Guarded is owner-only and blocked on bad role hierarchy.
- [ ] Foundation Guarded mode strips only Ban Members.
- [ ] Guarded rollback restores saved role permission state.
- [ ] `/doctor` reports health without exposing secrets.
- [ ] Beginner docs match the real setup flow.

## Follow-up implementation plans

After this milestone is verified and merged, create separate plans in this order:

1. **Anti-nuke Event & Incident Engine** — audit-event ingestion, native bypass detection, cross-action risk, protected resources, deterministic attack patterns, restriction/quarantine/lockdown/panic.
2. **Security Ledger & Incident UX** — append-oriented ledger, hash chain, before/after diffs, Discord alert routing, timelines, notes, exports.
3. **Backups & Recovery** — snapshots, selected-channel archive, resource mapping, emergency snapshots, point-in-time/incident recovery, resumable jobs.
4. **Bot/Webhook Firewall + Raid Layer** — bot inventory/approval, webhook controls, join bursts, Raid Mode, AutoMod protection.
5. **Anomaly + Shadow Mode + Simulator + Security Score** — advisory baselines, policy replay, explainable score/recommendations.
6. **Dashboard Completion & Documentation Polish** — remaining approved pages, advanced policy editing, incident/recovery UX, distributed/cloud deployment docs.
