# Knight Security Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working Knight milestone: a typed monorepo with PostgreSQL/Redis, Discord + web entry points, custom Staff Profiles, shared Guarded-permission policy evaluation, a working guarded ban vertical slice, Discord OAuth dashboard authorization, and the Observe → Test → Guarded setup/migration skeleton.

**Architecture:** Knight is a pnpm TypeScript monorepo. `packages/security` owns pure authorization decisions; durable data is stored through `packages/database`; ephemeral counters/locks live behind `packages/redis`; Discord mutations go through `packages/discord`. `apps/bot` and `apps/web` are clients of those shared packages and must not duplicate policy rules.

**Tech Stack:** Node.js 24 LTS, pnpm 12, TypeScript, discord.js 14.27.x, Next.js 16.3.x, React, Auth.js/NextAuth Discord provider, Drizzle ORM 0.44.x, PostgreSQL, Redis, Zod, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-09-knight-security-platform-design.md`

## Global Constraints

- Self-hosted only; one deployment may protect multiple guilds.
- Dashboard authentication is Discord OAuth only.
- Native Discord `Administrator` alone never grants Knight security-management authority.
- PostgreSQL is authoritative; Redis is disposable operational state.
- Destructive Guarded actions fail closed when Knight cannot establish policy.
- Discord role membership is representation; active Knight staff assignment is authority.
- No direct or indirect self-escalation.
- Restrictions, lockdowns, protected-target rules, and quarantine override grants.
- Guild owner retains ultimate Knight authority.
- Anomaly detection is advisory-only; this milestone does not implement anomaly scoring.
- Guarded migration is staged: Observe → Test → Guarded, and entering Guarded requires explicit guild-owner confirmation plus a role-permission snapshot.
- Core anti-nuke does not require Message Content intent.
- Use Node.js `>=24.17.0 <25`; discord.js currently requires Node.js 24.17+.
- Use Next.js 16.3.x Active LTS, discord.js 14.27.x, and stable Drizzle 0.44.x; do not use Drizzle 1.0 beta in this milestone.
- Prefer small, responsibility-focused files; no security decision logic in command handlers or React components.
- Every guild-scoped repository method requires an explicit `guildId` argument.

---

## Milestone boundary

This plan intentionally implements only the **Security Foundation** slice of the approved product spec. It does **not** yet implement full incident correlation, native audit-log attack detection, backups/recovery, bot/webhook firewall, raid mode, anomaly scoring, panic mode, or the complete dashboard. Those receive separate implementation plans after this foundation is merged.

The milestone is complete when a self-hosted Knight instance can:

1. Start bot/web/worker with PostgreSQL + Redis.
2. Authenticate a dashboard user with Discord OAuth.
3. Register a guild owner and explicit Security Managers.
4. Create/version Staff Profiles mapped to Discord roles.
5. Assign a user to a Staff Profile and synchronize the mapped role.
6. Evaluate `member.ban` through one shared policy engine using hierarchy, permissions, rate windows, and emergency-state precedence.
7. Execute an allowed ban through Knight and deny a rate-limited/unauthorized ban before Discord is called.
8. Persist a policy decision + execution correlation record.
9. Persist setup state and move Observe → Test.
10. Preview and explicitly approve Test → Guarded, snapshotting and stripping selected native permissions from mapped staff roles.
11. Roll back that migration from the saved snapshot.
12. Show beginner-readable health/setup state in Discord and the web dashboard.

## Planned repository structure after this milestone

```text
apps/
├── bot/
│   └── src/
│       ├── commands/
│       ├── discord-client.ts
│       ├── register-commands.ts
│       └── index.ts
├── web/
│   ├── app/
│   ├── auth.ts
│   └── lib/
└── worker/
    └── src/index.ts

packages/
├── config/src/
├── contracts/src/
├── database/src/
│   ├── schema/
│   ├── repositories/
│   └── migrations/
├── redis/src/
├── security/src/
└── discord/src/

tests/
└── integration/
```

---

### Task 1: Bootstrap the pnpm TypeScript workspace and quality gates

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `vitest.workspace.ts`
- Create: `apps/bot/package.json`
- Create: `apps/web/package.json`
- Create: `apps/worker/package.json`
- Create: `packages/config/package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/database/package.json`
- Create: `packages/redis/package.json`
- Create: `packages/security/package.json`
- Create: `packages/discord/package.json`

**Interfaces:**
- Produces workspace package names `@knight/config`, `@knight/contracts`, `@knight/database`, `@knight/redis`, `@knight/security`, and `@knight/discord`.
- All later tasks rely on root scripts `lint`, `typecheck`, `test`, and `build`.

- [ ] **Step 1: Create the root workspace manifest**

```json
{
  "name": "knight",
  "private": true,
  "packageManager": "pnpm@12.4.0",
  "engines": {
    "node": ">=24.17.0 <25"
  },
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

- [ ] **Step 2: Configure pnpm workspaces and shared TypeScript defaults**

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
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Add root dev dependencies and package-local manifests**

Run:

```bash
corepack enable
pnpm add -Dw typescript eslint @eslint/js typescript-eslint prettier vitest zod
```

Each library package starts with:

```json
{
  "name": "@knight/contracts",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  }
}
```

Create an equivalent manifest for each package with the correct `name`.

- [ ] **Step 4: Add secret-safe ignore rules and documented environment skeleton**

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

`.env.example` must include commented placeholders for `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `AUTH_SECRET`, `APP_URL`, `DATABASE_URL`, and `REDIS_URL`, explicitly stating that real secrets must never be committed.

- [ ] **Step 5: Verify the workspace resolves**

Run:

```bash
node --version
pnpm --version
pnpm install
pnpm typecheck
```

Expected: Node is `>=24.17.0 <25`, pnpm resolves the workspace, and TypeScript exits 0 even though packages are still nearly empty.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: bootstrap Knight monorepo"
```

---

### Task 2: Define environment validation and canonical security contracts

**Files:**
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/env.ts`
- Create: `packages/config/src/index.ts`
- Create: `packages/config/src/env.test.ts`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/actions.ts`
- Create: `packages/contracts/src/policy.ts`
- Create: `packages/contracts/src/staff.ts`
- Create: `packages/contracts/src/setup.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Produces `ActionId`, `ACTION_IDS`, `PolicyDecision`, `SecurityDecision`, `RateWindow`, `ActionPolicy`, `GuildMode`, `SetupStep`, `StaffProfileSnapshot`, and `KnightEnv`.
- Later tasks must import these instead of redefining equivalent types.

- [ ] **Step 1: Write failing environment-validation tests**

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("rejects missing security-critical variables", () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
  });

  it("accepts a complete development configuration", () => {
    const env = parseEnv({
      NODE_ENV: "test",
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "123",
      DISCORD_CLIENT_SECRET: "secret",
      AUTH_SECRET: "x".repeat(32),
      APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://knight:knight@localhost:5432/knight",
      REDIS_URL: "redis://localhost:6379"
    });
    expect(env.NODE_ENV).toBe("test");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @knight/config test
```

Expected: FAIL because `parseEnv` does not exist.

- [ ] **Step 3: Implement Zod environment parsing**

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
export const parseEnv = (input: NodeJS.ProcessEnv | Record<string, string | undefined>) =>
  EnvSchema.parse(input);
```

- [ ] **Step 4: Write failing canonical-contract tests**

```ts
import { describe, expect, it } from "vitest";
import { ACTION_IDS, GuildMode, PolicyDecision } from "./index.js";

describe("security contracts", () => {
  it("contains the guarded member ban action", () => {
    expect(ACTION_IDS).toContain("member.ban");
  });

  it("uses explicit policy decisions and modes", () => {
    expect(PolicyDecision.Deny).toBe("DENY");
    expect(GuildMode.Guarded).toBe("GUARDED");
  });
});
```

- [ ] **Step 5: Implement canonical action and policy types**

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
  "security.policy.view",
  "security.policy.edit",
  "security.approvals.approve",
  "security.lockdown",
  "security.panic"
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export enum PolicyDecision {
  Allow = "ALLOW",
  Deny = "DENY",
  RequireApproval = "REQUIRE_APPROVAL",
  Contain = "CONTAIN"
}

export enum GuildMode {
  Observe = "OBSERVE",
  Test = "TEST",
  Guarded = "GUARDED"
}

export type RateWindow = Readonly<{ max: number; windowMs: number }>;

export type SecurityDecision = Readonly<{
  decision: PolicyDecision;
  code: string;
  reason: string;
  policyVersionId: string | null;
  metadata: Readonly<Record<string, unknown>>;
}>;
```

Add `SetupStep` as `WELCOME | HEALTH | STAFF | POLICIES | LOGGING | PROTECTION | BACKUPS | OBSERVE | COMPLETE` and a serializable `StaffProfileSnapshot` containing profile/version IDs, guild ID, role ID, rank, permissions, and action policies.

- [ ] **Step 6: Run tests and typecheck**

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

### Task 3: Create the PostgreSQL schema, migrations, and guild-scoped repositories

**Files:**
- Create: `packages/database/tsconfig.json`
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
- Create: `packages/database/src/index.ts`
- Test: `tests/integration/database/staff-repository.test.ts`

**Interfaces:**
- Produces `Database`, `GuildRepository`, `StaffRepository`, `SecurityManagerRepository`.
- `StaffRepository.getEffectiveProfile(guildId, userId)` returns the active assignment + current version data or `null`.
- `StaffRepository.createProfileVersion(...)` is the only supported way to mutate profile permissions/policies.

- [ ] **Step 1: Add database dependencies**

Run:

```bash
pnpm --filter @knight/database add drizzle-orm@0.44.7 pg
pnpm --filter @knight/database add -D drizzle-kit @types/pg
```

- [ ] **Step 2: Write the failing integration test for guild isolation and versioning**

```ts
it("never returns another guild's staff assignment", async () => {
  const guildA = await guilds.create({ id: "100", ownerId: "1" });
  await guilds.create({ id: "200", ownerId: "2" });
  const profile = await staff.createProfile({ guildId: guildA.id, name: "Moderator", discordRoleId: "900", rank: 20 });
  await staff.assign({ guildId: guildA.id, userId: "42", profileId: profile.id, actorUserId: "1" });

  expect(await staff.getEffectiveProfile("200", "42")).toBeNull();
  expect((await staff.getEffectiveProfile("100", "42"))?.name).toBe("Moderator");
});

it("creates immutable numbered profile versions", async () => {
  const profile = await staff.createProfile({ guildId: "100", name: "Moderator", discordRoleId: "900", rank: 20 });
  const v1 = await staff.createProfileVersion({ guildId: "100", profileId: profile.id, permissions: ["member.ban"], actionPolicies: {} });
  const v2 = await staff.createProfileVersion({ guildId: "100", profileId: profile.id, permissions: [], actionPolicies: {} });
  expect(v1.version).toBe(1);
  expect(v2.version).toBe(2);
});
```

- [ ] **Step 3: Run the integration test and confirm failure**

Run with a test PostgreSQL URL:

```bash
DATABASE_URL=postgres://knight:knight@localhost:5432/knight_test pnpm vitest run tests/integration/database/staff-repository.test.ts
```

Expected: FAIL because schema/repositories do not exist.

- [ ] **Step 4: Implement schema with database constraints**

Use UUID primary keys for Knight-owned objects and `text` for Discord Snowflakes. Required tables for this milestone:

```text
guilds
setup_states
staff_profiles
staff_profile_versions
staff_assignments
security_managers
staff_overrides
temporary_access
guarded_categories
role_permission_snapshots
policy_decisions
execution_correlations
```

`staff_profiles` must have a unique `(guild_id, name)` constraint. `staff_assignments` must prevent two simultaneous active assignments for the same `(guild_id, user_id)` unless the future spec explicitly expands to multi-profile membership. `staff_profile_versions` must have unique `(profile_id, version)`.

Store `permissions` and `action_policies` as typed JSONB on immutable profile-version rows; do not mutate previous versions.

- [ ] **Step 5: Add Auth.js-compatible database tables**

Create `users`, `accounts`, `sessions`, and `verification_tokens` in `schema/auth.ts` using the column names expected by `@auth/drizzle-adapter`. Discord OAuth access tokens remain server-side only and must never be returned from dashboard APIs.

- [ ] **Step 6: Generate and apply the first migration**

```bash
pnpm --filter @knight/database drizzle-kit generate
pnpm --filter @knight/database drizzle-kit migrate
```

Expected: migration succeeds on a clean PostgreSQL database.

- [ ] **Step 7: Implement guild-scoped repository methods**

Minimum signatures:

```ts
export interface StaffRepository {
  createProfile(input: { guildId: string; name: string; discordRoleId: string; rank: number }): Promise<StaffProfile>;
  createProfileVersion(input: CreateProfileVersionInput): Promise<StaffProfileVersion>;
  assign(input: { guildId: string; userId: string; profileId: string; actorUserId: string }): Promise<StaffAssignment>;
  deactivateAssignment(input: { guildId: string; userId: string; actorUserId: string }): Promise<void>;
  getEffectiveProfile(guildId: string, userId: string): Promise<StaffProfileSnapshot | null>;
  listProfiles(guildId: string): Promise<StaffProfile[]>;
}
```

Every query must include `guildId` in its `WHERE` clause even when querying by a globally unique Knight UUID.

- [ ] **Step 8: Run migration and repository tests**

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

### Task 4: Implement atomic Redis rate-limit and lock primitives

**Files:**
- Create: `packages/redis/tsconfig.json`
- Create: `packages/redis/src/client.ts`
- Create: `packages/redis/src/rate-limit-store.ts`
- Create: `packages/redis/src/lock-store.ts`
- Create: `packages/redis/src/index.ts`
- Create: `packages/redis/src/rate-limit-store.test.ts`

**Interfaces:**
- Produces `RateLimitStore.consume(input): Promise<RateLimitResult>`.
- Produces `LockStore.acquire(key, ttlMs): Promise<LockLease | null>` and `LockLease.release()`.
- Policy code depends on the interface, not on ioredis directly.

- [ ] **Step 1: Add Redis dependency and write the failing rate-limit test**

```bash
pnpm --filter @knight/redis add ioredis
```

```ts
it("atomically denies the third action in a 2-action window", async () => {
  const now = 1_000_000;
  expect((await store.consume({ key: "g:1:u:2:member.ban", windows: [{ max: 2, windowMs: 60_000 }], nowMs: now })).allowed).toBe(true);
  expect((await store.consume({ key: "g:1:u:2:member.ban", windows: [{ max: 2, windowMs: 60_000 }], nowMs: now + 1 })).allowed).toBe(true);
  expect((await store.consume({ key: "g:1:u:2:member.ban", windows: [{ max: 2, windowMs: 60_000 }], nowMs: now + 2 })).allowed).toBe(false);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/redis test
```

Expected: FAIL because `RateLimitStore` is missing.

- [ ] **Step 3: Implement one atomic Lua evaluation for all windows**

The Lua script must:

1. Remove expired timestamps from each sorted-set window key.
2. Check every window before adding the new event.
3. If any window is full, add nothing and return `allowed = 0` plus reset metadata.
4. If all pass, add one event to every window and set expiry.

The TypeScript result shape is:

```ts
export type RateLimitResult = Readonly<{
  allowed: boolean;
  windows: ReadonlyArray<{
    max: number;
    windowMs: number;
    used: number;
    remaining: number;
    resetAtMs: number;
  }>;
}>;
```

Use a unique member value such as `${nowMs}:${crypto.randomUUID()}` so simultaneous operations cannot overwrite each other.

- [ ] **Step 4: Implement ownership-token locks**

Acquire with `SET key token NX PX ttl`; release with Lua that deletes only when the stored token equals the lease token. Never release another worker's lock.

- [ ] **Step 5: Run tests and typecheck**

```bash
REDIS_URL=redis://localhost:6379 pnpm --filter @knight/redis test
pnpm --filter @knight/redis typecheck
```

Expected: PASS, including a test with two simultaneous `consume()` calls competing for one remaining slot.

- [ ] **Step 6: Commit**

```bash
git add packages/redis
 git commit -m "feat: add atomic security rate limits"
```

---

### Task 5: Implement the pure Staff Profile authorization engine

**Files:**
- Create: `packages/security/tsconfig.json`
- Create: `packages/security/src/authorization/types.ts`
- Create: `packages/security/src/authorization/evaluate-policy.ts`
- Create: `packages/security/src/authorization/effective-access.ts`
- Create: `packages/security/src/authorization/self-escalation.ts`
- Create: `packages/security/src/authorization/evaluate-policy.test.ts`
- Create: `packages/security/src/index.ts`

**Interfaces:**
- Produces `evaluatePolicy(context): SecurityDecision`.
- Produces `wouldIncreaseOwnAuthority(change): boolean`.
- This package accepts already-loaded durable state; it performs no SQL, Redis, Discord, or HTTP calls.

- [ ] **Step 1: Write table-driven failing policy tests**

```ts
it.each([
  ["moderator banning member", ctx({ actorRank: 20, targetRank: 0, permissions: ["member.ban"] }), "ALLOW"],
  ["moderator banning admin", ctx({ actorRank: 20, targetRank: 50, permissions: ["member.ban"] }), "DENY"],
  ["missing permission", ctx({ actorRank: 20, targetRank: 0, permissions: [] }), "DENY"],
  ["lockdown overrides grant", ctx({ actorRank: 20, targetRank: 0, permissions: ["member.ban"], memberModerationLocked: true }), "DENY"]
])("%s", (_name, context, expected) => {
  expect(evaluatePolicy(context).decision).toBe(expected);
});
```

Add tests proving:

- a temporary restriction beats a profile grant;
- a protected target can require approval;
- guild owner cannot be targeted by staff;
- Observe/Test do not magically authorize native Discord permissions;
- an inactive assignment is denied;
- direct and indirect self-escalation are rejected.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pnpm --filter @knight/security test
```

Expected: FAIL because policy functions do not exist.

- [ ] **Step 3: Implement precedence in one explicit order**

`evaluatePolicy` must use this order:

```text
1. actor assignment active?
2. actor/target owner invariants
3. emergency/quarantine/lockdown restrictions
4. explicit temporary restrictions
5. canonical permission present after overrides/grants
6. hierarchy / protected-target rule
7. approval requirement
8. return ALLOW (rate/risk evaluated by orchestration task later)
```

Return stable codes such as `NO_ACTIVE_STAFF_ASSIGNMENT`, `OWNER_TARGET_PROTECTED`, `LOCKDOWN_ACTIVE`, `TEMPORARILY_RESTRICTED`, `PERMISSION_MISSING`, `TARGET_OUTRANKS_ACTOR`, `APPROVAL_REQUIRED`, and `ALLOWED`.

- [ ] **Step 4: Implement self-escalation comparison**

`wouldIncreaseOwnAuthority` compares the actor's effective pre-change and post-change permissions/ranks/limits. It returns true when a proposed profile edit, assignment, override, or restriction removal would increase the actor's own effective access.

Tests must include the indirect case where Alice edits the shared `Moderator` profile while Alice is assigned to `Moderator`.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @knight/security test
pnpm --filter @knight/security typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/security
 git commit -m "feat: add Staff Profile authorization engine"
```

---

### Task 6: Add guarded-action orchestration with rate-limit consumption and decision persistence

**Files:**
- Create: `packages/security/src/guarded/authorize-guarded-action.ts`
- Create: `packages/security/src/guarded/ports.ts`
- Create: `packages/security/src/guarded/authorize-guarded-action.test.ts`
- Create: `packages/database/src/repositories/policy-decision-repository.ts`
- Create: `packages/database/src/repositories/execution-correlation-repository.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/security/src/index.ts`

**Interfaces:**
- Produces `authorizeGuardedAction(request): Promise<SecurityDecision>`.
- Consumes `StaffStatePort`, `RateLimitPort`, and `DecisionLogPort` interfaces.
- Later Discord commands call this orchestration function before any mutation.

- [ ] **Step 1: Write a failing orchestration test using in-memory fakes**

```ts
it("denies before mutation when the ban window is exhausted", async () => {
  const decision = await authorizeGuardedAction({
    guildId: "1",
    actorUserId: "10",
    action: "member.ban",
    target: { userId: "20", knightRank: 0, isGuildOwner: false, protection: "NORMAL" },
    nowMs: 1000
  }, ports({ rateAllowed: false }));

  expect(decision.decision).toBe("DENY");
  expect(decision.code).toBe("RATE_LIMIT_EXCEEDED");
  expect(fakeDecisionLog.entries).toHaveLength(1);
});
```

Also test that `RateLimitPort.consume` is **not called** if the pure authorization layer already denies the action, so denied hierarchy/permission checks never consume rate budget.

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/security test
```

Expected: FAIL.

- [ ] **Step 3: Implement orchestration**

Minimum flow:

```ts
const baseDecision = evaluatePolicy(context);
if (baseDecision.decision !== PolicyDecision.Allow) {
  await decisionLog.record(request, baseDecision);
  return baseDecision;
}

const rate = await rateLimits.consume(rateKey(request), context.actionPolicy.rateWindows, request.nowMs);
if (!rate.allowed) {
  const denied = deny("RATE_LIMIT_EXCEEDED", { rate });
  await decisionLog.record(request, denied);
  return denied;
}

const allowed = allow({ rate });
await decisionLog.record(request, allowed);
return allowed;
```

If the rate-limit dependency throws or cannot establish state, return `DENY` with `DEPENDENCY_UNAVAILABLE`; never default to allow.

- [ ] **Step 4: Persist decision and execution-correlation records**

`PolicyDecisionRepository.record` stores guild, actor, action, target, profile version, decision, code, metadata, and timestamp. `ExecutionCorrelationRepository.create` stores only short-lived expected Knight mutations and is pruned by expiry; durable policy decisions remain in PostgreSQL.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @knight/security test
DATABASE_URL=postgres://knight:knight@localhost:5432/knight_test pnpm vitest run tests/integration/database
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/security packages/database
 git commit -m "feat: orchestrate guarded security decisions"
```

---

### Task 7: Build the Discord adapter and bot process skeleton

**Files:**
- Create: `packages/discord/tsconfig.json`
- Create: `packages/discord/src/port.ts`
- Create: `packages/discord/src/discord-js-adapter.ts`
- Create: `packages/discord/src/index.ts`
- Create: `apps/bot/tsconfig.json`
- Create: `apps/bot/src/discord-client.ts`
- Create: `apps/bot/src/register-commands.ts`
- Create: `apps/bot/src/index.ts`
- Create: `apps/bot/src/doctor/discord-health.ts`
- Create: `apps/bot/src/doctor/discord-health.test.ts`

**Interfaces:**
- Produces `DiscordActionPort` with `banMember`, `addRole`, `removeRole`, `getMemberState`, `getGuildState`, and `setRolePermissions`.
- Produces a connected bot client using only core intents needed by this milestone.

- [ ] **Step 1: Add discord.js and write a failing hierarchy-health test**

```bash
pnpm --filter @knight/discord add discord.js@14.27.0
pnpm --filter @knight/bot add discord.js@14.27.0 @knight/config@workspace:* @knight/contracts@workspace:* @knight/security@workspace:* @knight/database@workspace:* @knight/redis@workspace:* @knight/discord@workspace:*
```

```ts
it("reports degraded protection when Knight is below a mapped staff role", () => {
  expect(checkHierarchyHealth({ knightRolePosition: 40, protectedRolePositions: [20, 50] }).healthy).toBe(false);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/bot test
```

- [ ] **Step 3: Define the Discord adapter port**

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

The `discord.js` implementation belongs only in `packages/discord`.

- [ ] **Step 4: Configure core Gateway intents**

Use `Guilds`, `GuildMembers`, `GuildModeration`, `GuildWebhooks`, and `AutoModerationConfiguration`. Do not request Message Content in the core client for this milestone.

- [ ] **Step 5: Implement connection/startup and command registration scaffolding**

`apps/bot/src/index.ts` parses env first, creates DB/Redis/Discord dependencies, logs in, and exits non-zero on invalid critical configuration. `register-commands.ts` registers `/setup`, `/doctor`, `/staff ...`, and `/member ban` command definitions.

- [ ] **Step 6: Run bot package tests/typecheck**

```bash
pnpm --filter @knight/discord typecheck
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
```

Expected: PASS without requiring a live Discord token for unit tests.

- [ ] **Step 7: Commit**

```bash
git add packages/discord apps/bot
 git commit -m "feat: add Discord adapter and bot shell"
```

---

### Task 8: Implement the first end-to-end Guarded moderation action: `/member ban`

**Files:**
- Create: `apps/bot/src/commands/member/ban.ts`
- Create: `apps/bot/src/commands/member/ban.test.ts`
- Create: `apps/bot/src/commands/router.ts`
- Modify: `apps/bot/src/index.ts`

**Interfaces:**
- `/member ban user:<member> reason:<text>` calls `authorizeGuardedAction` before `DiscordActionPort.banMember`.
- Allowed actions create an execution-correlation record before Discord mutation.

- [ ] **Step 1: Write a failing command-handler test**

```ts
it("does not call Discord when Knight denies the ban", async () => {
  security.authorizeGuardedAction.mockResolvedValue({ decision: "DENY", code: "RATE_LIMIT_EXCEEDED", reason: "Ban limit reached", policyVersionId: "v1", metadata: {} });

  await handleBan(interaction, deps);

  expect(discord.banMember).not.toHaveBeenCalled();
  expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
});

it("records correlation before an allowed Discord ban", async () => {
  security.authorizeGuardedAction.mockResolvedValue({ decision: "ALLOW", code: "ALLOWED", reason: "Allowed", policyVersionId: "v1", metadata: {} });
  await handleBan(interaction, deps);
  expect(executions.create).toHaveBeenCalledBefore(discord.banMember);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/bot test -- ban.test.ts
```

- [ ] **Step 3: Implement target resolution and policy request**

Resolve the target's Knight rank/protection plus Discord hierarchy state. Never infer `rank = 0` merely because the target lacks a Knight assignment if their Discord roles are elevated; use a conservative `elevatedUnregistered` target flag that causes denial/approval according to target policy.

- [ ] **Step 4: Implement clear denial and success responses**

A rate-limit denial must show current policy usage/reset metadata when available. A missing permission must state which canonical permission was missing. Do not expose secrets or internal stack traces.

- [ ] **Step 5: Run unit tests**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/commands
 git commit -m "feat: add guarded member ban command"
```

---

### Task 9: Implement Staff Profile creation, assignment, inspection, and mapped-role synchronization

**Files:**
- Create: `apps/bot/src/commands/staff/create-profile.ts`
- Create: `apps/bot/src/commands/staff/assign.ts`
- Create: `apps/bot/src/commands/staff/remove.ts`
- Create: `apps/bot/src/commands/staff/inspect.ts`
- Create: `apps/bot/src/staff/role-sync-service.ts`
- Create: `apps/bot/src/staff/role-sync-service.test.ts`
- Modify: `apps/bot/src/register-commands.ts`

**Interfaces:**
- `RoleSyncService.assign(guildId, userId, profileId, actorUserId)` persists assignment first inside a DB transaction, then adds the mapped Discord role; failure marks synchronization status for repair instead of deleting evidence.
- Staff commands must be authorized by owner/Security Manager checks; self-escalation is denied.

- [ ] **Step 1: Write failing synchronization tests**

Test:

1. Assign persists the Knight assignment and adds the mapped role.
2. Remove deactivates the assignment and removes the role.
3. An unauthorized manually-added mapped role does not create a Knight assignment.
4. A user cannot assign themselves a higher-ranked profile.
5. A non-owner/non-Security-Manager cannot create a profile.

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/bot test -- role-sync-service.test.ts
```

- [ ] **Step 3: Implement command surfaces**

Initial command shapes:

```text
/staff create-profile name:<text> role:<role> rank:<integer>
/staff assign user:<member> profile:<profile-id-or-autocomplete>
/staff remove user:<member>
/staff inspect user:<member>
```

Profile creation creates v1 with zero dangerous permissions by default. Explicit permission/policy editing is done from the dashboard task below, preventing a single command from accidentally granting everything.

- [ ] **Step 4: Implement role-sync repair state**

When Discord role mutation fails after DB persistence, store `sync_status = NEEDS_REPAIR` and surface it in `/staff inspect`; never silently pretend the assignment is fully synchronized.

- [ ] **Step 5: Run tests/typecheck**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/bot typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/commands/staff apps/bot/src/staff
 git commit -m "feat: manage Knight Staff Profiles in Discord"
```

---

### Task 10: Scaffold Next.js dashboard with Discord OAuth and live Knight authorization

**Files:**
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/auth.ts`
- Create: `apps/web/lib/authorization.ts`
- Create: `apps/web/lib/authorization.test.ts`
- Create: `apps/web/app/guilds/[guildId]/layout.tsx`

**Interfaces:**
- Produces `requireGuildAccess(guildId, session): Promise<GuildAccess>`.
- Access is allowed only when the session Discord user is the persisted current guild owner or an active Knight Security Manager.
- Discord native `Administrator` is never consulted as an automatic grant.

- [ ] **Step 1: Add dashboard dependencies**

```bash
pnpm --filter @knight/web add next@16.3.3 react react-dom next-auth@beta @auth/drizzle-adapter @knight/config@workspace:* @knight/database@workspace:* @knight/contracts@workspace:* @knight/security@workspace:*
pnpm --filter @knight/web add -D @types/react @types/react-dom
```

- [ ] **Step 2: Write failing authorization tests**

```ts
it("allows the guild owner", async () => {
  await guilds.create({ id: "100", ownerId: "42" });
  await expect(requireGuildAccess("100", session("42"))).resolves.toMatchObject({ role: "OWNER" });
});

it("allows an explicit Security Manager", async () => {
  await securityManagers.grant({ guildId: "100", userId: "43", actorUserId: "42" });
  await expect(requireGuildAccess("100", session("43"))).resolves.toMatchObject({ role: "SECURITY_MANAGER" });
});

it("denies an arbitrary Discord Administrator", async () => {
  await expect(requireGuildAccess("100", session("44"))).rejects.toThrow(/not authorized/i);
});
```

- [ ] **Step 3: Verify failure**

```bash
pnpm --filter @knight/web test
```

- [ ] **Step 4: Configure Auth.js Discord provider with durable Drizzle sessions**

Use the Discord provider with `identify guilds` OAuth scope and the Drizzle adapter. Persist OAuth account/session data in PostgreSQL. Never expose the stored Discord OAuth access token to client components.

`auth.ts` exports:

```ts
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: "database" },
  providers: [Discord({ authorization: { params: { scope: "identify guilds" } } })]
});
```

- [ ] **Step 5: Implement server-side guild authorization**

Every guild dashboard layout calls `requireGuildAccess` on the server before rendering children. Sensitive server actions call it again; the layout check alone is not sufficient authorization.

- [ ] **Step 6: Add minimal authenticated home page**

Show the Knight-configured guilds the current user can access and their current mode (`OBSERVE`, `TEST`, `GUARDED`). Do not build the full dashboard in this milestone.

- [ ] **Step 7: Run tests/build**

```bash
pnpm --filter @knight/web test
pnpm --filter @knight/web typecheck
pnpm --filter @knight/web build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web packages/database/src/schema/auth.ts
 git commit -m "feat: add Discord-authenticated Knight dashboard"
```

---

### Task 11: Add the dashboard Staff Profile editor with versioned policy updates

**Files:**
- Create: `apps/web/app/guilds/[guildId]/staff/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/staff/[profileId]/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/staff/actions.ts`
- Create: `apps/web/lib/staff-profile-service.ts`
- Create: `apps/web/lib/staff-profile-service.test.ts`

**Interfaces:**
- Produces `updateStaffProfilePolicy(input, actor): Promise<StaffProfileVersion>`.
- Every edit creates a new immutable profile version.
- The service invokes `wouldIncreaseOwnAuthority` before persistence.

- [ ] **Step 1: Write failing service tests**

Test that:

- editing `Moderator` from `2 bans/30m` to `5 bans/30m` creates a new version;
- previous version remains unchanged;
- a Security Manager assigned to the edited profile cannot raise their own effective ban authority;
- guild owner may perform the same edit;
- cross-guild profile IDs are rejected even if the UUID exists.

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/web test -- staff-profile-service.test.ts
```

- [ ] **Step 3: Implement server-only profile service**

Input schema:

```ts
const UpdatePolicySchema = z.object({
  guildId: z.string().min(1),
  profileId: z.string().uuid(),
  permissions: z.array(z.enum(ACTION_IDS)),
  banWindows: z.array(z.object({ max: z.number().int().positive(), windowMs: z.number().int().positive() })).max(3)
});
```

Do not accept a user-supplied actor ID; derive the actor from the authenticated session.

- [ ] **Step 4: Implement beginner-friendly profile page**

The first screen exposes grouped permission toggles and simple rate windows for `member.ban`; advanced policy fields remain hidden for later milestones. Show the mapped Discord role, Knight rank, active member count, current version, and effective `member.ban` policy.

- [ ] **Step 5: Run tests/build**

```bash
pnpm --filter @knight/web test
pnpm --filter @knight/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/guilds apps/web/lib/staff-profile-service*
 git commit -m "feat: edit versioned Staff Profiles in dashboard"
```

---

### Task 12: Implement persistent setup state and Observe → Test → Guarded migration/rollback

**Files:**
- Create: `apps/bot/src/commands/setup.ts`
- Create: `apps/bot/src/setup/setup-service.ts`
- Create: `apps/bot/src/setup/guarded-migration-service.ts`
- Create: `apps/bot/src/setup/guarded-migration-service.test.ts`
- Create: `apps/web/app/guilds/[guildId]/setup/page.tsx`
- Create: `apps/web/app/guilds/[guildId]/setup/actions.ts`
- Modify: `packages/database/src/repositories/guild-repository.ts`
- Modify: `packages/database/src/repositories/staff-repository.ts`

**Interfaces:**
- Produces `SetupService.getState`, `SetupService.advanceStep`, `GuardedMigrationService.preview`, `enableGuarded`, and `rollbackGuarded`.
- `enableGuarded` is guild-owner-only regardless of ordinary Security Manager status.

- [ ] **Step 1: Write failing migration tests**

```ts
it("requires Test mode before Guarded", async () => {
  await expect(service.enableGuarded({ guildId: "1", actorUserId: "owner", categories: ["MEMBER_MODERATION"] }))
    .rejects.toThrow(/TEST mode/);
});

it("snapshots role permissions before stripping selected native permissions", async () => {
  await service.enableGuarded({ guildId: "1", actorUserId: "owner", categories: ["MEMBER_MODERATION"] });
  expect(snapshots.create).toHaveBeenCalledBefore(discord.setRolePermissions);
});

it("rolls back from the stored snapshot", async () => {
  await service.rollbackGuarded({ guildId: "1", actorUserId: "owner", migrationId: "m1" });
  expect(discord.setRolePermissions).toHaveBeenCalledWith(expect.objectContaining({ permissions: originalPermissions }));
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @knight/bot test -- guarded-migration-service.test.ts
```

- [ ] **Step 3: Implement persistent setup/mode transitions**

Allowed mode transitions in this milestone:

```text
OBSERVE -> TEST
TEST -> OBSERVE
TEST -> GUARDED (owner only + migration preview/snapshot)
GUARDED -> TEST (owner only + rollback/review path)
```

Reject any other transition with a stable error code.

- [ ] **Step 4: Implement Guarded permission category mapping**

For `MEMBER_MODERATION`, strip only the Discord bits corresponding to Ban Members, Kick Members, and Moderate Members from mapped staff roles selected for Guarded management. Preserve unrelated role permissions exactly.

Before mutation, save `(guildId, migrationId, roleId, permissionsBigIntString, timestamp)` for every affected role.

- [ ] **Step 5: Implement preview**

`preview()` returns affected profiles, roles, staff counts, exact Discord permissions to remove, and whether Knight's role hierarchy can manage each role. If any selected role is unmanageable, the preview is `blocked: true` and `enableGuarded` must refuse to start.

- [ ] **Step 6: Implement `/setup` and web setup skeleton**

Both surfaces read the same persistent setup state. Discord `/setup` shows current step, current mode, role-hierarchy health, and the next action. The web page shows the same progress plus buttons for Observe → Test, migration preview, Guarded confirmation, and rollback.

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @knight/bot test
pnpm --filter @knight/web test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/bot/src/setup apps/bot/src/commands/setup.ts apps/web/app/guilds packages/database/src/repositories
 git commit -m "feat: add staged Guarded Permissions setup"
```

---

### Task 13: Add worker/health processes, Docker Compose, CI, and beginner foundation docs

**Files:**
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`
- Create: `apps/web/app/api/health/live/route.ts`
- Create: `apps/web/app/api/health/ready/route.ts`
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
- Produces Docker services `bot`, `web`, `worker`, `postgres`, `redis`.
- Produces documented beginner setup matching the actual setup flow implemented in Task 12.

- [ ] **Step 1: Implement worker health shell**

The worker validates env, connects to PostgreSQL and Redis, emits a ready log line, and performs no backup/incident jobs yet. It must support graceful SIGTERM shutdown.

- [ ] **Step 2: Add live/readiness endpoints**

`/api/health/live` returns 200 when the web process is running. `/api/health/ready` checks PostgreSQL + Redis and returns 503 with non-secret component status when a required dependency is unavailable.

- [ ] **Step 3: Create Docker image and Compose stack**

Compose services:

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
```

Add health checks and `depends_on` readiness conditions; do not bake `.env` into the image.

- [ ] **Step 4: Implement `/doctor` foundation checks**

`/doctor` reports:

- bot connected;
- PostgreSQL reachable and migration current;
- Redis reachable;
- guild available;
- View Audit Log/Ban Members/Manage Roles capability present;
- Knight role above mapped staff roles;
- current setup mode;
- dashboard URL configured.

Secrets are never echoed.

- [ ] **Step 5: Write beginner setup docs that exactly match product behavior**

The docs must explain from zero:

1. Install Docker/Git.
2. Create a Discord application and bot.
3. Obtain token/client ID/client secret.
4. Set the OAuth callback to `${APP_URL}/api/auth/callback/discord`.
5. Enable the Guild Members privileged intent; explain that Message Content is not required for this foundation.
6. Fill `.env` from `.env.example`.
7. `docker compose up -d`.
8. Invite Knight with the documented bot permissions and place its role above staff roles it must contain/manage.
9. Run `/doctor` then `/setup`.
10. Import/create Staff Profiles.
11. Enter Test mode.
12. Preview Guarded migration.
13. Enable Guarded and verify `/member ban` works while mapped native ban/kick/timeout permissions are removed.
14. Explain rollback.

Each guide contains: what it does, why it matters, steps, a concrete example, security implications, and common mistakes.

- [ ] **Step 6: Add CI**

CI runs on pull requests and pushes:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Provision PostgreSQL and Redis service containers for integration tests. Add a migration check that starts from an empty database and applies all migrations.

- [ ] **Step 7: Run full verification locally**

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

- [ ] **Step 8: Perform a live Discord smoke test in a private test guild**

Verify manually with a non-production test guild:

```text
/doctor -> healthy or actionable hierarchy warning
/setup -> persistent Observe state
/staff create-profile -> creates profile mapped to test role
/staff assign -> adds role and assignment
Dashboard Discord login -> owner can enter guild
Security Manager -> can enter guild after explicit grant
Unlisted Administrator -> cannot enter Knight security dashboard
Observe -> Test -> succeeds
/member ban -> allowed against lower target under configured limit
/member ban after limit -> denied before Discord mutation
Guarded preview -> shows exact permission removal
Guarded enable -> snapshots and strips selected native permissions
Rollback -> restores captured role permissions
```

Record any Discord-specific mismatch as a bug and add a regression test before considering the milestone finished.

- [ ] **Step 9: Commit**

```bash
git add apps/worker apps/web/app/api/health Dockerfile docker-compose.yml .github README.md docs .env.example
 git commit -m "docs: ship self-hosted Knight foundation setup"
```

---

## Final milestone verification checklist

Before claiming the Security Foundation milestone complete, run fresh evidence for every item:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
```

Then verify against the milestone boundary:

- [ ] One deployment can persist isolated configuration for two test guild IDs.
- [ ] Dashboard uses Discord OAuth database sessions.
- [ ] Guild owner access works; explicit Security Manager access works; arbitrary Discord Administrator access is denied.
- [ ] Staff Profiles are custom, versioned, mapped to roles, and guild-scoped.
- [ ] Staff assignment is authority; manually adding the mapped role does not create authority.
- [ ] Self-escalation and indirect self-escalation tests pass.
- [ ] `/member ban` passes through `@knight/security` and rate limiting before Discord.
- [ ] Redis failure causes guarded ban denial, not implicit allow.
- [ ] Observe → Test persists.
- [ ] Test → Guarded is owner-only, previewed, snapshotted, and blocked when Knight cannot manage a role.
- [ ] Guarded rollback restores snapshot permissions.
- [ ] `/doctor` reports dependency and hierarchy state without exposing secrets.
- [ ] Beginner docs match the actual setup flow.

## Follow-up implementation plans after this milestone

Create separate plans, in this order, after the foundation passes verification:

1. **Anti-nuke Event & Incident Engine** — Gateway audit entry ingestion, native bypass detection, risk budgets, protected resources, deterministic attack patterns, restriction/quarantine/lockdown/panic.
2. **Security Ledger & Incident UX** — append-oriented ledger, hash chain, before/after diffs, Discord alert routing, incident timelines/notes/exports.
3. **Backups & Recovery** — structural snapshots, resource mapping, selected-channel archives, emergency snapshots, incident/point-in-time recovery, resumable worker jobs.
4. **Bot/Webhook Firewall + Raid Layer** — bot approval/inventory, webhook controls, join bursts, Raid Mode, AutoMod protection.
5. **Anomaly, Shadow Mode, Simulator & Security Score** — advisory behavior baselines, historical policy simulation, explainable score/recommendations.
6. **Dashboard Completion & Documentation Polish** — remaining approved dashboard pages, advanced policy editing, incident/recovery views, full cloud/distributed deployment docs.
