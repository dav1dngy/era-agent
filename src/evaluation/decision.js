// Acceptance decision (protected path). Criteria come from
// benchmarks/acceptance.json in the stable checkout, never from the candidate.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadAcceptance(stableRoot) {
  return JSON.parse(readFileSync(join(stableRoot, 'benchmarks', 'acceptance.json'), 'utf8'));
}

const pct = (base, cand) => (base === 0 ? 0 : ((cand - base) / base) * 100);

export function evaluateTarget(target, ctx) {
  const { baseline, candidate, baselineSelf, candidateSelf, baselineTests, candidateTests } = ctx;
  switch (target.metric) {
    case 'accuracy_f1': {
      const delta = candidate.aggregate.accuracy_f1 - baseline.aggregate.accuracy_f1;
      return { met: delta >= target.min_delta, observed: `accuracy F1 ${baseline.aggregate.accuracy_f1.toFixed(4)} -> ${candidate.aggregate.accuracy_f1.toFixed(4)} (Δ ${delta.toFixed(4)}, need ≥ ${target.min_delta})` };
    }
    case 'total_median_wall_ms': {
      const change = pct(baseline.aggregate.total_median_wall_ms, candidate.aggregate.total_median_wall_ms);
      return { met: -change >= target.min_delta, observed: `benchmark time ${baseline.aggregate.total_median_wall_ms} -> ${candidate.aggregate.total_median_wall_ms} ms (${change.toFixed(1)}%, need ≤ -${target.min_delta}%)` };
    }
    case 'startup_ms': {
      const b = baselineSelf.metrics.startup_ms;
      const c = candidateSelf.metrics.startup_ms;
      const change = pct(b, c);
      return { met: b !== null && c !== null && -change >= target.min_delta, observed: `REA-measured \`era --help\` runtime ${b} -> ${c} ms (${change.toFixed(1)}%, need ≤ -${target.min_delta}%)` };
    }
    case 'finding_resolved': {
      const still = candidateSelf.findings.some((f) => f.id === target.finding_id);
      return { met: !still, observed: `finding ${target.finding_id} ${still ? 'still present' : 'absent'} in candidate REA self-analysis` };
    }
    case 'test_count': {
      const delta = (candidateTests.passed ?? 0) - (baselineTests.passed ?? 0);
      return { met: delta >= target.min_delta, observed: `passing tests ${baselineTests.passed} -> ${candidateTests.passed} (Δ ${delta}, need ≥ ${target.min_delta})` };
    }
    default:
      return { met: false, observed: `unknown target metric "${target.metric}"` };
  }
}

export function decide(ctx, acceptance) {
  const { baseline, candidate, candidateTests, protectedChanged, baselineSelf, candidateSelf, proposal } = ctx;
  const b = baseline.aggregate;
  const c = candidate.aggregate;
  const guards = [
    { name: 'protected paths unchanged', ok: protectedChanged.length === 0, detail: protectedChanged.join(', ') || 'none changed' },
    { name: 'all tests pass', ok: candidateTests.ok, detail: `${candidateTests.passed ?? 0} passed, ${candidateTests.failed ?? '?'} failed` },
    { name: 'no accuracy regression', ok: c.accuracy_f1 >= b.accuracy_f1 - acceptance.maxAccuracyDrop, detail: `${b.accuracy_f1.toFixed(4)} -> ${c.accuracy_f1.toFixed(4)}` },
    { name: 'no error-rate increase', ok: c.error_rate <= b.error_rate + acceptance.maxErrorRateIncrease, detail: `${b.error_rate} -> ${c.error_rate}` },
    { name: 'no reliability regression', ok: c.reliability >= b.reliability, detail: `${b.reliability} -> ${c.reliability}` },
    { name: `time regression ≤ ${acceptance.maxTimeRegressionPct}%`, ok: pct(b.total_median_wall_ms, c.total_median_wall_ms) <= acceptance.maxTimeRegressionPct, detail: `${b.total_median_wall_ms} -> ${c.total_median_wall_ms} ms` },
    { name: `memory regression ≤ ${acceptance.maxMemoryRegressionPct}%`, ok: pct(b.max_rss_bytes, c.max_rss_bytes) <= acceptance.maxMemoryRegressionPct, detail: `${b.max_rss_bytes} -> ${c.max_rss_bytes} bytes` },
    { name: 'self-analysis findings not increased', ok: candidateSelf.findings.length <= baselineSelf.findings.length, detail: `${baselineSelf.findings.length} -> ${candidateSelf.findings.length}` },
    { name: 'self-analysis covers every source module', ok: (candidateSelf.missing_modules ?? []).length === 0, detail: (candidateSelf.missing_modules ?? []).join(', ') || 'complete' },
  ];
  const target = evaluateTarget(proposal.target, ctx);
  const accepted = guards.every((g) => g.ok) && target.met;
  return { accepted, guards, target, summary: accepted ? 'accepted: all guards pass and target met' : `rejected: ${[...guards.filter((g) => !g.ok).map((g) => g.name), ...(target.met ? [] : ['target not met'])].join('; ')}` };
}
