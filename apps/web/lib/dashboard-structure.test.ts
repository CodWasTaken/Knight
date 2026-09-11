import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

describe('dashboard shell structure', () => {
  it('keeps persistent Overview, Staff Profiles, Logging, Logs, and Setup navigation in the guild layout', async () => {
    const layout = await source('../app/guilds/[guildId]/layout.tsx');

    expect(layout).toContain('Overview');
    expect(layout).toContain('Staff Profiles');
    expect(layout).toContain('Logging');
    expect(layout).toContain('Logs');
    expect(layout).toContain('Setup');
    expect(layout).toContain('href={`/guilds/${guildId}`}');
    expect(layout).toContain('href={`/guilds/${guildId}/staff`}');
    expect(layout).toContain('href={`/guilds/${guildId}/logging`}');
    expect(layout).toContain('href={`/guilds/${guildId}/logs`}');
    expect(layout).toContain('href={`/guilds/${guildId}/setup`}');
  });

  it('uses flat styling without CSS gradients or large decorative shadows', async () => {
    const css = await source('../app/globals.css');

    expect(css).not.toContain('linear-gradient');
    expect(css).not.toContain('radial-gradient');
    expect(css).not.toContain('box-shadow');
  });

  it('provides visible keyboard focus and responsive guild navigation rules', async () => {
    const css = await source('../app/globals.css');

    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/\.guildNav\s*\{/);
    expect(css).toMatch(/@media\s*\(max-width:\s*\d+px\)[\s\S]*\.guildNav/);
  });
});
