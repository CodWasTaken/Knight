import { GuildMode } from '@knight/contracts';
import Link from 'next/link';
import { getWebDiscordAdapter } from '../../../../lib/discord-runtime';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { createStaffProfileAction } from './actions';

export default async function StaffProfilesPage({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const runtime = getWebRuntime();
  const { staff, guilds } = runtime.repositories;
  const [profiles, guild] = await Promise.all([
    staff.listProfiles(guildId),
    guilds.get(guildId),
  ]);
  const summaries = await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      version: await staff.getCurrentProfileVersion(guildId, profile.id),
      assignments: await staff.listActiveAssignmentsForProfile(guildId, profile.id),
    })),
  );

  summaries.sort((left, right) => right.profile.rank - left.profile.rank);
  const discord = getWebDiscordAdapter(runtime);
  const discordState = discord === null ? null : await discord.getGuildState(guildId);
  const manageableRoles =
    discordState?.roles.filter(
      (role) =>
        role.roleId !== guildId &&
        !role.managed &&
        role.position < discordState.knightRolePosition,
    ) ?? [];
  const canCreate =
    guild?.mode !== GuildMode.Guarded && discordState !== null && manageableRoles.length > 0;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Staff Profiles</p>
          <h1>Versioned staff authority</h1>
          <p className="muted">
            Knight assignments are authoritative. Discord roles are the mapped representation.
          </p>
        </div>
      </header>

      <section className="panel staffCreatePanel">
        <h2>Create Staff Profile</h2>
        <p className="muted">
          Map Knight authority to an existing Discord role that Knight can manage.
        </p>
        {canCreate ? (
          <form action={createStaffProfileAction} className="metadataForm">
            <input name="guildId" type="hidden" value={guildId} />
            <label>
              <span>Profile name</span>
              <input maxLength={100} name="name" required type="text" />
            </label>
            <label>
              <span>Discord role</span>
              <select name="discordRoleId" required>
                {manageableRoles.map((role) => (
                  <option key={role.roleId} value={role.roleId}>
                    {role.name} — {role.roleId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Knight rank</span>
              <input min="0" name="rank" required step="1" type="number" />
            </label>
            <button type="submit">Create profile</button>
          </form>
        ) : guild?.mode === GuildMode.Guarded ? (
          <p className="notice">Create or remap Staff Profiles after rolling Guarded mode back to Test.</p>
        ) : discordState === null ? (
          <p className="notice">Configure DISCORD_TOKEN in the web service to load Discord roles.</p>
        ) : (
          <p className="notice">Knight cannot currently manage any available Discord role.</p>
        )}
      </section>

      {summaries.length === 0 ? (
        <section className="panel empty">
          <h2>No Staff Profiles configured</h2>
          <p>Create the first profile above, then configure its moderation capabilities.</p>
        </section>
      ) : (
        <section className="guildGrid" aria-label="Staff Profiles">
          {summaries.map(({ profile, version, assignments }) => (
            <Link
              className="panel guildCard"
              href={`/guilds/${guildId}/staff/${profile.id}`}
              key={profile.id}
            >
              <div className="cardHeading">
                <div>
                  <p className="muted small">Knight rank {profile.rank}</p>
                  <h2>{profile.name}</h2>
                </div>
                <span className="mode">v{version?.version ?? '—'}</span>
              </div>
              <dl>
                <div>
                  <dt>Mapped role</dt>
                  <dd>{profile.discordRoleId}</dd>
                </div>
                <div>
                  <dt>Active members</dt>
                  <dd>{assignments.length}</dd>
                </div>
                <div>
                  <dt>Moderation capabilities</dt>
                  <dd>{version?.permissions.filter((action) => action.startsWith('member.') || action === 'message.purge').length ?? 0}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
