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

  return <>{children}</>;
}
