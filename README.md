# Knight

Knight is a self-hosted Discord security bot and dashboard that route sensitive moderation through explicit Knight policy instead of treating Discord roles as authorization.

The core rule is: **Knight's PostgreSQL staff assignment is authority; a mapped Discord role is representation.** Manually adding a mapped Discord role does not grant Knight permissions.

## Implemented security model

Knight includes:

- Discord moderation commands for warn, warning history, timeout, kick, ban, unban, and hierarchy-safe message purge.
- Explicit Staff Profile capabilities and independent rate budgets for all six mutating moderation actions.
- Versioned Staff Profile metadata/policy editing in the dashboard, with existing-role mapping and Security Manager grant ceilings.
- Observe, Test, and Guarded operating modes.
- Guarded replacement of Discord Ban Members, Kick Members, Moderate Members, and Manage Messages for mapped staff roles, with exact permission snapshots and rollback.
- PostgreSQL authority/persistence, hash-chained Security Ledger, configurable logging destinations, protected resources, and explicit bot/webhook firewall modes.
- Local gzip structural backups with SHA-256 verification, preview-first owner-confirmed recovery, durable checkpoints, and worker-only backup-volume access.
- Redis operational rate/lock state, health endpoints, `/doctor`, a worker process, and Docker Compose deployment.

The guild owner is Knight's ultimate authority. Non-owner mutating moderation cannot target the guild owner or equal/higher Knight-ranked staff. Discord Administrator by itself grants no Knight authority.

## Moderation commands

```text
/member warn user:<member> reason:<text>
/member warnings user:<member>
/member timeout user:<member> duration:<duration> reason:<text>
/member kick user:<member> reason:<text>
/member ban user:<member> reason:<text>
/member unban user_id:<discord-user-id> reason:<text>
/message purge count:<1-100> [user:<member>] [reason:<text>]
```

Timeout accepts one unit such as `10m`, `1h`, or `1d`, up to 28 days. Warning-history lookup is read-only and rank-independent but still requires owner authority or `member.warnings.view`.

## Start here

1. Read [requirements](docs/setup/01-requirements.md).
2. [Create the Discord application](docs/setup/02-create-discord-app.md).
3. [Install with Docker](docs/setup/03-install-with-docker.md).
4. [Configure the environment](docs/setup/04-configure-environment.md).
5. [Invite Knight](docs/setup/05-invite-knight.md).
6. Complete the [first run](docs/setup/06-first-run.md).
7. Create and edit [Staff Profiles](docs/staff/staff-profiles.md), including [independent action limits](docs/staff/limits.md).
8. Review [Logging and protection](docs/security/logging-and-protection.md).
9. Configure and test [Local backups and recovery](docs/backups/local-backups-and-recovery.md).
10. When Test mode is proven, review [Guarded permissions](docs/setup/07-enable-guarded-permissions.md).

For diagnostics, see [`/doctor`](docs/troubleshooting/doctor.md). For host-loss planning, read [Data residency](docs/security/data-residency.md) and [Disaster recovery](docs/backups/disaster-recovery.md).

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
docker build --tag knight-ci .
docker compose config
```

Use disposable PostgreSQL/Redis services for verification. Never commit `.env`, bot tokens, OAuth secrets, database credentials, or Redis credentials. `.env.example` contains field names and local examples only.
