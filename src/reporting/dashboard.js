// Optional static HTML dashboard built from local state. No server, no network.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLedger } from '../orchestration/ledger.js';
import * as vm from '../orchestration/versions.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function readJsonDir(dir, file) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((d) => join(dir, d, file))
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, 'utf8')));
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}">none</td></tr>`}</tbody></table>`;
}

export async function renderDashboard({ config, rea }) {
  const stateDir = config.stateDirAbs;
  const root = await vm.repoRoot(config.cwd);
  const status = await rea.status();
  const events = readLedger(stateDir);
  const analyses = readJsonDir(join(stateDir, 'analyses'), 'analysis.json').slice(-20).reverse();
  const cycles = readJsonDir(join(stateDir, 'cycles'), 'cycle.json').reverse();
  const runsDir = join(stateDir, 'runs');
  const runs = readJsonDir(runsDir, 'record.json').slice(-30).reverse();
  const benchDir = join(stateDir, 'benchmarks');
  const latestBench = existsSync(benchDir) ? readdirSync(benchDir).sort().pop() : null;
  const bench = latestBench ? JSON.parse(readFileSync(join(benchDir, latestBench), 'utf8')) : null;

  const metricRows = bench ? Object.keys(bench.results[0].aggregate).map((k) => [k, ...bench.results.map((r) => (typeof r.aggregate[k] === 'number' ? +r.aggregate[k].toFixed(4) : r.aggregate[k]))]) : [];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ERA Dashboard</title>
<style>:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#e5e5ea;--ok:#1a7f37;--bad:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#f2f2f5;--muted:#a1a1a8;--line:#2c2c30;--ok:#4cc26d;--bad:#ff6b6b}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}p{color:var(--muted);margin:0}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:600}
.accepted{color:var(--ok)}.rejected,.failed{color:var(--bad)}</style></head><body>
<h1>ERA — Evolve &amp; Reverse Engineer Anything</h1>
<p>Version ${esc(root ? await vm.currentVersion(root) : 'n/a')} · REA ${esc(status.available ? status.version : 'unavailable')} · providers: ${esc((status.providers ?? []).map((p) => `${p.id}=${p.status}`).join(', '))} · generated ${esc(new Date().toISOString())}</p>
<h2>Improvement cycles</h2>${table(['Cycle', 'Status', 'Version', 'Finding', 'Area', 'Decision'], cycles.map((c) => [c.cycle_id, c.status, c.version ?? '', c.proposal.finding.title, c.proposal.area, c.evaluation?.summary ?? 'pending']))}
<h2>Latest benchmark ${esc(latestBench ?? '')}</h2>${table(['Metric', ...(bench?.results.map((r) => r.label) ?? [])], metricRows)}
<h2>Analyses</h2>${table(['Analysis', 'Target', 'Kind', 'Status', 'Facts'], analyses.map((a) => [a.analysis_id, a.target.path, a.target.kind, a.status, a.facts.length]))}
<h2>REA executions</h2>${table(['Run', 'Label', 'Command', 'Status', 'ms', 'Errors'], runs.map((r) => [r.run_id, r.label, r.command.slice(1, 3).join(' '), r.status, r.duration_ms, r.errors.join('; ')]))}
<h2>Ledger</h2>${table(['At', 'Event', 'Cycle', 'Detail'], events.map((e) => [e.at, e.type, e.cycle_id ?? '', e.summary ?? e.finding_id ?? e.reason ?? e.to ?? '']))}
</body></html>
`;
}
