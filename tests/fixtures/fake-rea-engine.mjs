#!/usr/bin/env node
// FAKE reverse-engineering engine for end-to-end Improvement Lab tests. It is
// NOT REA and its output is NOT real reverse-engineering evidence. It mimics the
// shape of REA Evidence: JavaScript graphs come from a regex import scan, other
// operations return recorded fixtures. FAKE_REA_SLEEP_MS delays every response.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const sleep = Number(process.env.FAKE_REA_SLEEP_MS ?? 0);
const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
const fixture = (name) => JSON.parse(readFileSync(join(here, 'evidence', name), 'utf8'));
const id = (s) => `ev_${createHash('sha256').update(s).digest('hex')}`;

function walk(dir, base = dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else if (/\.(m|c)?js$/.test(e)) acc.push(relative(base, p));
  }
  return acc;
}

function jsGraph(root) {
  const files = walk(root).sort();
  const nodes = files.map((f) => ({ node_id: `n:${f}`, kind: 'javascript-module', observations: [{ label: f, properties: { semantic_role: 'source-module' } }] }));
  const edges = [];
  const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');
    for (const [, spec] of text.matchAll(re)) {
      if (spec.startsWith('.')) {
        const target = normalize(join(dirname(f), spec));
        edges.push({ relation: 'imports', source_node_id: `n:${f}`, properties: { kind: 'import', specifier: spec, resolved_path: existsSync(join(root, target)) ? target : null } });
      } else {
        edges.push({ relation: 'imports', source_node_id: `n:${f}`, properties: { kind: 'import', specifier: spec, resolved_path: null } });
        edges.push({ relation: 'imports', source_node_id: `n:${f}`, properties: { module_link_kind: 'import', specifier: spec, imported_name: '*', resolution_status: 'external' } });
      }
    }
  }
  return { evidence_id: id(root + files.join()), operation: 'analyze_javascript_application', provider: { id: 'fake', name: 'FAKE engine (tests only)', version: '0' }, subject: { digest: { sha256: createHash('sha256').update(files.join()).digest('hex') } }, limitations: ['FAKE engine output for tests'], normalized_result: { graph: { nodes, edges, coverage: { status: 'complete' } }, semantic_graph: { nodes: [], unknowns: [] }, limitations: [] } };
}

async function main() {
  if (sleep) await new Promise((r) => setTimeout(r, sleep));
  const [cmd, target] = args;
  if (cmd === '--version') return void process.stdout.write('0.0.0-fake-engine\n');
  if (cmd === 'providers') return out({ analysis_provider_candidates: [] });
  if (cmd === 'analyze-javascript-application') return out(jsGraph(target));
  if (cmd === 'inspect-macho') return out(fixture('hello.inspect-macho.json'));
  if (cmd === 'inspect-artifact') return out(fixture('js-app-zip.inspect-artifact.json'));
  if (cmd === 'function') return out(fixture('hello.function-greet.json'));
  if (cmd === 'capture-process') {
    const start = new Date();
    return out({ evidence_id: id(`capture${Date.now()}`), operation: 'capture_process_scenario', normalized_result: { exit: { code: 0, signal: 0, reason: 'exited' }, filesystem_effects: [], manifest: { started_at: start.toISOString(), completed_at: new Date(start.getTime() + 50).toISOString() } } });
  }
  out({ error: 'Analysis failed', code: 'unsupported_by_fake', message: `fake engine does not implement ${cmd}` });
  process.exitCode = 1;
}
main();
