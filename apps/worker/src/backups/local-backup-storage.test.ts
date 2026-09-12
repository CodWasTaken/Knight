import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalBackupStorage } from './local-backup-storage.js';

const dirs: string[] = [];

async function makeStorage() {
  const root = await mkdtemp(join(tmpdir(), 'knight-backups-'));
  dirs.push(root);
  return { root, storage: new LocalBackupStorage(root) };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('LocalBackupStorage', () => {
  it('writes gzip JSON and verifies SHA-256 over the compressed bytes', async () => {
    const { root, storage } = await makeStorage();
    const payload = { version: 1, guildId: '100', discord: { roles: [], channels: [] } };

    const written = await storage.write('100', 'backup-1', payload);
    const compressed = await readFile(join(root, written.relativePath));

    expect(written.relativePath).toBe('100/backup-1.json.gz');
    expect(written.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(storage.readVerified(written.relativePath, written.sha256)).resolves.toEqual(payload);
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });

  it('rejects a snapshot whose compressed bytes were tampered with', async () => {
    const { root, storage } = await makeStorage();
    const written = await storage.write('100', 'backup-1', { guildId: '100' });
    const fullPath = join(root, written.relativePath);
    const compressed = await readFile(fullPath);
    compressed[compressed.length - 1] = (compressed[compressed.length - 1] ?? 0) ^ 0xff;
    await writeFile(fullPath, compressed);

    await expect(storage.readVerified(written.relativePath, written.sha256)).rejects.toThrow(
      'Backup integrity check failed',
    );
  });

  it.each(['../100', '100/child', '100\\child', '..'])('rejects unsafe guild id %s', async (guildId) => {
    const { storage } = await makeStorage();
    await expect(storage.write(guildId, 'backup-1', {})).rejects.toThrow('Invalid backup identifier');
  });

  it.each(['../outside.json.gz', '/tmp/outside.json.gz', '100/../outside.json.gz'])('rejects unsafe stored path %s', async (relativePath) => {
    const { storage } = await makeStorage();
    await expect(storage.readVerified(relativePath, 'a'.repeat(64))).rejects.toThrow();
  });

  it.each(['../backup', 'nested/backup', 'nested\\backup', '..'])('rejects unsafe backup id %s', async (backupId) => {
    const { storage } = await makeStorage();
    await expect(storage.write('100', backupId, {})).rejects.toThrow('Invalid backup identifier');
  });
});
