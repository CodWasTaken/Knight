import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { getWebRuntime } from '../../../../lib/server-runtime';
import {
  confirmRestoreAction, queueBackupNowAction, requestRestorePreviewAction,
  retryRestoreAction, saveBackupPolicyAction,
} from './actions';

function formatDate(value: Date | null): string {
  return value === null ? '—' : value.toISOString();
}

function previewOperations(value: Record<string, unknown> | null): readonly {
  kind: string;
  classification: string;
}[] {
  if (value === null || !Array.isArray(value.operations)) return [];
  return value.operations.flatMap((operation) => {
    if (operation === null || typeof operation !== 'object') return [];
    const item = operation as Record<string, unknown>;
    if (typeof item.kind !== 'string' || typeof item.classification !== 'string') return [];
    return [{ kind: item.kind, classification: item.classification }];
  });
}

export default async function RecoveryPage({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const runtime = getWebRuntime();
  const [policy, backups, recoveryJobs] = await Promise.all([
    runtime.repositories.backups.getPolicy(guildId),
    runtime.repositories.backups.listBackups(guildId, 20),
    runtime.repositories.backups.listRecoveryJobs(guildId, 20),
  ]);
  const discord = getWebDiscordAdapter(runtime);
  const channels = discord === null ? [] : await discord.listTextChannels(guildId);
  const selected = new Set(policy?.archiveChannelIds ?? []);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Recovery</p>
          <h1>Local backup and recovery</h1>
          <p className="lede">
            Structural snapshots are stored by the worker on local durable storage. Message archives
            are optional evidence only and are never replayed during recovery.
          </p>
        </div>
      </header>
      <section className="panel">
        <h2>Backup policy</h2>
        <p className="muted">
          Current policy: <strong>{policy?.mode ?? 'Not configured'}</strong>. Daily snapshots run at
          most once per 24 hours; Manual never schedules itself.
        </p>
        {!runtime.env.ENABLE_MESSAGE_CONTENT_ARCHIVE ? (
          <p className="notice">
            Selected-channel message archival is disabled by the operator. Structural backups remain
            available without the Message Content privileged intent.
          </p>
        ) : null}
        <form action={saveBackupPolicyAction} className="metadataForm">
          <input name="guildId" type="hidden" value={guildId} />
          <label>
            <span>Schedule</span>
            <select defaultValue={policy?.mode ?? 'DISABLED'} name="mode">
              <option value="DISABLED">Disabled</option>
              <option value="MANUAL">Manual</option>
              <option value="DAILY">Daily</option>
            </select>
          </label>
          <label>
            <span>Maximum archived messages per selected channel</span>
            <input
              defaultValue={policy?.maxMessagesPerChannel ?? 1000}
              max={10000}
              min={1}
              name="maxMessagesPerChannel"
              type="number"
            />
          </label>
          <fieldset disabled={!runtime.env.ENABLE_MESSAGE_CONTENT_ARCHIVE || discord === null}>
            <legend>Selected message archive channels</legend>
            {channels.length === 0 ? (
              <p className="muted">No live guild text channels are available for selection.</p>
            ) : (
              channels.map((channel) => (
                <label key={channel.channelId}>
                  <input
                    defaultChecked={selected.has(channel.channelId)}
                    name="archiveChannelId"
                    type="checkbox"
                    value={channel.channelId}
                  />
                  <span>#{channel.name}</span>
                </label>
              ))
            )}
          </fieldset>
          <button type="submit">Save backup policy</button>
        </form>
      </section>

      <section className="panel">
        <h2>Take Backup Now</h2>
        <p className="muted">Queue one structural backup. The worker performs filesystem work asynchronously.</p>
        <form action={queueBackupNowAction}>
          <input name="guildId" type="hidden" value={guildId} />
          <button type="submit">Take Backup Now</button>
        </form>
      </section>

      <section className="panel">
        <h2>Recent backups</h2>
        {backups.length === 0 ? (
          <p className="muted">No backups have been queued yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>ID</th><th>Status</th><th>Created</th><th>Completed</th><th>Integrity</th><th>Recovery</th></tr></thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id}>
                    <td><code>{backup.id}</code></td>
                    <td>{backup.status}</td>
                    <td>{backup.createdAt.toISOString()}</td>
                    <td>{formatDate(backup.completedAt)}</td>
                    <td>{backup.sha256 === null ? '—' : <code>{backup.sha256.slice(0, 16)}…</code>}</td>
                    <td>
                      {backup.status === 'COMPLETED' && backup.sha256 !== null ? (
                        <form action={requestRestorePreviewAction}>
                          <input name="guildId" type="hidden" value={guildId} />
                          <input name="backupId" type="hidden" value={backup.id} />
                          <button type="submit">Preview restore</button>
                        </form>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Recovery jobs</h2>
        {recoveryJobs.length === 0 ? (
          <p className="muted">No recovery previews have been requested.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>ID</th><th>Backup</th><th>Phase</th><th>Status</th><th>Preview</th><th>Updated</th><th>Action</th></tr></thead>
              <tbody>
                {recoveryJobs.map((job) => (
                  <tr key={job.id}>
                    <td><code>{job.id}</code></td>
                    <td><code>{job.backupId}</code></td>
                    <td>{job.phase}</td>
                    <td>{job.status}</td>
                    <td>
                      {previewOperations(job.preview).length === 0 ? '—' : (
                        <ul>
                          {previewOperations(job.preview).map((operation, index) => (
                            <li key={`${job.id}-${index}`}>
                              <code>{operation.classification}</code> {operation.kind}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{job.updatedAt.toISOString()}</td>
                    <td>
                      {job.phase === 'PREVIEW' && job.status === 'PREVIEW_READY' ? (
                        <form action={confirmRestoreAction}>
                          <input name="guildId" type="hidden" value={guildId} />
                          <input name="jobId" type="hidden" value={job.id} />
                          <label>
                            <input name="confirmRestore" required type="checkbox" value="CONFIRM" />
                            <span>I understand recreated Discord resources receive new IDs.</span>
                          </label>
                          <button type="submit">Confirm restore (owner only)</button>
                        </form>
                      ) : job.phase === 'EXECUTION' && job.status === 'FAILED' ? (
                        <form action={retryRestoreAction}>
                          <input name="guildId" type="hidden" value={guildId} />
                          <input name="jobId" type="hidden" value={job.id} />
                          <button type="submit">Retry from checkpoint (owner only)</button>
                        </form>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
