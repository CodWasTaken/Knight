# Disaster recovery

Knight's local snapshot volume protects against supported Discord structural loss; it is not, by itself, protection against losing the Docker host.

## What must be protected off-host

For off-machine recovery, include both of these in your normal encrypted host/volume backup system:

- PostgreSQL / the `knight-postgres` volume, which contains authority, configuration, ledger history, backup metadata, and recovery checkpoints.
- The `knight-backups` volume, which contains the gzip snapshot payloads referenced by PostgreSQL.

Redis is operational/ephemeral state and does not need to be restored as durable Knight authority.

Keep `.env` and secret material in your normal secret-management process rather than embedding plaintext credentials in backup documentation or tickets.

## Why both durable stores matter

If PostgreSQL survives but `knight-backups` is lost, the dashboard can still show backup metadata but recovery cannot read/verify the missing snapshot files.

If snapshot files survive but PostgreSQL is lost, Knight has no authoritative backup/job records through which the normal dashboard recovery workflow can discover and validate them.

Back up PostgreSQL and the backup volume on a schedule that gives you an acceptable recovery point, and test restoration to a disposable environment.

## Host-loss runbook

1. Provision a replacement host with the same Knight release/configuration you intend to recover.
2. Restore PostgreSQL and the `knight-backups` volume from your trusted off-host backup before exposing the services to normal users.
3. Restore required secrets through your secret-management process; do not copy credentials into documentation or chat.
4. Run `docker compose config` and verify that only `worker` mounts `knight-backups:/data/knight-backups`.
5. Start the stack and require the migration job to exit successfully, PostgreSQL/Redis/web health to become healthy, and bot/web/worker to remain running without restart loops.
6. Check `/api/health/live`, `/api/health/ready`, and `/doctor`.
7. Open **Recovery** and verify that a known completed backup still has its expected SHA-256 metadata.
8. Generate a restore preview before considering any Discord mutation. Preview is safe and performs no restore writes.
9. Use the owner-confirmed restore workflow only after reviewing recreated-resource IDs and `NOT_RECOVERABLE` items.

## Partial recovery and integrity failures

Do not bypass a SHA-256 mismatch. Treat it as damaged, replaced, or inconsistent backup bytes and recover a different known-good copy.

If a restore execution fails after making some changes, do not manually mark it complete. The job's checkpoint records completed operations and old-to-new ID mappings; investigate the failure and use owner-only Retry so execution resumes from the saved checkpoint.

A recreated role/channel has a new Discord ID. External systems outside Knight that stored the old ID may need separate repair even when Knight's own references were remapped successfully.

## Routine exercise

Periodically test backup creation, integrity verification, and restore preview using a disposable/test guild resource. Do not use destructive Panic/firewall/restore mutations against production resources merely to prove the runbook.
