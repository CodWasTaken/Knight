import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveMigrationsFolder } from './migrations.js';

describe('resolveMigrationsFolder', () => {
  it.each(['src/migrations.ts', 'dist/migrations.js'])('resolves the package migration directory from %s', (modulePath) => {
    const packageRoot = resolve(process.cwd());
    const moduleUrl = pathToFileURL(resolve(packageRoot, modulePath)).href;

    expect(resolveMigrationsFolder(moduleUrl)).toBe(resolve(packageRoot, 'migrations'));
  });
});
