# Knight

Knight is a self-hosted Discord security bot that routes sensitive moderation through explicit Knight policy instead of treating Discord roles as authorization.

The core rule is: **Knight's PostgreSQL staff assignment is authority; a mapped Discord role is representation.** Manually adding a mapped Discord role does not grant Knight permissions.

## Security foundation

Knight includes Discord commands for setup, diagnostics, staff profiles, assignments, Security Managers, and guarded member bans; a Next.js dashboard using Discord OAuth for identity and Knight's own database for authorization; Observe, Test, and Guarded operating modes; exact Discord permission snapshots for Guarded `MEMBER_BAN`; PostgreSQL persistence; Redis operational state; health endpoints; a worker process; and a Docker Compose reference deployment.

## Start here

1. Read [requirements](docs/setup/01-requirements.md).
2. [Create the Discord application](docs/setup/02-create-discord-app.md).
3. [Install with Docker](docs/setup/03-install-with-docker.md).
4. [Configure the environment](docs/setup/04-configure-environment.md).
5. [Invite Knight](docs/setup/05-invite-knight.md).
6. Complete the [first run](docs/setup/06-first-run.md).
7. When Test mode is proven, read [Guarded permissions](docs/setup/07-enable-guarded-permissions.md).

Staff operators should also read [Staff Profiles](docs/staff/staff-profiles.md) and [limits](docs/staff/limits.md). For diagnostics, see [`/doctor`](docs/troubleshooting/doctor.md).

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
```

Never commit `.env`, bot tokens, OAuth secrets, database credentials, or Redis credentials. `.env.example` contains field names and local examples only.
