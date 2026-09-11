import Link from 'next/link';
import { auth, signIn, signOut } from '../auth';
import { loadDashboardGuilds } from '../lib/dashboard';
import { getWebRuntime } from '../lib/server-runtime';

export default async function Home() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <main className="shell centered">
        <section className="hero panel">
          <p className="eyebrow">Knight Security</p>
          <h1>Administrative power, behind policy.</h1>
          <p className="lede">
            Sign in with Discord to manage servers where Knight recognizes you as the guild owner or
            an explicit Security Manager.
          </p>
          <form
            action={async () => {
              'use server';
              await signIn('discord');
            }}
          >
            <button type="submit">Sign in with Discord</button>
          </form>
        </section>
      </main>
    );
  }

  const { repositories } = getWebRuntime();
  const guilds = await loadDashboardGuilds(session, repositories);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Knight Security</p>
          <h1>Your protected servers</h1>
          <p className="muted">Signed in as {session.user.name ?? session.user.id}.</p>
        </div>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <button className="secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>

      {guilds.length === 0 ? (
        <section className="panel empty">
          <h2>No Knight-authorized servers yet</h2>
          <p>
            Discord Administrator alone does not grant dashboard access. Ask the guild owner to
            configure Knight or explicitly grant Security Manager authority.
          </p>
        </section>
      ) : (
        <section className="guildGrid" aria-label="Knight-authorized servers">
          {guilds.map((guild) => (
            <Link className="panel guildCard" href={`/guilds/${guild.id}`} key={guild.id}>
              <div className="cardHeading">
                <div>
                  <p className="muted small">Discord guild</p>
                  <h2>{guild.id}</h2>
                </div>
                <span className={`mode mode-${guild.mode.toLowerCase()}`}>{guild.mode}</span>
              </div>
              <dl>
                <div>
                  <dt>Setup step</dt>
                  <dd>{guild.setupStep}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{guild.completedSetupSteps.length} steps</dd>
                </div>
              </dl>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
