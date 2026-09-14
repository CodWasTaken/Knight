# Logging and protection

## Security Ledger and notifications

Knight's Security Ledger is durable PostgreSQL state. Ledger entries are hash-chained per guild so later verification can detect history that no longer matches the recorded chain.

The **Logging** page configures four independent optional Discord notification destinations. Each may be **Disabled**, and multiple categories may intentionally share a channel:

- **Security:** role/channel security changes, bots, webhooks, firewall, Guarded, emergency, and protection events.
- **Moderation:** Knight warn/timeout/kick/ban/unban/purge plus attributable native bans and unbans.
- **Messages:** single and bulk message deletions.
- **Voice:** joins, leaves, moves, and server mute/unmute/deafen/undeafen changes.

A disabled notification channel does not disable the PostgreSQL ledger. Bulk deletion produces detailed per-message ledger entries and one safe summary notification.

## Deleted-message content

Deletion metadata is recorded when available even when message text is unavailable. Content is retained only when the guild enables **Store deleted message content**, the operator sets `ENABLE_MESSAGE_CONTENT_ARCHIVE=true`, Discord's privileged **Message Content Intent** is enabled, and Discord actually supplied or cached the content. Retained content is capped at 4,000 UTF-16 code units. Knight explicitly records unavailable content and never invents a deleter when strict audit-log attribution does not match.

In the Discord Developer Portal, open the Knight application, choose **Bot**, scroll to **Privileged Gateway Intents**, enable **Message Content Intent**, save, set `ENABLE_MESSAGE_CONTENT_ARCHIVE=true` in `.env`, and rebuild with `docker compose up -d --build`. Leaving the capability disabled keeps message logging metadata-only.

Notification delivery is best effort. A Discord send failure does not erase the durable security record or make the underlying security operation look rolled back.

## Protected resources

The **Protected** page can assign `IMPORTANT`, `CRITICAL`, or `IMMUTABLE` to specific users, roles, or channels. Unlisted resources are `NORMAL`.

Protection participates in Knight policy decisions and native-change incident severity. `IMMUTABLE` targets deny ordinary non-owner staff changes; `CRITICAL` and `IMMUTABLE` produce approval-required policy outcomes where that action path supports approval. Protection does not silently rewrite Discord permissions.

Use protection sparingly for resources where stronger target handling is intentional. The guild owner remains Knight's ultimate authority, subject to the explicit safety workflow of the action being performed.

## Bot and webhook firewall modes

Bot and webhook firewalls are configured independently with exactly three modes:

- `OBSERVE`: inventory what Knight sees; do not alert or remove it.
- `ALERT`: inventory and record/notify on observations; do not remove them.
- `ENFORCE`: do the Alert behavior and remove only inventory entries explicitly marked `BLOCKED`.

`UNKNOWN`, `TRUSTED`, and `APPROVED` entries are not removed merely because Enforce is enabled. This makes Enforce an explicit deny-list control rather than an automatic purge of unfamiliar integrations.

## Emergency state

Lockdown and Panic take precedence over ordinary configuration and mutation flows. Panic requires explicit confirmation and freezes privileged Knight mutations; it does not strip server roles or perform a destructive reset. See [Lockdown and Panic](lockdown-and-panic.md).

## Setup readiness

The setup wizard requires an explicit saved Logging choice and an explicit saved firewall choice. Saving all four logging destinations as Disabled is valid. Saving both firewall modes as Observe is valid. Protected resources are optional.
