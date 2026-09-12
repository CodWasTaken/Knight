# 4. Configure the environment

## What and why

Knight validates runtime configuration before starting. The environment connects the Discord bot, OAuth dashboard, PostgreSQL, Redis, and worker without baking credentials into the image.

## How

Copy `.env.example` to `.env` and replace every secret placeholder. The important fields are:

```dotenv
DISCORD_TOKEN=replace-with-bot-token
DISCORD_CLIENT_ID=replace-with-application-id
DISCORD_CLIENT_SECRET=replace-with-oauth-secret
AUTH_SECRET=replace-with-at-least-32-random-characters
APP_URL=https://knight.example.com
POSTGRES_PASSWORD=replace-with-a-long-random-password
REDIS_PASSWORD=replace-with-a-long-random-password
KNIGHT_BACKUP_DIR=/data/knight-backups
ENABLE_MESSAGE_CONTENT_ARCHIVE=false
```

When running the Node processes directly instead of Compose, also set `DATABASE_URL` and `REDIS_URL` for the host ports you use. `KNIGHT_BACKUP_DIR` is consumed by the worker; in the reference Compose deployment it points at `/data/knight-backups`, backed by the worker-only `knight-backups` named volume.

Leave `ENABLE_MESSAGE_CONTENT_ARCHIVE=false` unless you intentionally want selected-channel message evidence in snapshots. Enabling it requires the privileged Message Content intent in the Discord Developer Portal, and archive channels still must be selected explicitly in Recovery. Archived messages are evidence only and are never replayed during restore.

A suitable Auth.js secret can be generated with a cryptographically secure password generator or `openssl rand -base64 48`. For `POSTGRES_PASSWORD` and `REDIS_PASSWORD`, prefer URL-safe random values because Compose inserts them into connection URLs; `openssl rand -hex 32` is a safe example for each.

## Example

If your dashboard is `https://knight.example.com`, set `APP_URL` to that exact origin and configure Discord's redirect as `https://knight.example.com/api/auth/callback/discord`.

## Security implications

Database and Redis URLs may themselves contain credentials. Knight's `/doctor` and health endpoints report only component state and intentionally never echo connection strings or underlying exceptions. The web and bot services do not need filesystem access to backup payloads; only the worker should mount the backup volume. For host-loss recovery, protect both PostgreSQL and the backup volume with your normal encrypted off-host backup process.

## Common mistakes

Do not leave `AUTH_SECRET` shorter than 32 characters. Make sure `APP_URL` matches Discord OAuth exactly. Never use the example passwords on an internet-accessible deployment, and never commit the completed `.env` file.
