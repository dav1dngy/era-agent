#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const studio = path.resolve(__dirname, '..');
const repo = path.resolve(studio, '../..');
const cwd = mkdtempSync(path.join(tmpdir(), 'era-studio-ui-'));
const out = path.join(studio, 'out', 'validation');
mkdirSync(out, { recursive: true });
const source = path.join(cwd, 'cart');
cpSync(path.join(repo, 'tests/fixtures/projects/buggy-app'), source, { recursive: true });
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
writeFileSync(path.join(cwd, 'era.config.json'), JSON.stringify({
  agents: { codex: { command: '/nonexistent/codex' }, 'claude-code': { command: '/nonexistent/claude' } },
  projectLab: { budget: { allowUnmeteredAgents: true }, customAgents: { fixture: { command: `${quote(process.execPath)} ${quote(path.join(repo, 'tests/fixtures/agents/team-agent.mjs'))} implementer`, simulated: true } } },
}));
const env = { ...process.env, ERA_STUDIO_CWD: cwd, ERA_STATE_DIR: path.join(cwd, 'state'), ERA_STUDIO_TEST_SOURCE: source, ERA_STUDIO_TEST_OUT: out };
delete env.NODE_TEST_CONTEXT;
delete env.ELECTRON_RUN_AS_NODE;
delete env.ERA_REA_BIN; // genuine installed REA; coding agent alone is simulated
try {
  const result = spawnSync(require('electron'), [studio, '--test-ui'], { env, stdio: 'inherit', timeout: 240_000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(cwd, { recursive: true, force: true }); }
