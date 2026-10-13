#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const studio = path.resolve(__dirname, '..');
const cwd = mkdtempSync(path.join(tmpdir(), 'era-packaged-smoke-'));
try {
  const binary = path.join(studio, 'out', `ERA Studio-darwin-${process.arch}`, 'ERA Studio.app', 'Contents', 'MacOS', 'ERA Studio');
  const env = { ...process.env, ERA_STUDIO_CWD: cwd, ERA_STATE_DIR: path.join(cwd, 'state') };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(binary, ['--smoke'], { cwd, env, encoding: 'utf8', timeout: 90_000 });
  const line = r.stdout?.split('\n').find((l) => l.startsWith('{"ok"'));
  const info = line ? JSON.parse(line) : null;
  if (r.status !== 0 || !info?.ok || !info.overview.rea) throw Error(r.error?.message || r.stderr || JSON.stringify(info));
  const result = { exit: r.status, ...info };
  mkdirSync(path.join(studio, 'out/validation'), { recursive: true });
  writeFileSync(path.join(studio, 'out/validation/packaged-smoke.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (e) { process.stderr.write(e.stack + '\n'); process.exitCode = 1; }
finally { rmSync(cwd, { recursive: true, force: true }); }
