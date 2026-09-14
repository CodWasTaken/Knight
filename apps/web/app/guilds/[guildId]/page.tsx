import Link from 'next/link';
import { getWebDiscordAdapter } from '../../../lib/discord-runtime';
import { getWebRuntime } from '../../../lib/server-runtime';

export default async function GuildHome({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const runtime = getWebRuntime();
  const [guild, setup, logging, policy, backups, emergency, profiles] = await Promise.all([
    runtime.repositories.guilds.get(guildId),
    runtime.repositories.guilds.getSetupState(guildId),
    runtime.repositories.securityLedger.getLoggingSettings(guildId),
    runtime.repositories.backups.getPolicy(guildId),
    runtime.repositories.backups.listBackups(guildId, 1),
    runtime.repositories.security.getSecurityState(guildId),
    runtime.repositories.staff.listProfiles(guildId),
  ]);
  const discord = getWebDiscordAdapter(runtime);
  let serverName = 'Discord server';
  if (discord) {
    try {
      serverName = (await discord.getGuildIdentity(guildId)).name;
    } catch {
      // The guild ID remains available in Advanced details.
    }
  }
  const destinations = [
    ['Security', logging?.securityChannelId],
    ['Moderation', logging?.moderationChannelId],
    ['Messages', logging?.messageChannelId],
    ['Voice', logging?.voiceChannelId],
  ] as const;
  const setupComplete = setup?.step === 'COMPLETE';

  return (
    <main className="shell">
      <header className="topbar"><div><p className="eyebrow">Operations console</p><h1>{serverName}</h1><p className="lede">Knight status, blockers, and the next recommended action.</p></div><span className={`mode mode-${guild?.mode.toLowerCase()}`}>{guild?.mode ?? 'OBSERVE'}</span></header>
      <section className="detailGrid">
        <section className="panel"><h2>Setup progress</h2><p>{setup?.completedSteps.length ?? 0} steps complete · current: {setup?.step ?? 'WELCOME'}</p><Link href={`/guilds/${guildId}/setup`}>{setupComplete ? 'Review setup' : 'Continue setup'}</Link></section>
        <section className="panel"><h2>Logging destinations</h2><ul>{destinations.map(([label, id]) => <li key={label}><strong>{label}</strong>: {id ? 'Configured' : 'Disabled'}</li>)}</ul><Link href={`/guilds/${guildId}/logging`}>Configure logging</Link></section>
        <section className="panel"><h2>Backups</h2><p>Policy: {policy?.mode ?? 'Not configured'}</p><p>Latest backup: {backups[0]?.status ?? 'None'}</p><Link href={`/guilds/${guildId}/recovery`}>Open Recovery</Link></section>
        <section className="panel"><h2>Emergency state</h2><p>{emergency.mode}</p><Link href={`/guilds/${guildId}/security`}>Open Security</Link></section>
        <section className="panel"><h2>Staff Profiles</h2><p>{profiles.length} configured</p><Link href={`/guilds/${guildId}/staff`}>Manage Staff Profiles</Link></section>
        <section className="panel"><h2>Current blockers</h2><p>{setupComplete ? 'No setup blocker.' : `Complete ${setup?.step ?? 'WELCOME'} before entering Test mode.`}</p><strong>Next action</strong><p><Link className="inlineAction" href={`/guilds/${guildId}/${setupComplete ? 'logging' : 'setup'}`}>{setupComplete ? 'Review logging' : 'Continue setup'} →</Link></p></section>
      </section>
      <details className="panel advancedDetails"><summary>Advanced</summary><p className="muted">Guild ID: {guildId}</p></details>
    </main>
  );
}
