import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function assertIdentifier(value: string): void {
  if (!value || value === '.' || value.includes('..') || /[\\/]/.test(value)) {
    throw new Error('Invalid backup identifier');
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class LocalBackupStorage {
  public constructor(private readonly rootDir: string) {}

  public async write(
    guildId: string,
    backupId: string,
    payload: unknown,
  ): Promise<{ relativePath: string; sha256: string }> {
    assertIdentifier(guildId);
    assertIdentifier(backupId);
    const relativePath = `${guildId}/${backupId}.json.gz`;
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload), 'utf8'));
    await mkdir(join(this.rootDir, guildId), { recursive: true });
    await writeFile(join(this.rootDir, relativePath), compressed);
    return { relativePath, sha256: sha256(compressed) };
  }

  public async readVerified<T = unknown>(relativePath: string, expectedSha256: string): Promise<T> {
    const match = /^([^/\\]+)\/([^/\\]+)\.json\.gz$/.exec(relativePath);
    if (!match) throw new Error('Invalid backup path');
    assertIdentifier(match[1] ?? '');
    assertIdentifier(match[2] ?? '');

    const compressed = await readFile(join(this.rootDir, relativePath));
    if (sha256(compressed) !== expectedSha256) {
      throw new Error('Backup integrity check failed');
    }
    const json = await gunzipAsync(compressed);
    return JSON.parse(json.toString('utf8')) as T;
  }
}
