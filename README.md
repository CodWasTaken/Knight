# Knight

Knight is a self-hosted Discord security bot and dashboard that routes sensitive moderation through explicit Knight policy instead of treating Discord roles as authorization.

The core rule is: **Knight's PostgreSQL staff assignment is authority; a mapped Discord role is representation.** Manually adding a mapped Discord role does not grant Knight permissions.

## Implemented security model

Knight includes:

- Discord moderation commands for warn, warning history, timeout, kick, ban, unban, and hierarchy-safe message purge.
- Explicit Staff Profile capabilities and independent rate budgets for all six mutating moderation actions.
- Versioned Staff Profile metadata/policy editing in the dashboard, with existing-role mapping and Security Manager grant ceilings.
- Observe, Test, and Guarded operating modes.
- Guarded replacement of Discord Ban Members, Kick Members, Moderate Members, and Manage Messages for mapped staff roles, with exact permission snapshots and rollback.
- PostgreSQL authority/persistence, hash-chained Security Ledger, independent Security, Moderation, Messages, and Voice notification destinations, protected resources, and explicit bot/webhook firewall modes.
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

## Prerequisites

You need:

- A Linux host or other Docker-supported machine with persistent disk storage.
- Git, Docker Engine, and Docker Compose v2. Verify them with `git --version`, `docker --version`, and `docker compose version`.
- A Discord account allowed to create applications and invite a bot.
- Discord **Manage Server** access to the server where Knight will run, plus authority to move Knight's role above every staff role it will manage.
- An unused local port for the dashboard (`3000` by default).
- For production, a stable public HTTPS URL and a reverse proxy or ingress that forwards it to Knight's dashboard port. `http://localhost:3000` is suitable for local testing.
- A password manager or equivalent secure place for the bot token, OAuth secret, Auth.js secret, PostgreSQL password, and Redis password.

Node.js and pnpm are not required for the Docker installation. They are needed only for local development; the repository currently targets Node.js 24 and pins pnpm through Corepack.

## Complete installation

### 1. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), select **New Application**, and give it a name.
2. Open **Bot**, create the bot if necessary, and securely copy its token.
3. Under **Privileged Gateway Intents**, enable **Server Members Intent**.
4. Optionally enable **Message Content Intent** if you want Knight to retain available deleted-message text or archive selected message evidence. Metadata-only deletion logging works without it.
5. Open **OAuth2** and securely copy the Client ID and Client Secret.
6. Add an OAuth redirect URI matching your dashboard URL exactly:

   ```text
   http://localhost:3000/api/auth/callback/discord
   ```

   For production, replace `http://localhost:3000` with the exact HTTPS origin used for `APP_URL`.

### 2. Clone Knight

```bash
git clone https://github.com/CodWasTaken/Knight.git
cd Knight
cp .env.example .env
```

### 3. Configure `.env`

Open `.env` in a local editor and set every required value:

- `DISCORD_TOKEN`: token from the Discord application Bot page.
- `DISCORD_CLIENT_ID`: Discord Application ID / OAuth Client ID.
- `DISCORD_CLIENT_SECRET`: OAuth client secret.
- `AUTH_SECRET`: a cryptographically random string of at least 32 characters. Generate one with `openssl rand -base64 48`.
- `APP_URL`: exact dashboard origin, without the OAuth callback path.
- `POSTGRES_PASSWORD`: a strong URL-safe value; `openssl rand -hex 32` is suitable.
- `REDIS_PASSWORD`: another independent URL-safe value.
- `ENABLE_MESSAGE_CONTENT_ARCHIVE`: `true` only when Message Content Intent is enabled and message-text retention is desired; otherwise keep `false`.
- `WEB_PORT`: optional host port override; omit it to use `3000`.

Do not commit `.env`. Do not paste the output of `docker compose config` anywhere because it expands secrets.

### 4. Invite the bot

1. In the Developer Portal, open **OAuth2 → URL Generator**.
2. Select the `bot` and `applications.commands` scopes.
3. Select only the Discord permissions required by the features you will use. A typical full Knight installation needs:
   - View Channels
   - Send Messages
   - Read Message History
   - View Audit Log
   - Manage Roles
   - Manage Messages
   - Moderate Members
   - Kick Members
   - Ban Members
4. Open the generated URL, choose the server, and authorize Knight.
5. In Discord's role settings, move Knight's role above every role that will map to a Knight Staff Profile. Knight cannot manage roles at or above its own position.

### 5. Build and start

Validate Compose without displaying the expanded configuration, then build the current source and start it:

```bash
docker compose config >/dev/null
docker compose up -d --build
```

The stack starts PostgreSQL and Redis, runs migrations, then starts the bot, dashboard, and worker. Check it with:

```bash
docker compose ps
docker compose logs --tail=100 migrate bot web worker
```

Wait for PostgreSQL, Redis, and web to report healthy, for `migrate` to exit successfully, and for the bot to report that Knight connected. Open `APP_URL` in a browser and sign in with Discord.

### 6. Configure the server

1. Run `/doctor` in Discord and resolve any missing permission or hierarchy warnings.
2. Open **Setup** in the dashboard and follow Health → Staff → Policies → Logging → Protection → Backups → Review.
3. Create at least one Staff Profile and explicitly assign members. Mapping a Discord role does not grant Knight authority by itself.
4. Save Security, Moderation, Messages, and Voice logging destinations. Disabled is valid for any category.
5. Configure deleted-message retention, firewall modes, optional protected resources, and a backup policy.
6. Complete setup, enter Test mode, and test with disposable members/messages before considering Guarded Moderation.
7. Review [first-run guidance](docs/setup/06-first-run.md) and [Guarded permissions](docs/setup/07-enable-guarded-permissions.md) before removing native moderation permissions from mapped staff roles.

### 7. Operate and update Knight

Knight is intentionally manual-start and uses `restart: "no"` for bot, web, and worker:

```bash
# Start an existing build
docker compose up -d

# Stop Knight without deleting its database or backup volumes
docker compose stop

# Pull and deploy a newer source version
git pull --ff-only origin main
docker compose up -d --build
```

Never use `docker compose down -v` unless you deliberately intend to delete Knight's local PostgreSQL and backup volumes.

## Further documentation

1. [Detailed requirements](docs/setup/01-requirements.md)
2. [Discord application setup](docs/setup/02-create-discord-app.md)
3. [Docker installation](docs/setup/03-install-with-docker.md)
4. [Environment configuration](docs/setup/04-configure-environment.md)
5. [Bot invitation and hierarchy](docs/setup/05-invite-knight.md)
6. [First run](docs/setup/06-first-run.md)
7. [Staff Profiles](docs/staff/staff-profiles.md) and [independent action limits](docs/staff/limits.md)
8. [Logging and protection](docs/security/logging-and-protection.md)
9. [Local backups and recovery](docs/backups/local-backups-and-recovery.md)
10. [Guarded permissions](docs/setup/07-enable-guarded-permissions.md)

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
docker compose config >/dev/null
```

Use disposable PostgreSQL/Redis services for verification. Never commit `.env`, bot tokens, OAuth secrets, database credentials, or Redis credentials. `.env.example` contains field names and local examples only.

Compose services use `restart: "no"`: start Knight manually with `docker compose up -d` and stop it with `docker compose stop`. After source changes—including slash-command changes—use `docker compose up -d --build`; restarting a stale image will not publish new code. `docker compose config` expands environment values, including secrets, so validate it with output redirected and never paste its expanded output publicly.
