import type { SecurityLedgerFilters, SecurityLedgerSeverity } from '@knight/database';
import { getWebRuntime } from '../../../../lib/server-runtime';

type SearchParams = Record<string, string | string[] | undefined>;

const SEVERITIES: readonly SecurityLedgerSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

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
                  <th>Decision</th>
                  <th>Incident</th>
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
                    <td>{entry.severity}</td>
                    <td>{entry.source}</td>
                    <td>{entry.action}</td>
                    <td>{entry.actorUserId ?? '—'}</td>
                    <td>{entry.targetId ?? '—'}</td>
                    <td>{entry.decisionId ?? '—'}</td>
                    <td>{entry.incidentId ?? '—'}</td>
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
