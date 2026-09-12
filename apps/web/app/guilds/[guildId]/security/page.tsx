import Link from 'next/link';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { saveFirewallSettingsAction, saveInventoryTrustAction } from './actions';

const MODES = ['OBSERVE', 'ALERT', 'ENFORCE'] as const;
const TRUST_STATES = ['TRUSTED', 'APPROVED', 'UNKNOWN', 'BLOCKED'] as const;

export default async function SecurityPage({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const security = getWebRuntime().repositories.security;
  const [settings, incidents, bots, webhooks] = await Promise.all([
    security.getFirewallSettings(guildId),
    security.listActiveIncidents(guildId),
    security.listBotInventory(guildId),
    security.listWebhookInventory(guildId),
  ]);

  const inventory = [
    ...bots.map((bot) => ({
      type: 'BOT' as const,
      id: bot.botUserId,
      channelId: null,
      trustState: bot.trustState,
      lastSeenAt: bot.lastSeenAt,
    })),
    ...webhooks.map((webhook) => ({
      type: 'WEBHOOK' as const,
      id: webhook.webhookId,
      channelId: webhook.channelId,
      trustState: webhook.trustState,
      lastSeenAt: webhook.lastSeenAt,
    })),
  ];

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Security</p>
          <h1>Native protection</h1>
          <p className="lede">
            Observe records activity, Alert adds notifications, and Enforce removes only entries you
            explicitly mark Blocked.
          </p>
        </div>
        <Link href={`/guilds/${guildId}/security/protected`}>Protected resources</Link>
      </header>

      <section className="panel">
        <h2>Firewall modes</h2>
        <p className="muted">
          Unknown bots and webhooks are never removed automatically, including in Enforce.
        </p>
        <form action={saveFirewallSettingsAction} className="metadataForm loggingForm">
          <input name="guildId" type="hidden" value={guildId} />
          <label>
            <span>Bot firewall</span>
            <select defaultValue={settings.botMode} name="botMode">
              {MODES.map((mode) => (
                <option key={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Webhook firewall</span>
            <select defaultValue={settings.webhookMode} name="webhookMode">
              {MODES.map((mode) => (
                <option key={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <button type="submit">Save firewall modes</button>
        </form>
        {!settings.configured ? (
          <p className="notice">
            Save once to complete the Protection setup step. Observe is valid.
          </p>
        ) : null}
      </section>

      <section className="panel">
        <h2>Active incidents</h2>
        {incidents.length === 0 ? (
          <p className="muted">No active incidents.</p>
        ) : (
          <ul className="memberList">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <span>
                  <strong>{incident.severity}</strong> · {incident.summary}
                </span>
                <span className="muted small">
                  {incident.eventCount} event{incident.eventCount === 1 ? '' : 's'} ·{' '}
                  {incident.lastSeenAt.toISOString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Bot and webhook inventory</h2>
        {inventory.length === 0 ? (
          <p className="muted">Knight has not observed any bots or webhooks yet.</p>
        ) : (
          <div className="previewTable" role="table" aria-label="Firewall inventory">
            {inventory.map((item) => (
              <form
                action={saveInventoryTrustAction}
                className="previewRow"
                key={`${item.type}:${item.id}`}
              >
                <input name="guildId" type="hidden" value={guildId} />
                <input name="inventoryType" type="hidden" value={item.type} />
                <input name="resourceId" type="hidden" value={item.id} />
                <div>
                  <strong>{item.type}</strong>
                  <p className="muted small">{item.id}</p>
                </div>
                <div>
                  <span className="muted small">Channel</span>
                  <span>{item.channelId ?? '—'}</span>
                </div>
                <label>
                  <span className="muted small">Trust</span>
                  <select defaultValue={item.trustState} name="trustState">
                    {TRUST_STATES.map((state) => (
                      <option key={state}>{state}</option>
                    ))}
                  </select>
                </label>
                <button className="secondary" type="submit">
                  Save
                </button>
              </form>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
