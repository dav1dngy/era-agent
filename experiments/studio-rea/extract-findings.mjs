#!/usr/bin/env node
// Reads REA evidence (output.json of an analyze-javascript-application run recorded by `era analyze`) and lists the
// timers, listeners, awaited tasks and imports that matter for Studio performance analysis. Pure post-processing of REA output.
import { readFileSync, writeFileSync } from 'node:fs';
const [analysisFile, outFile] = process.argv.slice(2);
const a = JSON.parse(readFileSync(analysisFile, 'utf8'));
const run = a.runs[0];
const o = JSON.parse(readFileSync(run.output_file, 'utf8'));
const sg = o.normalized_result.semantic_graph;
const loc = (n) => `${n.identity.module_path}:${n.identity.source_range.start.line}`;
const by = (k) => sg.nodes.filter((n) => n.kind === k);
const out = {
  analysis_id: a.analysis_id,
  rea_command: run.command.join(' '),
  rea_version: a.engine.version,
  coverage: a.evidence[0].coverage,
  statistics: a.evidence[0].statistics,
  semantic_nodes: sg.nodes.length,
  semantic_relations: sg.relations.length,
  unknowns: sg.unknowns.length,
  imports_external: a.facts.filter((f) => f.startsWith('external:')),
  imports_unresolved: a.facts.filter((f) => f.startsWith('unresolved:')),
  timers: by('timer').map((n) => ({ at: loc(n), method: n.properties.method, delay_ms: n.properties.delay_milliseconds ?? null })),
  listeners: by('listener').map((n) => ({ at: loc(n), event: n.properties.event_name })),
  awaited_tasks: by('task').filter((n) => n.properties.method === 'await').map((n) => loc(n)),
  call_sites_by_module: Object.entries(by('call-site').reduce((m, n) => { m[n.identity.module_path] = (m[n.identity.module_path] ?? 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1]),
};
writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${outFile}: ${out.timers.length} timers, ${out.listeners.length} listeners, ${out.awaited_tasks.length} awaits`);
