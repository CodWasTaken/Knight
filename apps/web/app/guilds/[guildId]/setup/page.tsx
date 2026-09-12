import { GuildMode } from '@knight/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '../../../../auth';
import { requireGuildAccess } from '../../../../lib/authorization';
import { getWebRuntime } from '../../../../lib/server-runtime';
import { getWebSetupServices } from '../../../../lib/setup-runtime';
import {
  advanceSetupAction,
  enableGuardedBanAction,
  enterTestModeAction,
  rollbackGuardedBanAction,
} from './actions';

function status(value: boolean): string {
  return value ? 'Ready' : 'Needs attention';
}

export default async function SetupPage({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const runtime = getWebRuntime();
  const accessRole = await requireGuildAccess(guildId, session, runtime.repositories);
  const services = getWebSetupServices(runtime);
  if (services === null) {
    return (
      <main className="shell">
        <section className="panel empty">
          <p className="eyebrow">Setup</p>
          <h1>Live Discord setup unavailable</h1>
          <p className="lede">
            Knight can still run the dashboard without the bot token, but hierarchy checks and
            Guarded permission migration require `DISCORD_TOKEN` in the web service environment.
          </p>
          <p className="muted">No Discord permission changes were attempted.</p>
        </section>
      </main>
    );
  }

  const state = await services.setup.getState(guildId, session.user.id);
  const preview =
    state.mode === GuildMode.Test ? await services.migrations.previewBanGuard(guildId) : null;
  const isOwner = accessRole === 'OWNER';

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Persistent setup</p>
          <h1>Observe → Test → Guarded</h1>
          <p className="lede">
            Knight keeps setup progress in PostgreSQL and rechecks Discord hierarchy before any
            Guarded permission migration.
          </p>
        </div>
        <span className={`mode mode-${state.mode.toLowerCase()}`}>{state.mode}</span>
      </header>
      <section className="detailGrid">
        <section className="panel">
          <p className="eyebrow">Readiness</p>
          <h2>Live protection prerequisites</h2>
          <dl>
            <div>
              <dt>Setup step</dt>
              <dd>{state.step}</dd>
            </div>
            <div>
              <dt>Staff Profiles</dt>
              <dd>
                {status(state.profileReady)} · {state.profileCount}
              </dd>
            </div>
            <div>
              <dt>Manage Roles</dt>
              <dd>{status(state.manageRolesReady)}</dd>
            </div>
            <div>
              <dt>Role hierarchy</dt>
              <dd>{status(state.hierarchyHealthy)}</dd>
            </div>
            <div>
              <dt>Security Managers</dt>
              <dd>{state.securityManagerCount}</dd>
            </div>
          </dl>
          {state.blockingRoleIds.length > 0 ? (
            <div className="notice noticeDanger">
              <strong>Blocking mapped roles</strong>
              <p>{state.blockingRoleIds.join(', ')}</p>
            </div>
          ) : null}
          <p className="muted">Next action: {state.nextAction}</p>
        </section>

        <section className="panel">
          <p className="eyebrow">Progress</p>
          <h2>Persistent setup state</h2>
          <p className="muted">Completed steps remain recorded across restarts.</p>
          {state.completedSteps.length > 0 ? (
            <ul className="memberList">
              {state.completedSteps.map((step) => (
                <li key={step}>
                  <span>{step}</span>
                  <span className="muted small">Complete</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No setup steps are marked complete yet.</p>
          )}
          {state.step === 'LOGGING' ? (
            <div className="notice">
              <p>
                Save the Security and Moderation notification destinations before continuing.
                Choosing Disabled is valid for either destination.
              </p>
              <Link href={`/guilds/${guildId}/logging`}>Configure logging</Link>
            </div>
          ) : null}
          {state.step === 'PROTECTION' ? (
            <div className="notice">
              <p>
                Save the bot and webhook firewall modes before continuing. Observe is a valid
                explicit choice.
              </p>
              <Link href={`/guilds/${guildId}/security`}>Configure protection</Link>
            </div>
          ) : null}
          {state.step !== 'COMPLETE' ? (
            <form action={advanceSetupAction} className="setupAction">
              <input name="guildId" type="hidden" value={guildId} />
              <button className="secondary" type="submit">
                Advance setup step
              </button>
            </form>
          ) : null}
        </section>
      </section>
      {state.mode === GuildMode.Observe ? (
        <section className="panel setupPanel">
          <p className="eyebrow">Test mode</p>
          <h2>Practice Knight moderation before Guarded</h2>
          <p className="lede">
            Test mode keeps native Discord permissions in place while staff practice Knight-routed
            moderation and you review likely bypasses.
          </p>
          <form action={enterTestModeAction} className="setupAction">
            <input name="guildId" type="hidden" value={guildId} />
            <button type="submit">Enter Test mode</button>
          </form>
        </section>
      ) : null}

      {state.mode === GuildMode.Test && preview !== null ? (
        <section className="panel setupPanel">
          <div className="cardHeading">
            <div>
              <p className="eyebrow">MEMBER_BAN Guarded preview</p>
              <h2>
                {preview.roles.length === 0
                  ? 'Nothing to migrate'
                  : preview.blocked
                    ? 'Migration blocked'
                    : 'Ready for owner confirmation'}
              </h2>
            </div>
            <span className="mode">{preview.staffCount} staff</span>
          </div>
          <p className="muted">
            Only Discord Ban Members is removed. Every unrelated role permission is preserved.
          </p>
          {preview.roles.length === 0 ? (
            <p className="muted">No enabled Staff Profile currently grants `member.ban`.</p>
          ) : (
            <div className="previewTable" role="table" aria-label="Guarded role permission preview">
              {preview.roles.map((role) => (
                <div className="previewRow" role="row" key={role.roleId}>
                  <div>
                    <strong>{role.roleId}</strong>
                    <p className="muted small">Profiles: {role.profileIds.join(', ')}</p>
                  </div>
                  <div>
                    <span className="muted small">Before</span>
                    <code>{role.beforePermissions.toString()}</code>
                  </div>
                  <div>
                    <span className="muted small">After</span>
                    <code>{role.afterPermissions.toString()}</code>
                  </div>
                  <div>
                    <span className="muted small">Manageability</span>
                    <strong>{role.manageable ? 'Ready' : role.blockReason}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
          {isOwner ? (
            <form action={enableGuardedBanAction} className="setupAction guardedConfirm">
              <input name="guildId" type="hidden" value={guildId} />
              <label className="toggleRow">
                <input name="confirmGuarded" type="checkbox" value="yes" required />
                <span>
                  I understand Knight will snapshot roles and remove Ban, Kick, Moderate, and Manage
                  Messages permissions.
                </span>
              </label>
              <button disabled={preview.blocked || preview.roles.length === 0} type="submit">
                Enable Guarded moderation
              </button>
            </form>
          ) : (
            <p className="muted">Only the Discord guild owner can confirm Guarded migration.</p>
          )}
        </section>
      ) : null}

      {state.mode === GuildMode.Guarded ? (
        <section className="panel setupPanel">
          <p className="eyebrow">Rollback</p>
          <h2>MEMBER_BAN Guarded is active</h2>
          <p className="lede">
            Knight will restore the exact latest saved role permission bigints before returning the
            guild to Test mode.
          </p>
          {isOwner ? (
            <form action={rollbackGuardedBanAction} className="setupAction">
              <input name="guildId" type="hidden" value={guildId} />
              <button className="secondary" type="submit">
                Rollback Guarded moderation to Test
              </button>
            </form>
          ) : (
            <p className="muted">Only the Discord guild owner can run the rollback.</p>
          )}
        </section>
      ) : null}
      <section className="panel setupPanel">
        <p className="eyebrow">Security Managers</p>
        <h2>Knight setup authority</h2>
        {state.securityManagerIds.length > 0 ? (
          <ul className="memberList">
            {state.securityManagerIds.map((userId) => (
              <li key={userId}>
                <span>{userId}</span>
                <span className="muted small">Security Manager</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No explicit Knight Security Managers are configured.</p>
        )}
      </section>
    </main>
  );
}
