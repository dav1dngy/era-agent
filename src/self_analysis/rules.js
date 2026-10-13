// Self-analysis rules (protected path). Each rule reads REA Evidence about ERA
// (static JavaScript application graph and runtime process capture) and emits
// findings with stable IDs, so a later REA run can verify whether a finding was
// resolved. The evaluator always applies the stable branch's copy of these rules,
// so an experiment cannot resolve a finding by editing the rule that reports it.
// Absence-based rules are suppressed when REA reports incomplete coverage,
// because REA's unavailable facts must not be read as absence.
import { sha256Text } from '../core/util.js';

// Improvement priorities from the project charter (lower = higher priority).
export const AREA_PRIORITY = {
  'analysis-accuracy': 1,
  reliability: 2,
  performance: 3,
  'tool-integration': 4,
  orchestration: 5,
  'code-quality': 6,
  'error-handling': 7,
  'resource-efficiency': 8,
  'context-management': 9,
  'test-coverage': 10,
};

export const THRESHOLDS = Object.freeze({
  maxLocalFanOut: 8,
  maxStartupMs: 400,
});

function finding(rule, area, subject, title, detail, evidenceIds) {
  return {
    id: `F-${sha256Text(`${rule}|${subject}`).slice(0, 10)}`,
    rule,
    area,
    priority: AREA_PRIORITY[area],
    subject,
    title,
    detail,
    evidence_ids: evidenceIds.filter(Boolean),
  };
}

export function graphView(evidenceList) {
  const list = Array.isArray(evidenceList) ? evidenceList : [evidenceList];
  const modules = new Set();
  const localEdges = [];
  const externalImports = [];
  const semNodes = [];
  const unknowns = [];
  const incomplete = new Map();
  for (const evidence of list) {
    const nr = evidence.normalized_result ?? {};
    const nodes = new Map();
    for (const n of nr.graph?.nodes ?? []) {
      const obs = n.observations?.[0];
      nodes.set(n.node_id, { kind: n.kind, label: obs?.label ?? null, props: obs?.properties ?? {} });
      for (const o of n.observations ?? []) {
        const failure = o.properties?.analysis_failure;
        if (n.kind === 'unknown' && failure && o.properties.path) incomplete.set(o.properties.path, failure.code ?? 'unknown');
      }
    }
    for (const n of nodes.values()) if (n.kind === 'javascript-module' && n.props.semantic_role === 'source-module') modules.add(n.label);
    const moduleOfNode = (id) => {
      const n = nodes.get(id);
      return n ? n.props.module_path ?? n.label?.split(':')[0] : null;
    };
    for (const e of nr.graph?.edges ?? []) {
      if (e.relation !== 'imports') continue;
      const p = e.properties ?? {};
      const from = moduleOfNode(e.source_node_id);
      if (p.kind && p.resolved_path) localEdges.push({ from, to: p.resolved_path, kind: p.kind });
      if (p.module_link_kind && p.resolution_status === 'external') externalImports.push({ from, specifier: p.specifier, imported: p.imported_name });
      if (p.kind && !p.resolved_path && p.specifier?.startsWith('.')) localEdges.push({ from, to: null, specifier: p.specifier, kind: p.kind });
    }
    semNodes.push(...(nr.semantic_graph?.nodes ?? []));
    unknowns.push(...(nr.semantic_graph?.unknowns ?? []));
  }
  return { modules: [...modules], localEdges, externalImports, semNodes, unknowns, incomplete, evidenceId: list.map((e) => e.evidence_id).join(',') };
}

const isSource = (m) => m.startsWith('src/');
const isTest = (m) => m.startsWith('tests/');
const isEntry = (m) => m.startsWith('bin/');

export function ruleIncompleteCoverage(g) {
  return [...g.incomplete].map(([path, code]) => finding('incomplete-analysis-coverage', 'analysis-accuracy', path, `REA analysis of ${path} is incomplete (${code})`, `REA reported ${code} for ${path}; its relationships are unavailable, so absence-based self-analysis rules are suppressed for this artifact.`, [g.evidenceId]));
}

const anyIncomplete = (g, pred) => [...g.incomplete.keys()].some(pred);

export function ruleUnresolvedImports(g) {
  return g.localEdges
    .filter((e) => e.to === null)
    .map((e) => finding('unresolved-local-import', 'reliability', `${e.from}->${e.specifier}`, `Unresolved local import in ${e.from}`, `REA could not resolve "${e.specifier}" imported by ${e.from} inside the packaged artifact.`, [g.evidenceId]));
}

export function ruleUnreachableModules(g) {
  if (anyIncomplete(g, (p) => isSource(p) || isEntry(p))) return [];
  const adj = new Map();
  for (const e of g.localEdges) if (e.to) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)).push(e.to);
  const seen = new Set();
  const queue = g.modules.filter(isEntry);
  while (queue.length) {
    const m = queue.shift();
    if (seen.has(m)) continue;
    seen.add(m);
    queue.push(...(adj.get(m) ?? []));
  }
  return g.modules
    .filter((m) => isSource(m) && !seen.has(m))
    .map((m) => finding('unreachable-module', 'code-quality', m, `Module not reachable from the CLI entrypoint: ${m}`, `No static import path from bin/ reaches ${m} in REA's application graph; it is dead code or loaded dynamically.`, [g.evidenceId]));
}

export function ruleUntestedModules(g) {
  if (anyIncomplete(g, isTest)) return [];
  const tested = new Set(g.localEdges.filter((e) => e.to && isTest(e.from)).map((e) => e.to));
  return g.modules
    .filter((m) => isSource(m) && !tested.has(m))
    .map((m) => finding('untested-module', 'test-coverage', m, `No test module imports ${m}`, `REA's import graph shows no edge from tests/ to ${m}.`, [g.evidenceId]));
}

export function ruleSpawnWithoutErrorListener(g) {
  const spawners = new Set(g.externalImports.filter((i) => /child_process$/.test(i.specifier ?? '') && ['spawn', 'execFile', 'exec', 'fork', '*'].includes(i.imported)).map((i) => i.from));
  const withErrorListener = new Set(g.semNodes.filter((n) => n.kind === 'event' && n.label === 'error').map((n) => n.identity?.module_path));
  return [...spawners]
    .filter((m) => !withErrorListener.has(m))
    .map((m) => finding('spawn-without-error-listener', 'error-handling', m, `Child process spawned without an 'error' listener in ${m}`, `REA shows ${m} imports a child_process launcher but registers no 'error' event listener; spawn failures (ENOENT, EACCES) would surface as unhandled errors.`, [g.evidenceId]));
}

export function ruleHighFanOut(g) {
  const out = new Map();
  for (const e of g.localEdges) if (e.to) out.set(e.from, new Set([...(out.get(e.from) ?? []), e.to]));
  return [...out]
    .filter(([m, targets]) => (isSource(m) || isEntry(m)) && targets.size > THRESHOLDS.maxLocalFanOut)
    .map(([m, targets]) => finding('high-fan-out', 'orchestration', m, `High local fan-out in ${m} (${targets.size} modules)`, `${m} statically imports ${targets.size} local modules (threshold ${THRESHOLDS.maxLocalFanOut}); every invocation loads all of them.`, [g.evidenceId]));
}

export function ruleRuntime(capture) {
  if (!capture) return [];
  const nr = capture.normalized_result ?? {};
  const findings = [];
  const started = Date.parse(nr.manifest?.started_at);
  const completed = Date.parse(nr.manifest?.completed_at);
  const elapsed = Number.isFinite(started) && Number.isFinite(completed) ? completed - started : null;
  if (nr.exit?.code !== 0) {
    findings.push(finding('cli-help-failure', 'reliability', 'bin/era.mjs --help', 'CLI help exits unsuccessfully', `REA process capture observed exit ${JSON.stringify(nr.exit)} for \`era --help\`.`, [capture.evidence_id]));
  }
  if (elapsed !== null && elapsed > THRESHOLDS.maxStartupMs) {
    findings.push(finding('slow-startup', 'performance', 'bin/era.mjs --help', `CLI startup took ${elapsed} ms`, `REA process capture measured ${elapsed} ms for \`era --help\` (threshold ${THRESHOLDS.maxStartupMs} ms).`, [capture.evidence_id]));
  }
  const changed = (nr.filesystem_effects ?? []).filter((e) => e.status !== 'unchanged');
  if (changed.length > 0) {
    findings.push(finding('help-writes-files', 'resource-efficiency', 'bin/era.mjs --help', '`era --help` modifies the filesystem', `REA observed ${changed.length} changed filesystem entries while printing help (${changed.slice(0, 3).map((e) => `${e.status} ${e.path}`).join(', ')}).`, [capture.evidence_id]));
  }
  return findings;
}

export function runRules(jsEvidence, captureEvidence) {
  const g = graphView(jsEvidence);
  const all = [
    ...ruleIncompleteCoverage(g),
    ...ruleUnresolvedImports(g),
    ...ruleUnreachableModules(g),
    ...ruleSpawnWithoutErrorListener(g),
    ...ruleHighFanOut(g),
    ...ruleUntestedModules(g),
    ...ruleRuntime(captureEvidence),
  ];
  return all.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
