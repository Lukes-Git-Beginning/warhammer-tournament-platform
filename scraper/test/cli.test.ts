import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use tsx to run the TypeScript CLI source directly so @tww3/db (Prisma 7 TS-output)
// resolves correctly without a pre-built db package.
// On Windows, tsx lives as tsx.CMD in node_modules/.bin — use shell:true so the
// OS resolves the .CMD extension automatically.
const TSX = resolve(__dirname, '../node_modules/.bin/tsx');
const CLI_SRC = resolve(__dirname, '../src/cli.ts');

function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(TSX, [CLI_SRC, ...args], {
    encoding: 'utf-8',
    shell: true,
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
}

describe('cli', () => {
  it('exits 0 when CI env is set (CI-Guard)', () => {
    // CI-Guard fires before any DB connection is attempted — safe to run in tests.
    // The guard message goes to stderr; we combine both streams for assertion.
    const result = runCli(['factions', '--dry-run'], { CI: 'true' });
    const combined = (result.stdout ?? '') + (result.stderr ?? '');
    expect(combined).toContain('disabled in CI');
    expect(result.status).toBe(0);
  });

  it('shows help output without CI env', () => {
    // Commander handles --help before action() runs, so no DB connection is made.
    const result = runCli(['--help'], { CI: '' });
    // Combined in case Commander writes to stderr on some versions
    const combined = (result.stdout ?? '') + (result.stderr ?? '');
    expect(combined).toContain('tww3-scraper');
    expect(combined).toContain('factions');
    expect(combined).toContain('tournaments');
    expect(result.status).toBe(0);
  });
});
