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
            web service. You can still save both destinations as Disabled.
          </p>
        ) : null}
        <form action={saveLoggingSettingsAction} className="metadataForm loggingForm">
          <input name="guildId" type="hidden" value={guildId} />
          <label>
            <span>Security destination</span>
            <select
              defaultValue={discord === null ? '' : (settings?.securityChannelId ?? '')}
              name="securityChannelId"
            >
              <option value="">Disabled</option>
              {channels.map((channel) => (
                <option key={channel.channelId} value={channel.channelId}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Moderation destination</span>
            <select
              defaultValue={discord === null ? '' : (settings?.moderationChannelId ?? '')}
              name="moderationChannelId"
            >
              <option value="">Disabled</option>
              {channels.map((channel) => (
                <option key={channel.channelId} value={channel.channelId}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Save logging settings</button>
        </form>
      </section>
    </main>
  );
}
