import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWebRuntime } from '../../../../../lib/server-runtime';
import { updateStaffProfilePolicyAction } from '../actions';

export default async function StaffProfilePage({
  params,
}: Readonly<{ params: Promise<{ guildId: string; profileId: string }> }>) {
  const { guildId, profileId } = await params;
  const { staff } = getWebRuntime().repositories;
  const [profile, assignments] = await Promise.all([
    staff.getCurrentProfileVersion(guildId, profileId),
    staff.listActiveAssignmentsForProfile(guildId, profileId),
  ]);
  if (profile === null) notFound();

  const banPolicy = profile.actionPolicies['member.ban'];
  const banWindows = banPolicy?.rateWindows ?? [];

  return (
    <main className="shell">
      <Link className="backLink" href={`/guilds/${guildId}/staff`}>
        ← Staff Profiles
      </Link>
      <header className="topbar">
        <div>
          <p className="eyebrow">Staff Profile</p>
          <h1>{profile.profileName ?? profile.profileId}</h1>
          <p className="muted">
            Editing creates a new immutable policy version. Existing assignments keep this profile
            identity while Knight switches the current version atomically.
          </p>
        </div>
      </header>

      <section className="detailGrid">
        <section className="panel">
          <h2>Profile state</h2>
          <dl>
            <div>
              <dt>Mapped role</dt>
              <dd>{profile.discordRoleId ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Knight rank</dt>
              <dd>{profile.rank ?? 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Current version</dt>
              <dd>v{profile.version}</dd>
            </div>
            <div>
              <dt>Active members</dt>
              <dd>{assignments.length}</dd>
            </div>
          </dl>
          {assignments.length > 0 ? (
            <ul className="memberList">
              {assignments.map((assignment) => (
                <li key={assignment.id}>
                  <span>{assignment.userId}</span>
                  <span className="muted small">{assignment.syncStatus}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No active Knight assignments use this profile.</p>
          )}
        </section>

        <form action={updateStaffProfilePolicyAction} className="panel policyForm">
          <input name="guildId" type="hidden" value={guildId} />
          <input name="profileId" type="hidden" value={profileId} />
          <div>
            <p className="eyebrow">Guarded permission</p>
            <h2>Member bans</h2>
            <label className="toggleRow">
              <input
                defaultChecked={profile.permissions.includes('member.ban')}
                name="memberBan"
                type="checkbox"
              />
              <span>Allow `member.ban` through Knight</span>
            </label>
          </div>
          <div className="windowList">
            <div>
              <h3>Ban rate windows</h3>
              <p className="muted small">
                Configure up to three finite windows. Leave all rows blank for unlimited bans when
                `member.ban` is enabled.
              </p>
            </div>
            {[0, 1, 2].map((index) => {
              const window = banWindows[index];
              return (
                <div className="windowRow" key={index}>
                  <label>
                    <span>Maximum</span>
                    <input
                      defaultValue={window?.max ?? ''}
                      inputMode="numeric"
                      min="1"
                      name={`banMax${index}`}
                      type="number"
                    />
                  </label>
                  <label>
                    <span>Window (ms)</span>
                    <input
                      defaultValue={window?.windowMs ?? ''}
                      inputMode="numeric"
                      min="1"
                      name={`banWindowMs${index}`}
                      type="number"
                    />
                  </label>
                </div>
              );
            })}
          </div>

          <button type="submit">Create new policy version</button>
        </form>
      </section>
    </main>
  );
}
