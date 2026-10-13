import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRules, graphView, ruleRuntime } from '../src/self_analysis/rules.js';
import { rankCandidates, buildProposal, renderInstructions, accuracyGaps } from '../src/improvement/planner.js';
import { loadEvidence } from './helpers.js';

const node = (id, label, props = {}) => ({ node_id: id, kind: 'javascript-module', observations: [{ label, properties: { semantic_role: 'source-module', ...props } }] });
const imp = (from, resolved, specifier = './x') => ({ relation: 'imports', source_node_id: from, properties: { kind: 'import', specifier, resolved_path: resolved } });

function syntheticEvidence() {
  return {
    evidence_id: 'ev_syn',
    normalized_result: {
      graph: {
        nodes: [node('b', 'bin/era.mjs'), node('c', 'src/cli.js'), node('d', 'src/dead.js'), node('t', 'tests/cli.test.js'), node('r', 'src/runner.js')],
        edges: [
          imp('b', 'src/cli.js'),
          imp('c', 'src/runner.js'),
          imp('c', null, './missing.js'),
          imp('t', 'src/cli.js'),
          { relation: 'imports', source_node_id: 'r', properties: { module_link_kind: 'import', specifier: 'node:child_process', imported_name: 'spawn', resolution_status: 'external' } },
        ],
      },
      semantic_graph: { nodes: [], unknowns: [] },
    },
  };
}

test('rules find unreachable, unresolved, untested and unguarded spawn modules', () => {
  const findings = runRules(syntheticEvidence(), null);
  const byRule = (r) => findings.filter((f) => f.rule === r).map((f) => f.subject);
  assert.deepEqual(byRule('unresolved-local-import'), ['src/cli.js->./missing.js']);
  assert.deepEqual(byRule('unreachable-module'), ['src/dead.js']);
  assert.deepEqual(byRule('untested-module').sort(), ['src/dead.js', 'src/runner.js']);
  assert.deepEqual(byRule('spawn-without-error-listener'), ['src/runner.js']);
  // Sorted by charter priority: reliability (2) before code-quality (6) before test coverage (10).
  assert.equal(findings[0].rule, 'unresolved-local-import');
  assert.equal(findings.at(-1).rule, 'untested-module');
});

test('error listeners suppress the spawn finding; finding IDs are stable', () => {
  const ev = syntheticEvidence();
  ev.normalized_result.semantic_graph.nodes.push({ kind: 'event', label: 'error', identity: { module_path: 'src/runner.js' } });
  const a = runRules(ev, null);
  assert.equal(a.filter((f) => f.rule === 'spawn-without-error-listener').length, 0);
  assert.deepEqual(runRules(syntheticEvidence(), null).map((f) => f.id), runRules(syntheticEvidence(), null).map((f) => f.id));
});

test('runtime rule flags slow startup, failures and filesystem effects', () => {
  const capture = (ms, code, effects = []) => ({ evidence_id: 'ev_rt', normalized_result: { exit: { code }, filesystem_effects: effects, manifest: { started_at: '2026-01-01T00:00:00.000Z', completed_at: new Date(Date.parse('2026-01-01T00:00:00.000Z') + ms).toISOString() } } });
  assert.deepEqual(ruleRuntime(capture(100, 0)), []);
  assert.deepEqual(ruleRuntime(capture(900, 1, [{}])).map((f) => f.rule), ['cli-help-failure', 'slow-startup', 'help-writes-files']);
  assert.deepEqual(ruleRuntime(null), []);
});

test('graphView reads real REA Evidence', () => {
  const g = graphView(loadEvidence('js-app.analyze.json'));
  assert.deepEqual(g.modules.sort(), ['src/config.js', 'src/main.js', 'src/net.js']);
  assert.ok(g.localEdges.some((e) => e.from === 'src/main.js' && e.to === 'src/net.js'));
  assert.ok(g.externalImports.some((i) => i.specifier === 'https'));
});

test('planner ranks accuracy gaps first and skips attempted findings', () => {
  const findings = runRules(syntheticEvidence(), null);
  const bench = { cases: [{ id: 'js', f1: 0.9, missing: ['export:a#b'], unexpected: [] }, { id: 'ok', f1: 1, missing: [], unexpected: [] }] };
  assert.equal(accuracyGaps(bench).length, 1);
  const ranked = rankCandidates(findings, bench);
  assert.equal(ranked[0].id, 'B-js');
  const acceptance = { minImprovement: { accuracy_f1: 0.01, startup_pct: 10 } };
  assert.deepEqual(buildProposal(ranked[0], acceptance).target, { metric: 'accuracy_f1', min_delta: 0.01 });
  const second = buildProposal(ranked[1], acceptance);
  assert.deepEqual(second.target, { metric: 'finding_resolved', finding_id: ranked[1].id });
  assert.ok(!rankCandidates(findings, bench, new Set(['B-js'])).some((c) => c.id === 'B-js'));
  assert.match(renderInstructions(second, { worktree: '/w', protectedPaths: ['src/safety/'] }), /Do not modify protected paths: src\/safety\//);
});

test('incomplete REA coverage is reported and suppresses absence-based rules', () => {
  const ev = syntheticEvidence();
  ev.normalized_result.graph.nodes.push({ node_id: 'u', kind: 'unknown', observations: [{ label: 'tests/x.test.js parse scope', properties: { path: 'tests/x.test.js', analysis_failure: { code: 'resource_constraint' } } }] });
  const findings = runRules(ev, null);
  const rules = new Set(findings.map((f) => f.rule));
  assert.ok(rules.has('incomplete-analysis-coverage'));
  assert.ok(!rules.has('untested-module'), 'untested findings must not be derived from incomplete coverage');
  assert.ok(rules.has('unreachable-module'), 'source coverage is still complete');
  assert.equal(findings[0].area, 'analysis-accuracy');
  ev.normalized_result.graph.nodes.push({ node_id: 'u2', kind: 'unknown', observations: [{ label: 'src/cli.js parse scope', properties: { path: 'src/cli.js', analysis_failure: { code: 'resource_constraint' } } }] });
  assert.ok(!runRules(ev, null).some((f) => f.rule === 'unreachable-module'));
});

test('unchanged filesystem entries are not effects', () => {
  const capture = { evidence_id: 'ev', normalized_result: { exit: { code: 0 }, filesystem_effects: [{ status: 'unchanged', path: 'a' }], manifest: {} } };
  assert.deepEqual(ruleRuntime(capture), []);
});

test('graphView merges several Evidence records', () => {
  const a = syntheticEvidence();
  const b = { evidence_id: 'ev_b', normalized_result: { graph: { nodes: [node('t2', 'tests/dead.test.js')], edges: [imp('t2', 'src/dead.js')] }, semantic_graph: { nodes: [], unknowns: [] } } };
  const g = graphView([a, b]);
  assert.ok(g.modules.includes('tests/dead.test.js'));
  assert.ok(!runRules([a, b], null).some((f) => f.rule === 'untested-module' && f.subject === 'src/dead.js'));
});
