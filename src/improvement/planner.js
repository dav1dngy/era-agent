// Improvement Planner: turns REA-derived findings and benchmark gaps into one
// testable hypothesis with a predeclared target metric.
import { AREA_PRIORITY } from '../self_analysis/rules.js';

const HYPOTHESES = {
  'unresolved-local-import': (f) => `Resolving ${f.subject} removes a load-time failure path; REA will resolve every local import.`,
  'cli-help-failure': () => '`era --help` should exit 0; fixing it restores the basic CLI contract.',
  'slow-startup': () => 'Deferring module loading until a command needs it reduces CLI startup time measured by REA process capture.',
  'unreachable-module': (f) => `Wiring up or removing ${f.subject} eliminates dead code reported by REA's reachability graph.`,
  'high-fan-out': (f) => `Splitting ${f.subject} so commands load their modules lazily reduces coupling flagged by REA.`,
  'spawn-without-error-listener': (f) => `Handling the child-process 'error' event in ${f.subject} turns spawn failures into recorded errors instead of crashes.`,
  'help-writes-files': () => '`era --help` should be side-effect free.',
  'untested-module': (f) => `Adding a test that imports ${f.subject} closes a coverage gap REA found in the import graph.`,
};

function targetFor(finding, acceptance) {
  if (finding.rule === 'slow-startup') return { metric: 'startup_ms', min_delta: acceptance.minImprovement.startup_pct };
  return { metric: 'finding_resolved', finding_id: finding.id };
}

export function accuracyGaps(benchmark) {
  if (!benchmark) return [];
  return benchmark.cases
    .filter((c) => c.f1 < 1)
    .map((c) => ({
      id: `B-${c.id}`,
      rule: 'benchmark-accuracy-gap',
      area: 'analysis-accuracy',
      priority: AREA_PRIORITY['analysis-accuracy'],
      subject: c.id,
      title: `Benchmark case ${c.id} scores F1 ${c.f1.toFixed(3)}`,
      detail: `Missing facts: ${c.missing.join(', ') || 'none'}; unexpected facts: ${c.unexpected.join(', ') || 'none'}.`,
      evidence_ids: [],
    }));
}

export function rankCandidates(findings, benchmark, attemptedIds = new Set()) {
  return [...accuracyGaps(benchmark), ...findings]
    .filter((f) => !attemptedIds.has(f.id))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function buildProposal(candidate, acceptance) {
  const isAccuracy = candidate.rule === 'benchmark-accuracy-gap';
  return {
    finding: candidate,
    area: candidate.area,
    hypothesis: isAccuracy
      ? `Improving ERA's interpretation of REA Evidence for ${candidate.subject} raises benchmark accuracy. ${candidate.detail}`
      : HYPOTHESES[candidate.rule]?.(candidate) ?? candidate.title,
    target: isAccuracy ? { metric: 'accuracy_f1', min_delta: acceptance.minImprovement.accuracy_f1 } : targetFor(candidate, acceptance),
  };
}

export function renderInstructions(proposal, { worktree, protectedPaths }) {
  return [
    `# ERA improvement proposal`,
    '',
    `Work only inside: ${worktree}`,
    '',
    `## Finding (${proposal.finding.id}, ${proposal.area})`,
    proposal.finding.title,
    '',
    proposal.finding.detail,
    proposal.finding.evidence_ids.length ? `\nREA Evidence: ${proposal.finding.evidence_ids.join(', ')}` : '',
    '',
    '## Hypothesis',
    proposal.hypothesis,
    '',
    '## Acceptance target',
    JSON.stringify(proposal.target),
    '',
    '## Constraints',
    `- Do not modify protected paths: ${protectedPaths.join(', ')}`,
    '- Keep `node --test tests/*.test.js` passing.',
    '- Commit your change on the current branch when finished.',
    '',
  ].join('\n');
}
