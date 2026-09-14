# 3. Install with Docker

## What and why

The reference Compose stack starts PostgreSQL and Redis first, applies database migrations once, then starts the bot, dashboard, and worker. This prevents application processes from racing an empty database.

## How

Clone Knight, enter the repository, and create your local environment file:

```bash
git clone https://github.com/CodWasTaken/Knight.git
cd Knight
cp .env.example .env
```

Fill `.env` using the environment guide, then validate and start:

```bash
docker compose config >/dev/null
docker compose up -d
```

Inspect status with:

```bash
docker compose ps
docker compose logs --tail=100 bot web worker migrate
```

The dashboard defaults to port 3000. PostgreSQL and Redis are internal Compose services and are not published by the reference file. The `knight-postgres` named volume holds durable database state. The `knight-backups` named volume holds local snapshot payloads and is mounted only into `worker` at `/data/knight-backups`; neither `web` nor `bot` receives that mount.

Knight is intentionally manual-start: bot, web, and worker use `restart: "no"`, so use `docker compose up -d` when you want Knight running and `docker compose stop` when you want it stopped. After changing source or slash commands, rebuild with `docker compose up -d --build`; merely restarting the existing containers keeps the old image and old registered command build.

## Example

With `APP_URL=http://localhost:3000`, browse to that address after `web` becomes healthy. The one-shot `migrate` service should show a successful exit before bot/web/worker start.

## Security implications

`.dockerignore` excludes `.env` and `.env.*` from the image build context. Secrets are injected into containers at runtime. Keep `.env` readable only by trusted administrators and never commit it. `docker compose config` expands those values; redirect its output for validation and never paste the expanded output publicly. Docker named volumes are still host-local data: include both `knight-postgres` and `knight-backups` in your normal encrypted off-host backup process if you need recovery after host loss.

## Common mistakes

Do not start the stack before choosing strong PostgreSQL and Redis passwords. If `migrate` fails, fix that first instead of repeatedly restarting applications against an incomplete schema. Do not add the backup volume to `web` or `bot`; Recovery requests are metadata/control-plane operations and the worker is the only service that should read or write snapshot bytes.
