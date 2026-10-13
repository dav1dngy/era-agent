#!/usr/bin/env node
'use strict';
// Build from an allowlist into a disposable staging directory. Never copy user state, repository history or secrets.
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = path.resolve(__dirname, '..');
const repo = path.resolve(studio, '../..');
const pkg = JSON.parse(readFileSync(path.join(studio, 'package.json')));
const rootPkg = JSON.parse(readFileSync(path.join(repo, 'package.json')));
const arch = process.env.ERA_PACKAGE_ARCH || process.arch;

async function build() {
  if (process.platform !== 'darwin') throw new Error('This packaging command is validated only on macOS.');
  if (!['arm64', 'x64'].includes(arch)) throw new Error('ERA_PACKAGE_ARCH must be arm64 or x64.');
  const stage = mkdtempSync(path.join(tmpdir(), 'era-studio-package-'));
  try {
    for (const entry of ['electron', 'web']) cpSync(path.join(studio, entry), path.join(stage, entry), { recursive: true });
    // The app uses unpacked sources: CLI subprocesses and the Python PTY helper require real paths.
    const packaged = { ...pkg, productName: 'ERA Studio', scripts: {}, devDependencies: {}, dependencies: { ...pkg.dependencies, ...rootPkg.dependencies } };
    writeFileSync(path.join(stage, 'package.json'), JSON.stringify(packaged, null, 2));
    const lock = JSON.parse(readFileSync(path.join(studio, 'package-lock.json')));
    const coreLock = JSON.parse(readFileSync(path.join(repo, 'package-lock.json')));
    // Preserve both dependency locks; npm ci will reject any incompatible collision.
    const merged = { ...lock, packages: { ...lock.packages } };
    merged.packages[''] = { ...lock.packages[''], dependencies: packaged.dependencies, devDependencies: {} };
    for (const [key, value] of Object.entries(coreLock.packages)) {
      if (!key || value.dev) continue;
      if (merged.packages[key] && merged.packages[key].version !== value.version && !merged.packages[key].dev) throw new Error(`Dependency lock collision: ${key}`);
      merged.packages[key] = value;
    }
    writeFileSync(path.join(stage, 'package-lock.json'), JSON.stringify(merged, null, 2));
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
    mkdirSync(path.join(stage, 'era'));
    for (const entry of ['src', 'bin', 'era.config.json', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      cpSync(path.join(repo, entry), path.join(stage, 'era', entry), { recursive: true });
    }
    cpSync(path.join(repo, 'LICENSE'), path.join(stage, 'LICENSE'));
    cpSync(path.join(repo, 'THIRD_PARTY_NOTICES.md'), path.join(stage, 'THIRD_PARTY_NOTICES.md'));
    const { packager } = await import('@electron/packager');
    const options = { dir: stage, out: path.join(studio, 'out'), name: 'ERA Studio', executableName: 'ERA Studio', appBundleId: 'org.era.studio', appVersion: pkg.version, platform: 'darwin', arch, asar: false, prune: false, overwrite: true, electronVersion: require('electron/package.json').version, osxSign: false, osxNotarize: false };
    const outputs = await packager(options);
    process.stdout.write(`Unsigned development application:\n${outputs.map((p) => path.join(p, 'ERA Studio.app')).join('\n')}\n`);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
build().catch((e) => { process.stderr.write(`${e.stack}\n`); process.exitCode = 1; });
