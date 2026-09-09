import Link from 'next/link';

export default async function GuildHome({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;

  return (
    <main className="shell">
      <Link className="backLink" href="/">
        ← All servers
      </Link>
      <section className="panel">
        <p className="eyebrow">Knight Security</p>
        <h1>Guild {guildId}</h1>
        <p className="lede">
          Your Discord identity was re-checked against Knight's current owner and Security Manager
          records before this dashboard was shown.
        </p>
        <p className="muted">
          Staff policy editing is available now. Guarded setup controls arrive in the next
          foundation tasks.
        </p>
        <Link className="inlineAction" href={`/guilds/${guildId}/staff`}>
          Manage Staff Profiles →
        </Link>
      </section>
    </main>
  );
}
