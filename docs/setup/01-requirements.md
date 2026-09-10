# 1. Requirements

## What and why

Knight is self-hosted so your security policy, assignments, permission snapshots, and audit decisions remain under your control. The reference deployment uses Docker Compose to run PostgreSQL, Redis, the Discord bot, dashboard, and worker together.

## How

Install Git, Docker Engine, and Docker Compose v2. You also need a Discord account that can create an application and invite a bot to the target server, authority to place Knight's Discord role above every role it will manage, and a stable public HTTPS URL for production dashboard OAuth. `http://localhost:3000` is fine for local testing.

Verify the tools:

```bash
git --version
docker --version
docker compose version
```

## Example

A small private server can run Knight on one Linux host with the dashboard at `https://knight.example.com`. PostgreSQL and Redis stay internal to the Compose network while only the dashboard port is published.

## Security implications

The host running Knight holds the Discord bot token and OAuth client secret. Treat shell access, Docker access, backups, and `.env` access as privileged. Do not expose PostgreSQL or Redis directly to the public internet.

## Common mistakes

Do not assume Discord Administrator grants Knight dashboard authority. Discord OAuth proves identity; Knight's PostgreSQL records decide authorization. Also avoid obsolete Compose implementations that do not support health-based dependency conditions.
