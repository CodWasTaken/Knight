import Link from 'next/link';
import { getWebRuntime } from '../../../../lib/server-runtime';
import {
  activateLockdownAction,
  activatePanicAction,
  clearLockdownAction,
  clearPanicAction,
  saveFirewallSettingsAction,
  saveInventoryTrustAction,
} from './actions';
import { actionNotice } from '../../../../lib/action-feedback';

const MODES = ['OBSERVE', 'ALERT', 'ENFORCE'] as const;
const TRUST_STATES = ['TRUSTED', 'APPROVED', 'UNKNOWN', 'BLOCKED'] as const;
const LOCKDOWN_SCOPES = [
  ['MEMBER_MODERATION', 'Member moderation'],
  ['ROLES', 'Roles'],
  ['CHANNELS', 'Channels'],
  ['BOTS_WEBHOOKS', 'Bots and webhooks'],
  ['SECURITY_CONFIG', 'Security configuration'],
  ['FULL', 'Full'],
] as const;

export default async function SecurityPage({
  params,
  searchParams = Promise.resolve({}),
}: Readonly<{ params: Promise<{ guildId: string }>; searchParams?: Promise<{ notice?: string | string[] }> }>) {
  const [{ guildId }, query] = await Promise.all([params, searchParams]);
  const security = getWebRuntime().repositories.security;
  const [emergency, settings, incidents, bots, webhooks] = await Promise.all([
    security.getSecurityState(guildId),
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
      {actionNotice(query.notice) ? <div className="notice" role="status">{actionNotice(query.notice)}</div> : null}
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
        <h2>Emergency state</h2>
        <p>
          <strong>{emergency.mode}</strong> · Scopes:{' '}
          {emergency.lockedScopes.length === 0 ? 'none' : emergency.lockedScopes.join(', ')}
        </p>
        <p className="muted">{emergency.reason ?? 'No emergency state has been set.'}</p>
        <div className="previewTable">
          <form action={activateLockdownAction} className="previewRow">
            <input name="guildId" type="hidden" value={guildId} />
            <label>
              <span>Lockdown scope</span>
              <select name="scope" required>
                {LOCKDOWN_SCOPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Reason</span>
              <input name="reason" required type="text" />
            </label>
            <button type="submit">Enable Lockdown</button>
          </form>
          <form action={clearLockdownAction} className="previewRow">
            <input name="guildId" type="hidden" value={guildId} />
            <label>
              <span>Reason</span>
              <input name="reason" required type="text" />
            </label>
            <button className="secondary" type="submit">Clear Lockdown</button>
          </form>
          <form action={activatePanicAction} className="previewRow">
            <input name="guildId" type="hidden" value={guildId} />
            <label>
              <span>Reason</span>
              <input name="reason" required type="text" />
            </label>
            <label>
              <input name="confirm" required type="checkbox" />
              <span>Confirm Panic</span>
            </label>
            <button className="danger" type="submit">Activate Panic</button>
          </form>
          <form action={clearPanicAction} className="previewRow">
            <input name="guildId" type="hidden" value={guildId} />
            <label>
              <span>Reason</span>
              <input name="reason" required type="text" />
            </label>
            <button className="secondary" type="submit">Clear Panic</button>
          </form>
        </div>
      </section>

      <section className="panel">
        <h2>Firewall modes</h2>
        <p className="muted">
          Observe records activity only. Alert records and notifies. Enforce removes entries marked
          Blocked; unknown bots and webhooks are never removed automatically.
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
