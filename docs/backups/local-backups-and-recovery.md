# Local backups and recovery

## Backup policy

Each guild has one explicit backup mode:

- `DISABLED`: no scheduled snapshots; this is still a valid configured setup choice.
- `MANUAL`: snapshots run only when an authorized user selects **Take Backup Now** or uses `/backup create`.
- `DAILY`: the worker schedules a snapshot when the guild has no pending/running job and no completed snapshot from the previous 24 hours.

Backup work is queued in PostgreSQL and performed by the worker. Dashboard and slash-command requests do not write backup files inline.

## Snapshot storage and integrity

PostgreSQL stores backup status, relative file path, SHA-256, timestamps, and errors. The snapshot itself is canonicalized JSON compressed with gzip and written beneath `${KNIGHT_BACKUP_DIR}/${guildId}/${backupId}.json.gz`.

The worker writes a temporary file in the destination directory and atomically renames it to the final snapshot path. SHA-256 is calculated over the final compressed bytes. Restore reads verify that hash before using the payload; tampered or mismatched bytes fail the integrity check.

In Docker Compose, `KNIGHT_BACKUP_DIR=/data/knight-backups` and the `knight-backups` named volume is mounted only into the worker.

## Structural scope

Snapshots cover the supported Discord structure Knight can safely reason about: roles and role order, categories and text channels, parent/position relationships, permission overwrites, and Knight references to Staff Profile roles, all four logging channels, and protected resources. Older version-1 snapshots with only Security/Moderation logging references remain readable; missing Messages/Voice references normalize to Disabled.

Managed Discord roles are reference-only. Knight never claims it can recreate an integration-managed role. Unsupported channel types are not treated as recoverable structural resources.

Selected-channel message archives are optional evidence. They are not structural restore input and are always classified `ARCHIVE_ONLY`.

## Restore preview

Recovery is preview-first. An owner or Knight Security Manager may request a preview from a completed backup. The worker verifies the backup hash, captures current Discord structure, and classifies planned operations as:

- `REVERT`: a supported surviving resource differs from the snapshot.
- `RECREATE`: a supported non-managed resource is missing and can be recreated.
- `ARCHIVE_ONLY`: retained evidence that will not be replayed.
- `NOT_RECOVERABLE`: a reference such as a missing managed role that Knight must not recreate.

No Discord write occurs while generating the preview.

## Confirmation and execution

Actual restore execution is guild-owner-only and requires the explicit confirmation checkbox in the Recovery page. Security Managers cannot confirm or retry execution.

Operations run sequentially in dependency order: roles, role ordering, categories, channels, channel parent/order, permission overwrites, then Knight reference remaps. Every Discord write includes the recovery job ID in its audit reason.

Recreated Discord resources receive new Discord IDs. Knight does not claim ID preservation. The durable recovery checkpoint stores old-to-new role/channel mappings so parent relationships, permission overwrites, logging references, protected-resource references, and Staff Profile mappings can follow recreated resources safely.

When a Staff Profile's mapped Discord role is recreated, Knight creates a new immutable Staff Profile version pointing at the new role ID. Earlier profile versions remain unchanged.

Archived messages are never replayed, and managed roles are never recreated.

## Failure, retry, and concurrency

The worker checkpoints after each completed restore operation. A failed operation stops execution immediately, records the error, and preserves the last completed checkpoint. Owner-only **Retry** resumes from that durable checkpoint rather than starting completed stages again.

A Redis lock named for the guild prevents backup, recovery, and Factory Reset execution from running concurrently. PostgreSQL remains the durable job/checkpoint authority if Redis restarts. Pending/running Factory Reset blocks new backup/restore queue, confirm, and retry transitions.

Factory Reset is a separate owner-only, worker-executed operation. It removes the guild's Knight backup files and Knight database state, but never changes Discord structure. It is refused while Guarded, Panic, configuration-blocking Lockdown, backup/recovery work, or another reset is active.

## Operator workflow

1. Save a backup policy on **Recovery**. `DISABLED` is acceptable if you intentionally do not want automatic snapshots.
2. Queue **Take Backup Now** and wait for `COMPLETED` with an integrity hash.
3. Select **Preview restore** for the completed backup and inspect every `REVERT`, `RECREATE`, `ARCHIVE_ONLY`, and `NOT_RECOVERABLE` item.
4. Resolve hierarchy/manageability concerns before execution.
5. The guild owner checks the explicit confirmation box and queues execution.
6. Watch the durable recovery-job status. If it fails, investigate the recorded error before using owner-only **Retry**.
7. After completion, verify Staff Profile mappings, logging destinations, protected resources, channel hierarchy, and permission overwrites.

For host-loss planning, see [Disaster recovery](disaster-recovery.md) and [Data residency](../security/data-residency.md).
