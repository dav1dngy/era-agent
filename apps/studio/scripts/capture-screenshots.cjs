#!/usr/bin/env node
'use strict';
// Repeatable capture of the documentation screenshots from the REAL ERA Studio application:
//   npm run capture:screenshots --prefix apps/studio
// It builds a controlled demo workspace (fixture projects at a neutral path, a scripted stand-in for the coding agent, genuine REA), launches
// the Electron app with --capture-ui, drives it through the views listed in capture-ui.cjs and writes PNGs plus manifest.json to
// docs/assets/screenshots/. Every capture is checked for private data (home directory, user name, credentials) before it is saved.
// Review the images before publishing them; nothing is fabricated or retouched.
const { spawnSync, execFileSync } = require('node:child_process');
const { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const studio = path.resolve(__dirname, '..');
const repo = path.resolve(studio, '../..');
// A fixed, neutral location keeps machine-specific temp names and user names out of the screenshots.
const demo = process.env.ERA_CAPTURE_DEMO_DIR ?? '/private/tmp/era-studio-demo';
const out = process.env.ERA_CAPTURE_OUT ?? path.join(repo, 'docs', 'assets', 'screenshots');
if (!path.isAbsolute(demo) || demo.split(path.sep).length < 3) throw new Error('ERA_CAPTURE_DEMO_DIR must be an absolute path of its own');
rmSync(demo, { recursive: true, force: true });
mkdirSync(demo, { recursive: true });
mkdirSync(out, { recursive: true });
for (const [name, dir] of [['cart', 'buggy-app'], ['catalog', 'catalog-app']]) cpSync(path.join(repo, 'tests/fixtures/projects', dir), path.join(demo, name), { recursive: true });
// Real copies for the demo: the web UI as an analysis target, and a clone of this repository as the Improvement Lab's ERA checkout.
cpSync(path.join(repo, 'apps/studio/web'), path.join(demo, 'era-studio-web'), { recursive: true });
execFileSync('git', ['clone', '--quiet', '--no-hardlinks', repo, path.join(demo, 'era-checkout')], { stdio: 'inherit' });
execFileSync('cp', ['-c', '-R', path.join(repo, 'node_modules'), path.join(demo, 'era-checkout', 'node_modules')]);
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
writeFileSync(path.join(demo, 'era.config.json'), JSON.stringify({
  agents: { codex: { command: '/nonexistent/codex' }, 'claude-code': { command: '/nonexistent/claude' } },
  projectLab: { budget: { allowUnmeteredAgents: true }, customAgents: { fixture: { command: `${quote(process.execPath)} ${quote(path.join(repo, 'tests/fixtures/agents/team-agent.mjs'))} implementer`, simulated: true } } },
}));
const env = { ...process.env, ERA_STUDIO_CWD: demo, ERA_STATE_DIR: path.join(demo, 'state'), ERA_STUDIO_CAPTURE_OUT: out, ERA_STUDIO_CAPTURE_DEMO: demo };
delete env.NODE_TEST_CONTEXT;
delete env.ELECTRON_RUN_AS_NODE;
delete env.ERA_REA_BIN; // the genuinely installed REA; only the coding agent is a stand-in
try {
  const result = spawnSync(require('electron'), [studio, '--capture-ui'], { env, stdio: 'inherit', timeout: 900_000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (existsSync(demo)) rmSync(demo, { recursive: true, force: true });
}
