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
docker compose config
docker compose up -d
```

Inspect status with:

```bash
docker compose ps
docker compose logs --tail=100 bot web worker migrate
```

The dashboard defaults to port 3000. PostgreSQL and Redis are internal Compose services and are not published by the reference file.

## Example

With `APP_URL=http://localhost:3000`, browse to that address after `web` becomes healthy. The one-shot `migrate` service should show a successful exit before bot/web/worker start.

## Security implications

`.dockerignore` excludes `.env` and `.env.*` from the image build context. Secrets are injected into containers at runtime. Keep `.env` readable only by trusted administrators and never commit it.

## Common mistakes

Do not start the stack before choosing strong PostgreSQL and Redis passwords. If `migrate` fails, fix that first instead of repeatedly restarting applications against an incomplete schema.
