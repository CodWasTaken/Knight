import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

type BackupFileSystem = Readonly<{
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  rename: typeof rename;
  rm: typeof rm;
  writeFile: typeof writeFile;
}>;

const defaultFileSystem: BackupFileSystem = { mkdir, readFile, rename, rm, writeFile };

function assertIdentifier(value: string): void {
  if (!value || value === '.' || value.includes('..') || /[\\/]/.test(value)) {
    throw new Error('Invalid backup identifier');
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export class LocalBackupStorage {
  public constructor(
    private readonly rootDir: string,
    private readonly fileSystem: BackupFileSystem = defaultFileSystem,
  ) {}

  public async write(
    guildId: string,
    backupId: string,
    payload: unknown,
  ): Promise<{ relativePath: string; sha256: string }> {
    assertIdentifier(guildId);
    assertIdentifier(backupId);
    const relativePath = `${guildId}/${backupId}.json.gz`;
    const directory = join(this.rootDir, guildId);
    const finalPath = join(this.rootDir, relativePath);
    const tempPath = join(directory, `.${backupId}.${randomUUID()}.tmp`);
    const json = JSON.stringify(stableValue(payload));
    const compressed = await gzipAsync(Buffer.from(json, 'utf8'));

    await this.fileSystem.mkdir(directory, { recursive: true });
    try {
      await this.fileSystem.writeFile(tempPath, compressed);
      await this.fileSystem.rename(tempPath, finalPath);
    } catch (error) {
      await this.fileSystem.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return { relativePath, sha256: sha256(compressed) };
  }

  public async readVerified<T = unknown>(relativePath: string, expectedSha256: string): Promise<T> {
    const match = /^([^/\\]+)\/([^/\\]+)\.json\.gz$/.exec(relativePath);
    if (!match) throw new Error('Invalid backup path');
    assertIdentifier(match[1] ?? '');
    assertIdentifier(match[2] ?? '');

    const compressed = await this.fileSystem.readFile(join(this.rootDir, relativePath));
    if (sha256(compressed) !== expectedSha256) {
      throw new Error('Backup integrity check failed');
    }
    const json = await gunzipAsync(compressed);
    return JSON.parse(json.toString('utf8')) as T;
  }
}
