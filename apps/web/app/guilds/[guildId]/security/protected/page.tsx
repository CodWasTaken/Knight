import { ProtectionLevel } from '@knight/contracts';
import { getWebDiscordAdapter } from '../../../../../lib/discord-runtime';
import { getWebRuntime } from '../../../../../lib/server-runtime';
import { removeProtectedResourceAction, saveProtectedResourceAction } from './actions';

export default async function ProtectedResourcesPage({
  params,
}: Readonly<{ params: Promise<{ guildId: string }> }>) {
  const { guildId } = await params;
  const runtime = getWebRuntime();
  const resources = await runtime.repositories.security.listProtectedResources(guildId);
  const discordAvailable = getWebDiscordAdapter(runtime) !== null;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Protected resources</p>
          <h1>Users, roles, and channels</h1>
          <p className="lede">
            Important and Critical resources require approval. Immutable resources block ordinary
            staff mutation.
          </p>
        </div>
      </header>

      <section className="panel">
        <h2>Add or update protection</h2>
        {!discordAvailable ? (
          <p className="notice">
            Live Discord validation is unavailable. Configure DISCORD_TOKEN in the web service to
            add protected resources.
          </p>
        ) : null}
        <form action={saveProtectedResourceAction} className="metadataForm loggingForm">
          <input name="guildId" type="hidden" value={guildId} />
          <label>
            <span>Resource type</span>
            <select name="resourceType">
              <option value="USER">User</option>
              <option value="ROLE">Role</option>
              <option value="CHANNEL">Channel or category</option>
            </select>
          </label>
          <label>
            <span>Discord ID</span>
            <input inputMode="numeric" name="resourceId" required />
          </label>
          <label>
            <span>Protection level</span>
            <select name="level">
              <option value={ProtectionLevel.Important}>Important</option>
              <option value={ProtectionLevel.Critical}>Critical</option>
              <option value={ProtectionLevel.Immutable}>Immutable</option>
            </select>
          </label>
          <button disabled={!discordAvailable} type="submit">
            Save protection
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Current protected resources</h2>
        {resources.length === 0 ? (
          <p className="muted">No protected resources configured.</p>
        ) : (
          <ul className="memberList">
            {resources.map((resource) => (
              <li key={`${resource.resourceType}:${resource.resourceId}`}>
                <span>
                  <strong>{resource.level}</strong> · {resource.resourceType} {resource.resourceId}
                </span>
                <form action={removeProtectedResourceAction}>
                  <input name="guildId" type="hidden" value={guildId} />
                  <input name="resourceType" type="hidden" value={resource.resourceType} />
                  <input name="resourceId" type="hidden" value={resource.resourceId} />
                  <button className="secondary" type="submit">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
