# `/doctor` troubleshooting

## What and why

`/doctor` is Knight's safe, ephemeral diagnostic report for one guild. It checks Discord access, PostgreSQL, the Drizzle migration table, Redis, guild configuration, key Discord capabilities, mapped-role hierarchy, current setup mode, and the dashboard address.

It intentionally reports only fixed state such as `ok`, `error`, `yes`, `no`, or `needs attention`. Raw exceptions, database URLs, Redis URLs, tokens, passwords, and URL credentials are not included.

## How to read it

- **Discord: error** — Knight could not read the guild state. Confirm the bot is connected and still in the server.
- **Database: error** — verify PostgreSQL is healthy and `DATABASE_URL` is correct in the service environment.
- **Migrations: error** — run the migration service/command before restarting applications.
- **Redis: error** — verify Redis is healthy and the password/URL used by Knight matches the server.
- **View Audit Log / Ban Members / Manage Roles: no** — grant only the capability needed by the feature you are enabling.
- **Role hierarchy: needs attention** — move Knight above mapped staff roles and verify no mapped role was deleted.
- **Guild: unavailable** — complete the initial Knight guild setup/ownership registration.

For Docker, useful commands are:

```bash
docker compose ps
docker compose logs --tail=100 postgres redis migrate bot web worker
```

## Example

A healthy Test-mode report should show Discord, Database, Migrations, and Redis as `ok`, required capability lines as `yes`, role hierarchy as `healthy`, `Setup mode: TEST`, and a dashboard URL ending in `/guilds/<guild-id>`.

## Security implications

Do not paste `.env` or full service URLs into support chats to explain a `/doctor` failure. Share the fixed diagnostic output instead. If you accidentally disclose a token or password, rotate the credential rather than relying on deletion of the message.

## Common mistakes

A healthy TCP connection is not enough if migrations were never applied. A Discord role can also have Manage Roles while still being below the role it needs to manage. Finally, Discord Administrator on a human account does not grant Knight dashboard or Security Manager authority.
