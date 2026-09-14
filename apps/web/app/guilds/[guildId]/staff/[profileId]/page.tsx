import {
  GuildMode,
  MODERATION_ACTION_METADATA,
  RATE_LIMITED_MODERATION_ACTIONS,
} from '@knight/contracts';
import { notFound } from 'next/navigation';
import { getWebDiscordAdapter } from '../../../../../lib/discord-runtime';
import { getWebRuntime } from '../../../../../lib/server-runtime';
import {
  updateStaffProfileMetadataAction,
  updateStaffProfilePolicyAction,
} from '../actions';
import { RateLimitEditor } from '../rate-limit-editor';
import { actionNotice } from '../../../../../lib/action-feedback';

export default async function StaffProfilePage({
  params,
  searchParams = Promise.resolve({}),
}: Readonly<{ params: Promise<{ guildId: string; profileId: string }>; searchParams?: Promise<{ notice?: string | string[] }> }>) {
  const [{ guildId, profileId }, query] = await Promise.all([params, searchParams]);
  const runtime = getWebRuntime();
  const { staff, guilds } = runtime.repositories;
  const [profile, assignments, guild] = await Promise.all([
    staff.getCurrentProfileVersion(guildId, profileId),
    staff.listActiveAssignmentsForProfile(guildId, profileId),
    guilds.get(guildId),
  ]);
  if (profile === null) notFound();

  const discord = getWebDiscordAdapter(runtime);
  const discordState = discord === null ? null : await discord.getGuildState(guildId);
  const manageableRoles =
    discordState?.roles.filter(
      (role) =>
        role.roleId !== guildId &&
        !role.managed &&
        role.position < discordState.knightRolePosition,
    ) ?? [];
  const currentRole = discordState?.roles.find((role) => role.roleId === profile.discordRoleId);
  const roleOptions = [
    ...(currentRole === undefined ? [] : [currentRole]),
    ...manageableRoles.filter((role) => role.roleId !== currentRole?.roleId),
  ];
  const mappingLocked = guild?.mode === GuildMode.Guarded;

  return (
    <main className="shell">
      {actionNotice(query.notice) ? <div className="notice" role="status">{actionNotice(query.notice)}</div> : null}
      <header className="topbar">
        <div>
          <p className="eyebrow">Staff Profile</p>
          <h1>{profile.profileName ?? profile.profileId}</h1>
          <p className="muted">
            Every save creates a new immutable authority version. Discord roles remain only the
            mapped representation of Knight state; role membership does not grant Knight authority
            without an active Knight assignment.
          </p>
        </div>
      </header>
      <section className="detailGrid">
        <section className="panel">
          <h2>Profile state</h2>
          <dl>
            <div>
              <dt>Mapped role</dt>
              <dd>{currentRole?.name ?? profile.discordRoleId ?? 'Unavailable'}</dd>
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

        <form action={updateStaffProfileMetadataAction} className="panel metadataForm">
          <input name="guildId" type="hidden" value={guildId} />
          <input name="profileId" type="hidden" value={profileId} />
          <div>
            <p className="eyebrow">Metadata</p>
            <h2>Profile identity</h2>
          </div>
          <label>
            <span>Profile name</span>
            <input defaultValue={profile.profileName ?? ''} maxLength={100} name="name" required />
          </label>
          <label>
            <span>Discord role</span>
            {discordState === null ? (
              <input name="discordRoleId" readOnly value={profile.discordRoleId ?? ''} />
            ) : (
              <select defaultValue={profile.discordRoleId} disabled={mappingLocked} name="discordRoleId">
                {currentRole === undefined && profile.discordRoleId !== undefined ? (
                  <option value={profile.discordRoleId}>
                    Unavailable role — {profile.discordRoleId}
                  </option>
                ) : null}
                {roleOptions.map((role) => (
                  <option key={role.roleId} value={role.roleId}>
                    {role.name} — {role.roleId}
                  </option>
                ))}
              </select>
            )}
          </label>
          {mappingLocked ? (
            <input name="discordRoleId" type="hidden" value={profile.discordRoleId ?? ''} />
          ) : null}
          <label>
            <span>Knight rank</span>
            <input defaultValue={profile.rank ?? 0} min="0" name="rank" required step="1" type="number" />
          </label>
          {mappingLocked ? (
            <p className="notice small">
              Guarded mode locks the Discord role mapping. Name and rank can still be versioned.
            </p>
          ) : null}
          <button type="submit">Create metadata version</button>
        </form>
      </section>

      <form action={updateStaffProfilePolicyAction} className="panel policyForm policyEditor">
        <input name="guildId" type="hidden" value={guildId} />
        <input name="profileId" type="hidden" value={profileId} />
        <div>
          <p className="eyebrow">Moderation policy</p>
          <h2>Capabilities and independent limits</h2>
          <p className="muted">
            Each mutating action has its own budget. Warning history is deliberately read-only and
            never consumes a rate limit.
          </p>
        </div>

        <div className="capabilityList">
          {RATE_LIMITED_MODERATION_ACTIONS.map((action) => (
            <RateLimitEditor
              action={action}
              enabled={profile.permissions.includes(action)}
              key={action}
              policy={profile.actionPolicies[action]}
            />
          ))}

          <fieldset className="capabilityRow">
            <legend>{MODERATION_ACTION_METADATA['member.warnings.view'].label}</legend>
            <label className="toggleRow">
              <input
                defaultChecked={profile.permissions.includes('member.warnings.view')}
                name="permission:member.warnings.view"
                type="checkbox"
              />
              <span>Allow read-only warning-history lookup</span>
            </label>
            <p className="muted small">
              This capability has no mutation budget and is the deliberate target-rank exception.
            </p>
          </fieldset>
        </div>

        <button type="submit">Create policy version</button>
      </form>
    </main>
  );
}
