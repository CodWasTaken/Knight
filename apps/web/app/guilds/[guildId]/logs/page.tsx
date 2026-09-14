import type {
  SecurityLedgerFilters,
  SecurityLedgerSeverity,
} from '@knight/database/repositories/security-ledger-repository';
import { getWebRuntime } from '../../../../lib/server-runtime';

type SearchParams = Record<string, string | string[] | undefined>;

const SEVERITIES: readonly SecurityLedgerSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const ACTION_LABELS: Readonly<Record<string, string>> = {
  'member.warn': 'Member warned', 'member.ban': 'Member banned',
  'message.delete': 'Message deleted', 'message.bulk_delete': 'Messages bulk deleted',
  'voice.move': 'Voice channel move', 'guarded.enable': 'Guarded Moderation enabled',
};

function category(action: string): string {
  if (action.startsWith('message.')) return 'messages';
  if (action.startsWith('voice.')) return 'voice';
  if (action.startsWith('member.')) return 'moderation';
  return 'security';
}

function queryValue(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

function ledgerFilters(searchParams: SearchParams): SecurityLedgerFilters {
  const source = queryValue(searchParams, 'source');
  const action = queryValue(searchParams, 'action');
  const severity = queryValue(searchParams, 'severity');
  const actorUserId = queryValue(searchParams, 'actor');
  const targetId = queryValue(searchParams, 'target');
  const filters: SecurityLedgerFilters = { limit: 100 };
  if (source !== undefined) Object.assign(filters, { source });
  if (action !== undefined) Object.assign(filters, { action });
  if (SEVERITIES.includes(severity as SecurityLedgerSeverity)) {
    Object.assign(filters, { severity: severity as SecurityLedgerSeverity });
  }
  if (actorUserId !== undefined) Object.assign(filters, { actorUserId });
  if (targetId !== undefined) Object.assign(filters, { targetId });
  return filters;
}

export default async function LogsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<SearchParams>;
}>) {
  const [{ guildId }, query] = await Promise.all([params, searchParams]);
  const entries = await getWebRuntime().repositories.securityLedger.listRecent(
    guildId,
    ledgerFilters(query),
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Logs</p>
          <h1>Security Ledger</h1>
          <p className="lede">The latest 100 durable entries for this guild.</p>
        </div>
      </header>

      <section className="panel">
        <h2>Filters</h2>
        <form className="metadataForm logFilters" method="get">
          <label>
            <span>Source</span>
            <input defaultValue={queryValue(query, 'source')} name="source" type="text" />
          </label>
          <label>
            <span>Action</span>
            <input defaultValue={queryValue(query, 'action')} name="action" type="text" />
          </label>
          <label>
            <span>Severity</span>
            <select defaultValue={queryValue(query, 'severity') ?? ''} name="severity">
              <option value="">All severities</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Actor</span>
            <input defaultValue={queryValue(query, 'actor')} name="actor" type="text" />
          </label>
          <label>
            <span>Target</span>
            <input defaultValue={queryValue(query, 'target')} name="target" type="text" />
          </label>
          <button type="submit">Apply filters</button>
        </form>
      </section>

      <section className="panel ledgerPanel">
        <h2>Recent entries</h2>
        {entries.length === 0 ? (
          <p className="muted">No ledger entries match these filters.</p>
        ) : (
          <div className="ledgerTableWrap">
            <table className="ledgerTable">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Severity</th>
                  <th>Source</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <time dateTime={entry.createdAt.toISOString()}>
                        {entry.createdAt.toISOString()}
                      </time>
                    </td>
                    <td><span className={`badge severity-${entry.severity.toLowerCase()}`}>{entry.severity}</span></td>
                    <td><span className={`badge category-${category(entry.action)}`}>{category(entry.action)}</span> {entry.source}</td>
                    <td><strong>{ACTION_LABELS[entry.action] ?? entry.action}</strong><br /><code>{entry.action}</code></td>
                    <td>{entry.actorUserId ? `User ${entry.actorUserId}` : 'Unknown actor'}</td>
                    <td>{entry.targetId ? `Target ${entry.targetId}` : 'No target'}</td>
                    <td>
                      <details>
                        <summary>Structured metadata</summary>
                        <dl><dt>Decision</dt><dd>{entry.decisionId ?? '—'}</dd><dt>Incident</dt><dd>{entry.incidentId ?? '—'}</dd></dl>
                        <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>
                      </details>
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
