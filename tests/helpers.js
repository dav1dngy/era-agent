import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolveReaCommand } from '../src/rea_integration/rea-client.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(ROOT, 'tests', 'fixtures');
export const DATASETS = join(ROOT, 'benchmarks', 'datasets');
export const FAKE_REA = join(FIXTURES, 'fake-rea.mjs');

export function tempDir(prefix = 'era-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function loadEvidence(name) {
  return JSON.parse(readFileSync(join(FIXTURES, 'evidence', name), 'utf8'));
}

export const REA_BIN = resolveReaCommand(null).command;

export function reaAvailable() {
  if (process.env.ERA_SKIP_REA) return false;
  const r = spawnSync(REA_BIN, ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

export function runEra(args, { cwd = ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'bin', 'era.mjs'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 300_000 });
}

export function initRepo() {
  const dir = tempDir('era-git-');
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'ERA Test');
  git('config', 'user.email', 'era-test@localhost');
  writeFileSync(join(dir, 'file.txt'), 'v1\n');
  writeFileSync(join(dir, '.gitignore'), '.era/\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  git('tag', '-a', 'era-v1', '-m', 'era-v1: initial');
  return { dir, git };
}
