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
  factoryResetAction,
} from './actions';
import { FactoryResetService } from '../../../../lib/factory-reset-service';

function status(value: boolean): string {
  return value ? 'Ready' : 'Needs attention';
}

const SETUP_NOTICES: Readonly<Record<string, string>> = {
  success: 'Setup change saved.',
  blocked: 'That setup change is currently blocked. Review the readiness details below.',
  'invalid-confirmation': 'The required confirmation was not provided exactly.',
  'reset-queued': 'Factory Reset was queued. The worker will recheck safety before erasing Knight data.',
  'reset-blocked': 'Factory Reset is currently blocked.',
  failed: 'The request could not be completed safely.',
};

function stepLinks(step: string, guildId: string): readonly Readonly<{ href: string; label: string }>[] {
  if (['HEALTH', 'STAFF', 'POLICIES'].includes(step)) {
    return [{ href: `/guilds/${guildId}/staff`, label: 'Configure Staff Profiles' }];
  }
  if (step === 'LOGGING') return [{ href: `/guilds/${guildId}/logging`, label: 'Configure logging' }];
  if (step === 'PROTECTION') return [{ href: `/guilds/${guildId}/security`, label: 'Configure protection' }];
  if (step === 'BACKUPS') return [{ href: `/guilds/${guildId}/recovery`, label: 'Configure backups' }];
  if (step === 'OBSERVE') {
    return [
      { href: `/guilds/${guildId}/staff`, label: 'Staff Profiles' },
      { href: `/guilds/${guildId}/logging`, label: 'Logging' },
      { href: `/guilds/${guildId}/security`, label: 'Security' },
      { href: `/guilds/${guildId}/recovery`, label: 'Recovery' },
    ];
  }
  return [];
}

export default async function SetupPage({
  params,
  searchParams = Promise.resolve({}),
}: Readonly<{ params: Promise<{ guildId: string }>; searchParams?: Promise<{ notice?: string | string[] }> }>) {
  const [{ guildId }, query] = await Promise.all([params, searchParams]);
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
  const readinessLinks = stepLinks(state.step, guildId);
  const resetPreflight = await new FactoryResetService(runtime.repositories).getPreflight(guildId, session.user.id);
  const setupSequence = [
    ['Health', 'Confirm Knight permissions and role hierarchy.'],
    ['Staff', 'Define who can represent Knight moderation roles.'],
    ['Policies', 'Choose which Knight actions each profile may use.'],
    ['Logging', 'Choose where operational notifications are delivered.'],
    ['Protection', 'Configure firewall and protected resources.'],
    ['Backups', 'Choose a durable local backup policy.'],
    ['Review', 'Review all blockers before Test mode.'],
  ] as const;
  const notice = typeof query.notice === 'string' ? SETUP_NOTICES[query.notice] : undefined;

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
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      <section className="detailGrid">
        <section className="panel">
          <p className="eyebrow">Guided sequence</p>
          <h2>From health check to review</h2>
          <ol className="memberList">
            {setupSequence.map(([label, why]) => <li key={label}><strong>{label}</strong><span className="muted small">{why}</span></li>)}
          </ol>
        </section>
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
          {!state.currentStepReady ? (
            <div className="notice noticeDanger">
              <strong>Current setup step is blocked</strong>
              <ul>
                {state.currentStepBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
              {readinessLinks.map((link) => (
                <Link href={link.href} key={link.href}>{link.label}</Link>
              ))}
            </div>
          ) : null}
          <p className="muted">Next action: {state.currentStepReady ? state.nextAction : 'Resolve the blockers above.'}</p>
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
                Save the Security, Moderation, Messages, and Voice notification destinations before
                continuing. Choosing Disabled is valid for every destination.
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
              <button className="secondary" disabled={!state.currentStepReady} type="submit">
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
            <button disabled={state.step !== 'COMPLETE'} type="submit">Enter Test mode</button>
          </form>
          {state.step !== 'COMPLETE' ? <p className="muted">Complete every setup step before entering Test mode.</p> : null}
        </section>
      ) : null}

      {state.mode === GuildMode.Test && preview !== null ? (
        <section className="panel setupPanel">
          <div className="cardHeading">
            <div>
              <p className="eyebrow">Guarded Moderation preview</p>
              <h2>
                {preview.roles.length === 0
                  ? 'No native permissions need removal'
                  : preview.blocked
                    ? 'Migration blocked'
                    : 'Ready for owner confirmation'}
              </h2>
            </div>
            <span className="mode">{preview.staffCount} staff</span>
          </div>
          <p className="muted">
            Knight removes only Ban Members, Kick Members, Moderate Members, and Manage Messages.
            Every unrelated role permission is preserved.
          </p>
          <h3>Guarded readiness checklist</h3>
          <ul className="memberList">
            <li><span>Setup complete</span><strong>{status(state.step === 'COMPLETE')}</strong></li>
            <li><span>Current user is owner</span><strong>{status(isOwner)}</strong></li>
            <li><span>Knight has Manage Roles</span><strong>{status(state.manageRolesReady)}</strong></li>
            <li><span>Knight role hierarchy healthy</span><strong>{status(state.hierarchyHealthy)}</strong></li>
            <li><span>Emergency state permits configuration</span><strong>{status(!resetPreflight.blockers.some((blocker) => blocker.includes('Panic') || blocker.includes('Lockdown')))}</strong></li>
            <li><span>{preview.roles.length === 0 ? 'No native permissions need removal' : 'Affected roles ready'}</span><strong>{status(!preview.blocked)}</strong></li>
          </ul>
          {preview.roles.length === 0 ? (
            <p className="muted">
              No native moderation permissions need removal. Activation is a safe no-op for Discord
              roles, but Knight will still enter Guarded mode after owner confirmation.
            </p>
          ) : (
            <details className="advancedDetails">
              <summary>Advanced permission changes for {preview.roles.length} affected role{preview.roles.length === 1 ? '' : 's'}</summary>
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
            </details>
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
              <button disabled={preview.blocked} type="submit">
                Enable Guarded moderation
              </button>
              {preview.blocked ? <p className="muted">Resolve every Guarded readiness blocker before activation.</p> : null}
            </form>
          ) : (
            <p className="muted">Only the Discord guild owner can confirm Guarded migration.</p>
          )}
        </section>
      ) : null}

      {state.mode === GuildMode.Guarded ? (
        <section className="panel setupPanel" id="guarded-rollback">
          <p className="eyebrow">Rollback</p>
          <h2>Guarded Moderation is active</h2>
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
      <section className="panel setupPanel dangerZone">
        <p className="eyebrow">Danger Zone</p>
        <h2>Factory Reset Knight</h2>
        <p>Erases Knight setup, staff, policies, logs, security history, protection, Guarded state, backup records, and local Knight backup files.</p>
        <p><strong>Discord roles, channels, members, webhooks, and permissions are not touched.</strong></p>
        {!resetPreflight.allowed ? (
          <div className="notice noticeDanger">
            <ul>{resetPreflight.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            {resetPreflight.blockers.some((blocker) => blocker.includes('Rollback Guarded')) ? <Link href="#guarded-rollback">Go to Guarded rollback</Link> : null}
          </div>
        ) : resetPreflight.isOwner ? (
          <details>
            <summary className="danger">Reveal factory reset confirmation</summary>
            <form action={factoryResetAction} className="setupAction">
              <input name="guildId" type="hidden" value={guildId} />
              <label><span>Type RESET KNIGHT</span><input name="resetPhrase" required /></label>
              <label className="toggleRow"><input name="acknowledgeReset" type="checkbox" value="yes" required /><span>I understand Knight data and local backups will be permanently erased.</span></label>
              <button className="danger" type="submit">Queue Factory Reset</button>
            </form>
          </details>
        ) : null}
      </section>
    </main>
  );
}
