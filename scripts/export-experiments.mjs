#!/usr/bin/env node
// Copies improvement-cycle evidence from the local state directory (.era/) into
// experiments/cycles/ for publication: cycle records and reports, self-analysis
// reports, REA run records, and SHA-256 digests of the raw REA outputs (the raw
// Evidence files are large and stay in .era/runs/).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readLedger, decidedCycles } from '../src/orchestration/ledger.js';
import { anonymize } from './anonymize.mjs';
import { redactText } from '../src/safety/secrets.js';

const stateDir = process.env.ERA_STATE_DIR ?? '.era';
const outDir = process.argv[2] ?? 'experiments/cycles';
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
// Copies a text file with local paths anonymized.
const publish = (src, dest) => writeFileSync(dest, redactText(anonymize(readFileSync(src, 'utf8'))));

function exportRuns(runs, dest) {
  const manifest = [];
  for (const run of runs ?? []) {
    const recordFile = join(stateDir, 'runs', run.run_id, 'record.json');
    if (!existsSync(recordFile)) continue;
    mkdirSync(join(dest, 'rea-runs'), { recursive: true });
    publish(recordFile, join(dest, 'rea-runs', `${run.run_id}.json`));
    const out = join(stateDir, 'runs', run.run_id, 'output.json');
    manifest.push({ run_id: run.run_id, label: run.label, status: run.status, evidence_id: run.evidence_id, output_bytes: run.output_bytes, output_sha256: existsSync(out) ? sha(out) : null });
  }
  return manifest;
}

function exportSelf(selfId, dest) {
  const dir = join(stateDir, 'self-analyses', selfId);
  if (!existsSync(dir)) return;
  mkdirSync(dest, { recursive: true });
  for (const f of ['self-analysis.json', 'report.md']) if (existsSync(join(dir, f))) publish(join(dir, f), join(dest, f));
}

const events = readLedger(stateDir);
// One directory per cycle (a re-evaluated cycle is exported once, with its latest state).
const decided = decidedCycles(events);
decided.forEach((e, i) => {
  const src = join(stateDir, 'cycles', e.cycle_id);
  const dest = join(outDir, `${i + 1}-${e.cycle_id}`);
  mkdirSync(dest, { recursive: true });
  for (const f of ['cycle.json', 'report.md', 'instructions.md', 'change.patch']) if (existsSync(join(src, f))) publish(join(src, f), join(dest, f));
  const cycle = JSON.parse(readFileSync(join(src, 'cycle.json'), 'utf8'));
  exportSelf(cycle.baseline_self_analysis.id, join(dest, 'self-analysis-baseline'));
  if (cycle.evaluation?.candidate_self_analysis) exportSelf(cycle.evaluation.candidate_self_analysis.id, join(dest, 'self-analysis-candidate'));
  const runs = [...(cycle.baseline_self_analysis.runs ?? []), ...(cycle.evaluation?.candidate_self_analysis?.runs ?? [])];
  writeFileSync(join(dest, 'rea-outputs.json'), `${JSON.stringify(exportRuns(runs, dest), null, 2)}\n`);
  console.log(`exported ${e.cycle_id} -> ${dest}`);
});
publish(join(stateDir, 'ledger.jsonl'), join(outDir, 'ledger.jsonl'));
