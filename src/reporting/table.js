// Text rendering of benchmark results across versions.
const MB = 1024 * 1024;

const ROWS = [
  ['Accuracy (F1)', (a) => a.accuracy_f1.toFixed(3)],
  ['Precision', (a) => a.precision.toFixed(3)],
  ['Completeness (recall)', (a) => a.completeness_recall.toFixed(3)],
  ['Execution time (ms, Σ medians)', (a) => String(Math.round(a.total_median_wall_ms))],
  ['CPU time (s, Σ medians)', (a) => a.total_median_cpu_s.toFixed(2)],
  ['Peak memory (MB RSS)', (a) => (a.max_rss_bytes / MB).toFixed(1)],
  ['Error rate', (a) => a.error_rate.toFixed(3)],
  ['Reliability (deterministic cases)', (a) => a.reliability.toFixed(3)],
  ['REA executions per pass', (a) => String(a.rea_runs)],
];

export function renderBenchmarkTable(results, engineVersion) {
  const headers = ['Metric', ...results.map((r) => r.label ?? 'run')];
  const body = ROWS.map(([name, f]) => [name, ...results.map((r) => f(r.aggregate))]);
  const widths = headers.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  const out = [`ERA Benchmark Results (rea-agents ${engineVersion}, ${results[0]?.repetitions ?? '?'} repetitions per case)`, '', line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(line), ''];
  for (const r of results) {
    out.push(`${r.label}: ${r.cases.map((c) => `${c.id} F1=${c.f1.toFixed(3)}`).join(', ')}`);
  }
  return out.join('\n');
}

// ERA orchestration overhead relative to executing the same REA commands directly.
export function renderOverheadTable(eraResult, reaBaseline) {
  const lines = ['ERA vs direct REA execution (same REA commands, median wall ms)', '', 'Case                   REA direct   ERA analyze   Overhead'];
  for (const c of reaBaseline.cases) {
    const e = eraResult.cases.find((x) => x.id === c.id);
    if (!e) continue;
    const over = e.median_wall_ms - c.median_wall_ms;
    lines.push(`${c.id.padEnd(22)} ${String(Math.round(c.median_wall_ms)).padStart(10)}   ${String(Math.round(e.median_wall_ms)).padStart(11)}   ${over >= 0 ? '+' : ''}${Math.round(over)} ms (${((over / c.median_wall_ms) * 100).toFixed(1)}%)`);
  }
  return lines.join('\n');
}
