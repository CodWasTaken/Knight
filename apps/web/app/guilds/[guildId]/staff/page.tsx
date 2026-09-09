import Link from 'next/link';
import { getWebRuntime } from '../../../../lib/server-runtime';

export default async function StaffProfilesPage({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const { staff } = getWebRuntime().repositories;
  const profiles = await staff.listProfiles(guildId);
  const summaries = await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      version: await staff.getCurrentProfileVersion(guildId, profile.id),
      assignments: await staff.listActiveAssignmentsForProfile(guildId, profile.id),
    })),
  );

  summaries.sort((left, right) => right.profile.rank - left.profile.rank);

  return (
    <main className="shell">
      <Link className="backLink" href={`/guilds/${guildId}`}>
        ← Guild dashboard
      </Link>
      <header className="topbar">
        <div>
          <p className="eyebrow">Staff Profiles</p>
          <h1>Versioned staff authority</h1>
          <p className="muted">
            Knight assignments are authoritative. Discord role membership is only the mapped
            representation.
          </p>
        </div>
      </header>

      {summaries.length === 0 ? (
        <section className="panel empty">
          <h2>No Staff Profiles configured</h2>
          <p>Create and assign Staff Profiles from Discord before editing policy here.</p>
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
                  <dt>member.ban</dt>
                  <dd>{version?.permissions.includes('member.ban') ? 'Enabled' : 'Disabled'}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
