import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '../../../auth';
import { GuildAuthorizationError, requireGuildAccess } from '../../../lib/authorization';

export default async function GuildLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ guildId: string }>;
}>) {
  const { guildId } = await params;
  const session = await auth();

  try {
    await requireGuildAccess(guildId, session);
  } catch (error) {
    if (error instanceof GuildAuthorizationError) {
      if (error.code === 'UNAUTHENTICATED') redirect('/');
      if (error.code === 'GUILD_ACCESS_DENIED' || error.code === 'GUILD_NOT_CONFIGURED') {
        notFound();
      }
    }
    throw error;
  }

  return (
    <div className="guildShell">
      <aside className="guildSidebar">
        <Link className="guildBrand" href="/">
          Knight
        </Link>
        <p className="guildLabel">Guild {guildId}</p>
        <nav aria-label="Guild navigation" className="guildNav">
          <Link href={`/guilds/${guildId}`}>Overview</Link>
          <Link href={`/guilds/${guildId}/staff`}>Staff Profiles</Link>
          <Link href={`/guilds/${guildId}/logging`}>Logging</Link>
          <Link href={`/guilds/${guildId}/logs`}>Logs</Link>
          <Link href={`/guilds/${guildId}/security`}>Security</Link>
          <Link href={`/guilds/${guildId}/security/protected`}>Protected</Link>
          <Link href={`/guilds/${guildId}/recovery`}>Recovery</Link>
          <Link href={`/guilds/${guildId}/setup`}>Setup</Link>
        </nav>
        <Link className="guildExit" href="/">
          All servers
        </Link>
      </aside>
      <div className="guildContent">{children}</div>
    </div>
  );
}
