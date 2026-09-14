import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { saveLoggingSettingsAction } from './actions';

export default async function LoggingPage({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const runtime = getWebRuntime();
  const settings = await runtime.repositories.securityLedger.getLoggingSettings(guildId);
  const discord = getWebDiscordAdapter(runtime);
  const channels = discord === null ? [] : await discord.listTextChannels(guildId);
  const messageContentAvailable = runtime.env.ENABLE_MESSAGE_CONTENT_ARCHIVE;
  const categories = [
    { field: 'securityChannelId', label: 'Security destination', value: settings?.securityChannelId ?? '', examples: 'Role and channel changes, bots, webhooks, firewall, Guarded, and emergency events.' },
    { field: 'moderationChannelId', label: 'Moderation destination', value: settings?.moderationChannelId ?? '', examples: 'Warn, timeout, kick, ban, unban, purge, and attributable native moderation.' },
    { field: 'messageChannelId', label: 'Messages destination', value: settings?.messageChannelId ?? '', examples: 'Single message deletes and bulk-delete summaries.' },
    { field: 'voiceChannelId', label: 'Voice destination', value: settings?.voiceChannelId ?? '', examples: 'Join, leave, move, server mute, and server deafen changes.' },
  ] as const;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Logging</p>
          <h1>Discord notification destinations</h1>
          <p className="lede">
            The PostgreSQL Security Ledger remains authoritative. These existing channels receive
            optional operational notifications.
          </p>
        </div>
      </header>

      <section className="panel">
        <h2>Notification channels</h2>
        <p className="muted">
          Disabled is a valid choice. Knight does not create channels automatically.
        </p>
        {discord === null ? (
          <p className="notice">
            Live Discord validation is unavailable because DISCORD_TOKEN is not configured for the
            web service. You can still save all destinations as Disabled.
          </p>
        ) : null}
        <form action={saveLoggingSettingsAction} className="metadataForm loggingForm">
          <input name="guildId" type="hidden" value={guildId} />
          {categories.map((category) => (
            <label className="loggingCategory" key={category.field}>
              <span>{category.label}</span>
              <small className="muted">{category.examples}</small>
              <select defaultValue={discord === null ? '' : category.value} name={category.field}>
                <option value="">Disabled</option>
                {channels.map((channel) => <option key={channel.channelId} value={channel.channelId}>#{channel.name}</option>)}
              </select>
            </label>
          ))}
          <label className="toggleRow">
            <input defaultChecked={settings?.storeDeletedMessageContent ?? false} name="storeDeletedMessageContent" type="checkbox" value="yes" />
            <span>Retain deleted message text when Discord supplies it</span>
          </label>
          <div className={messageContentAvailable ? 'notice noticeSuccess' : 'notice'}>
            <strong>{messageContentAvailable ? 'Message Content available' : 'Message Content intent is not enabled'}</strong>
            <p>{messageContentAvailable ? 'Deleted text can be retained when the guild option is enabled.' : 'Saving retention is allowed, but logging remains metadata-only until runtime capability and the privileged Discord intent are enabled.'}</p>
          </div>
          <button type="submit">Save logging settings</button>
        </form>
      </section>
    </main>
  );
}
