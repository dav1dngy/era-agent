// MCP compatibility: a real JSON-RPC session (newline-delimited stdio) with the
// REA MCP server started through ERA's passthrough (`era rea mcp`), as MCP
// clients such as Claude Code or Codex would start it. Requires REA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DATASETS, ROOT, reaAvailable } from './helpers.js';

const skip = !reaAvailable() && 'REA engine not available';

function mcpSession() {
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'era.mjs'), 'rea', 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let next = 1;
  const request = (method, params, timeoutMs = 120_000) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  return { child, request, notify, close: () => child.kill('SIGTERM') };
}

test('REA MCP server through `era rea mcp`: initialize, tools/list and a real tools/call', { skip, timeout: 300_000 }, async () => {
  const s = mcpSession();
  try {
    const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'era-mcp-test', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'rea');
    s.notify('notifications/initialized', {});
    const list = await s.request('tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    for (const n of ['analyze_javascript_application', 'inspect_macho', 'open_binary', 'capture_process_scenario', 'export_evidence_bundle']) assert.ok(names.includes(n), n);
    assert.ok(names.length >= 150, `${names.length} tools`);
    const call = await s.request('tools/call', { name: 'analyze_javascript_application', arguments: { input_path: join(DATASETS, 'js-app'), detail: 'summary' } }, 240_000);
    assert.equal(call.result.isError ?? false, false, JSON.stringify(call.result).slice(0, 500));
    assert.match(JSON.stringify(call.result), /ev_[0-9a-f]{64}/, 'returns REA Evidence');
  } finally {
    s.close();
  }
});

test('`era rea mcp doctor` validates REA MCP startup and tool listing', { skip, timeout: 300_000 }, () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'era.mjs'), 'rea', 'mcp', 'doctor', '--format', 'json'], { encoding: 'utf8', timeout: 240_000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
