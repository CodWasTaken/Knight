import Link from 'next/link';

export default async function GuildHome({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Knight Security</p>
        <h1>Guild {guildId}</h1>
        <p className="lede">
          Your Discord identity was re-checked against Knight's current owner and Security Manager
          records before this dashboard was shown.
        </p>
        <p className="muted">
          Staff policy editing and the persistent Observe → Test → Guarded setup workflow are
          available from this dashboard.
        </p>
        <Link className="inlineAction" href={`/guilds/${guildId}/staff`}>
          Manage Staff Profiles →
        </Link>
        <br />
        <Link className="inlineAction" href={`/guilds/${guildId}/setup`}>
          Continue security setup →
        </Link>
      </section>
    </main>
  );
}
