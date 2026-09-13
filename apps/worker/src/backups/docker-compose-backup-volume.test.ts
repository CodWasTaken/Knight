import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Docker Compose backup storage', () => {
  it('mounts one named backup volume only into the worker', async () => {
    const compose = await readFile(resolve(process.cwd(), '../../docker-compose.yml'), 'utf8');
    const worker = compose.split('\n  worker:')[1]?.split('\nvolumes:')[0] ?? '';
    const bot = compose.split('\n  bot:')[1]?.split('\n  web:')[0] ?? '';
    const web = compose.split('\n  web:')[1]?.split('\n  worker:')[0] ?? '';

    expect(compose).toContain('knight-backups:');
    expect(worker).toContain('KNIGHT_BACKUP_DIR: /data/knight-backups');
    expect(worker).toContain('knight-backups:/data/knight-backups');
    expect(bot).not.toContain('knight-backups');
    expect(web).not.toContain('knight-backups');
  });

  it('prepares the backup mount path for the non-root node user before USER node', async () => {
    const dockerfile = await readFile(resolve(process.cwd(), '../../Dockerfile'), 'utf8');
    const userNode = dockerfile.indexOf('USER node');

    expect(dockerfile).toContain('mkdir -p "$COREPACK_HOME" /data/knight-backups');
    expect(dockerfile).toContain('/app /data/knight-backups');
    expect(dockerfile.indexOf('/data/knight-backups')).toBeLessThan(userNode);
  });
});
