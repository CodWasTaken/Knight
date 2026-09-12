# `/doctor` troubleshooting

## What `/doctor` checks

`/doctor` is Knight's safe, ephemeral diagnostic report for one guild. It checks Discord access, PostgreSQL, the Drizzle migration table, Redis, guild configuration, selected Discord capabilities, mapped-role hierarchy, current setup mode, and the dashboard address.

It intentionally reports only fixed status values such as `ok`, `error`, `yes`, `no`, or `needs attention`. Raw exceptions, bot/OAuth tokens, passwords, database URLs, Redis URLs, and credential-bearing URLs are not included.

## How to read it

- **Discord: error** — Knight could not read live guild state. Confirm the bot is connected and still belongs to the server.
- **Database: error** — verify PostgreSQL health and the service's `DATABASE_URL` without pasting the URL into chat.
- **Migrations: error** — run Knight's migration step before applications start serving traffic.
- **Redis: error** — verify Redis health and that Knight's configured credentials match the server.
- **View Audit Log: no** — audit-dependent diagnostics are unavailable.
- **Ban Members: no** — native ban capability is unavailable where still required by the current operating mode.
- **Manage Roles: no** — Knight cannot safely synchronize mapped roles or run Guarded migration/rollback.
- **Role hierarchy: needs attention** — move Knight above every mapped Staff Profile role and verify mapped roles still exist.
- **Guild: unavailable** — complete Knight's initial guild ownership/configuration state.

Discord Administrator on a human account does not grant Knight dashboard access, Security Manager authority, or Staff Profile permissions.

## Docker checks

Useful non-secret checks are:

```bash
docker compose config
docker compose ps
docker compose logs --tail=100 postgres redis migrate bot web worker
```

A healthy Test-mode report should show Discord, Database, Migrations, and Redis as `ok`, required capability lines as `yes`, role hierarchy as healthy, `Setup mode: TEST`, and a dashboard URL ending in `/guilds/<guild-id>`.

`/doctor` is a service/Discord diagnostic, not the complete setup-readiness workflow. `/setup` additionally checks the current Staff/Profile policy state, explicit Logging choice, saved firewall choice, explicit backup policy, and the final Observe readiness summary. A healthy `/doctor` can therefore coexist with a blocked setup step.

`/doctor` also does not read backup snapshot files. Use the **Recovery** page to confirm a completed backup has integrity metadata and generate a hash-verified restore preview. See [Local backups and recovery](../backups/local-backups-and-recovery.md).

## When moderation is denied

`/doctor` being healthy does not mean every moderation request is authorized. Knight can still deny an action because the Staff Profile lacks the explicit permission, the action is disabled, a rate window is exhausted, the target is the guild owner, the target is equal/higher Knight rank, or an elevated unregistered target fails closed.

Warning-history lookup is the deliberate read-only exception: it still requires owner authority or `member.warnings.view`, but it does not compare target rank and does not consume a rate budget.

## Security implications

Do not paste `.env`, full service URLs, or raw exception output into support chats. Share `/doctor`'s fixed diagnostic output instead. If a credential is disclosed, rotate it rather than relying on message deletion.
