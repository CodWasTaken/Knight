# Data residency and local trust boundary

Knight's reference deployment is intentionally local-first. It does not require a hosted queue, hosted object store, or third-party backup service.

## Where data lives

PostgreSQL is the durable authority for guild ownership, setup state, Staff Profiles and immutable versions, assignments, policy decisions, warnings, Security Ledger entries, protection/firewall state, backup metadata, and recovery job/checkpoint metadata. Docker stores PostgreSQL data in the `knight-postgres` named volume.

Backup payload bytes are gzip JSON files in `KNIGHT_BACKUP_DIR`. In the Docker reference deployment that path is `/data/knight-backups`, backed by the `knight-backups` named volume.

Redis stores operational rate state, short-lived correlations, and recovery locks. It is not the durable source of truth and is not part of the backup/recovery payload.

Discord OAuth/account credentials stored for Auth.js remain server-side in PostgreSQL. Never expose database dumps, `.env`, OAuth secrets, bot tokens, or Redis credentials to the browser or support chats.

## Backup-volume isolation

Only the worker service mounts `knight-backups`. The web dashboard and bot read backup metadata from PostgreSQL and do not require direct filesystem access to snapshot files.

This boundary limits accidental exposure through the web or bot containers, but it does not protect against a host administrator or another process with Docker/volume access. Treat the Docker host and its volume backups as security-sensitive infrastructure.

## Optional message content

Message archival is off by default. It is enabled only when `ENABLE_MESSAGE_CONTENT_ARCHIVE=true`, selected text channels are configured, and Discord's privileged Message Content intent is enabled for the application.

When enabled, only the selected channels are archived, with a configured per-channel cap from 1 to 10,000 messages; the default is 1,000. Archived messages are evidence in the local snapshot. They are never replayed into Discord during recovery.

## Retention and off-host copies

Knight does not automatically copy the local backup volume off the machine and does not currently impose an automatic snapshot-retention/pruning policy. If you need recovery after host loss, include both PostgreSQL and `knight-backups` in your normal encrypted host/volume backup process. See [Disaster recovery](../backups/disaster-recovery.md).
