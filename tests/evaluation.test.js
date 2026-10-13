import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFacts } from '../src/evaluation/score.js';
import { decide, evaluateTarget, loadAcceptance } from '../src/evaluation/decision.js';
import { parseTapSummary } from '../src/evaluation/tests.js';
import { loadManifest } from '../src/evaluation/benchmark.js';
import { ROOT, DATASETS } from './helpers.js';

test('scoreFacts computes precision, recall and F1 within truth categories', () => {
  const s = scoreFacts(['module:a', 'module:b', 'extra:z', 'import:a->b'], ['module:a', 'module:c', 'import:a->b']);
  assert.equal(s.precision, 2 / 3);
  assert.equal(s.recall, 2 / 3);
  assert.ok(Math.abs(s.f1 - 2 / 3) < 1e-12);
  assert.deepEqual(s.missing, ['module:c']);
  assert.deepEqual(s.unexpected, ['module:b']);
  assert.equal(s.per_category.import.f1, 1);
});

test('scoreFacts handles empty predictions', () => {
  const s = scoreFacts([], ['module:a']);
  assert.equal(s.f1, 0);
  assert.equal(scoreFacts([], []).f1, 1);
});

test('parseTapSummary reads node:test TAP summary', () => {
  const s = parseTapSummary('ok 1 - a\n# tests 5\n# suites 0\n# pass 4\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 12.5\n');
  assert.deepEqual(s, { tests: 5, passed: 4, failed: 1, skipped: 0, cancelled: 0, duration_ms: 12.5 });
});

test('benchmark manifest and acceptance criteria load', () => {
  const cases = loadManifest(DATASETS);
  assert.ok(cases.length >= 4);
  for (const c of cases) assert.ok(c.truth.length > 0, c.id);
  const a = loadAcceptance(ROOT);
  assert.equal(a.maxAccuracyDrop, 0);
});

const okCases = [{ id: 'x', error_rate: 0, succeeded: 3, repetitions: 3 }];
const agg = (o = {}, cases = okCases) => ({ cases, aggregate: { accuracy_f1: 0.8, error_rate: 0, reliability: 1, total_median_wall_ms: 1000, max_rss_bytes: 100, ...o } });
const inv = (...names) => names.map((n) => ({ name: n, status: 'pass' }));
const acceptance = { maxAccuracyDrop: 0, maxErrorRateIncrease: 0, maxTimeRegressionPct: 15, maxMemoryRegressionPct: 20, minImprovement: { accuracy_f1: 0.01, startup_pct: 10 } };
const ctx = (over = {}) => ({
  baseline: agg(),
  candidate: agg({ accuracy_f1: 0.9 }),
  baselineTests: { ok: true, passed: 2, inventory: inv('a', 'b') },
  candidateTests: { ok: true, passed: 3, inventory: inv('a', 'b', 'c') },
  baselineSelf: { findings: [{ id: 'F-1' }, { id: 'F-2' }], metrics: { startup_ms: 200 } },
  candidateSelf: { findings: [{ id: 'F-2' }], metrics: { startup_ms: 150 } },
  protectedChanged: [],
  proposal: { target: { metric: 'accuracy_f1', min_delta: 0.01 } },
  ...over,
});

test('decide accepts when guards pass and target is met', () => {
  const d = decide(ctx(), acceptance);
  assert.equal(d.accepted, true, d.summary);
});

test('decide rejects protected-path changes, failing tests and regressions', () => {
  assert.equal(decide(ctx({ protectedChanged: ['src/safety/policy.js'] }), acceptance).accepted, false);
  assert.equal(decide(ctx({ candidateTests: { ok: false, passed: 9, failed: 1, inventory: inv('a', 'b') } }), acceptance).accepted, false);
  assert.equal(decide(ctx({ candidate: agg({ accuracy_f1: 0.79 }), proposal: { target: { metric: 'finding_resolved', finding_id: 'F-1' } } }), acceptance).accepted, false);
  assert.equal(decide(ctx({ candidate: agg({ accuracy_f1: 0.9, total_median_wall_ms: 1200 }) }), acceptance).accepted, false);
  assert.equal(decide(ctx({ candidate: agg({ accuracy_f1: 0.9, error_rate: 0.1 }) }), acceptance).accepted, false);
  assert.equal(decide(ctx({ candidateSelf: { findings: [{ id: 'F-2' }, { id: 'F-3' }, { id: 'F-4' }], metrics: {} } }), acceptance).accepted, false);
  assert.equal(decide(ctx({ candidateSelf: { findings: [], missing_modules: ['src/cli.js'], metrics: {} } }), acceptance).accepted, false);
});

test('decide rejects when the target is not met', () => {
  const d = decide(ctx({ candidate: agg({ accuracy_f1: 0.805 }) }), acceptance);
  assert.equal(d.accepted, false);
  assert.match(d.summary, /target not met/);
});

test('evaluateTarget supports finding, startup and test-count targets', () => {
  assert.equal(evaluateTarget({ metric: 'finding_resolved', finding_id: 'F-1' }, ctx()).met, true);
  assert.equal(evaluateTarget({ metric: 'finding_resolved', finding_id: 'F-2' }, ctx()).met, false);
  assert.equal(evaluateTarget({ metric: 'startup_ms', min_delta: 10 }, ctx()).met, true);
  assert.equal(evaluateTarget({ metric: 'startup_ms', min_delta: 30 }, ctx()).met, false);
  assert.equal(evaluateTarget({ metric: 'test_count', min_delta: 1 }, ctx()).met, true);
  assert.equal(evaluateTarget({ metric: 'nope' }, ctx()).met, false);
});

test('equal benchmark failures on both sides are inconclusive, never accepted', () => {
  const broken = [{ id: 'native', error_rate: 0.4, succeeded: 1, repetitions: 3 }];
  const d = decide(ctx({ baseline: agg({ error_rate: 0.4, reliability: 0.6 }, broken), candidate: agg({ accuracy_f1: 0.9, error_rate: 0.4, reliability: 0.6 }, broken), proposal: { target: { metric: 'finding_resolved', finding_id: 'F-1' } } }), acceptance);
  assert.equal(d.accepted, false);
  assert.equal(d.inconclusive, true);
  assert.match(d.summary, /inconclusive: baseline benchmark cases failed: native/);
});

test('an empty baseline test inventory is inconclusive', () => {
  const d = decide(ctx({ baselineTests: { ok: false, passed: null, inventory: [] } }), acceptance);
  assert.equal(d.inconclusive, true);
});

test('removing, skipping or breaking baseline tests is rejected; repairing a failing baseline test is allowed', () => {
  const removed = decide(ctx({ candidateTests: { ok: true, passed: 1, inventory: inv('a') } }), acceptance);
  assert.equal(removed.accepted, false);
  assert.match(removed.summary, /no baseline test removed/);
  const skipped = decide(ctx({ candidateTests: { ok: true, passed: 1, inventory: [{ name: 'a', status: 'pass' }, { name: 'b', status: 'skip' }] } }), acceptance);
  assert.equal(skipped.accepted, false);
  const repaired = decide(ctx({ baselineTests: { ok: false, passed: 1, failed: 1, inventory: [{ name: 'a', status: 'pass' }, { name: 'b', status: 'fail' }] }, candidateTests: { ok: true, passed: 2, inventory: inv('a', 'b') } }), acceptance);
  assert.equal(repaired.accepted, true, repaired.summary);
});

test('parseTapTests reads top-level results including skips', async () => {
  const { parseTapTests } = await import('../src/evaluation/tests.js');
  const t = parseTapTests('ok 1 - alpha\n    ok 1 - sub\nnot ok 2 - beta\nok 3 - gamma # SKIP no sandbox\n');
  assert.deepEqual(t, [{ name: 'alpha', status: 'pass' }, { name: 'beta', status: 'fail' }, { name: 'gamma', status: 'skip' }]);
});

test('benchmark provenance identifies the exact commit, data and engine (audit F09)', async () => {
  const { benchmarkProvenance } = await import('../src/evaluation/benchmark.js');
  const p = await benchmarkProvenance({ codeRoot: ROOT, datasetsDir: DATASETS, rea: null });
  assert.match(p.commit, /^[0-9a-f]{40}$/);
  assert.match(p.tree, /^[0-9a-f]{40}$/);
  assert.match(p.datasets_sha256, /^[0-9a-f]{64}$/);
  assert.equal(typeof p.dirty, 'boolean');
  assert.ok(p.describe.length > 0);
});
