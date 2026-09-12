import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('canonicalizes object keys so equivalent snapshots have the same compressed hash', async () => {
    const { storage } = await makeStorage();
    const first = await storage.write('100', 'backup-a', {
      version: 1, guildId: '100', nested: { beta: 2, alpha: 1 }, items: [{ z: 3, a: 1 }],
    });
    const second = await storage.write('100', 'backup-b', {
      items: [{ a: 1, z: 3 }], nested: { alpha: 1, beta: 2 }, guildId: '100', version: 1,
    });

    expect(first.sha256).toBe(second.sha256);
  });

  it('writes a temporary file and atomically renames it to the final snapshot path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knight-backups-fs-'));
    dirs.push(root);
    const fileSystem = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn(),
      rm: vi.fn().mockResolvedValue(undefined),
    };
    const storage = new LocalBackupStorage(root, fileSystem as never);

    await storage.write('100', 'backup-atomic', { guildId: '100' });

    expect(fileSystem.writeFile).toHaveBeenCalledTimes(1);
    const tempPath = fileSystem.writeFile.mock.calls[0]?.[0] as string;
    const finalPath = join(root, '100', 'backup-atomic.json.gz');
    expect(tempPath).not.toBe(finalPath);
    expect(tempPath).toMatch(/\.tmp$/);
    expect(fileSystem.rename).toHaveBeenCalledWith(tempPath, finalPath);
  });
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
