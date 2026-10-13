// Markdown reports for Project Lab runs. Everything is rendered from the run
// record: nothing here invents data.
import { redactText } from '../safety/secrets.js';

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const loc = (l) => `${l.file}${l.line ? `:${l.line}` : ''}`;
const cmdLine = (r) => `\`${r.command}\` → ${r.timed_out ? 'timed out' : r.spawn_error ? `did not start (${r.spawn_error})` : `exit ${r.exit_code}`}${r.command_source && r.command_source !== 'configured' ? ` _(${r.command_source})_` : ''}`;

function header(project, run, title) {
  return [
    `# ${title}: ${project.id}`,
    '',
    `- Run: \`${run.run_id}\` (${run.op}) — status **${run.status}**`,
    `- Source: ${project.source ? `\`${project.source}\`` : '—'}${project.reference ? `; reference: \`${project.reference}\`` : ''}${project.destination ? `; destination: \`${project.destination}\`` : ''}`,
    `- Task: ${project.task || '—'}`,
    `- Coding agent: ${run.agent ?? project.agent ?? 'manual'}; cost reported: ${totalCost(run)}`,
    '',
  ];
}

function totalCost(run) {
  const costs = [...Object.values(run.results ?? {})].flatMap((r) => [r?.cost_usd]).filter((c) => typeof c === 'number');
  const attempt = (run.attempts ?? []).map((a) => a.cost_usd).filter((c) => typeof c === 'number');
  const sum = [...costs, ...attempt].reduce((s, c) => s + c, 0);
  return sum > 0 ? `$${sum.toFixed(4)}` : 'none (unmetered or no agent)';
}

function verification(v) {
  if (!v) return ['- not run'];
  return [...v.build, ...v.test, ...v.acceptance].map((r) => `- ${r.kind}: ${cmdLine(r)}`);
}

export function renderReview(project, run) {
  const d = run.results.detect;
  const f = run.results.findings;
  const a = run.results.analysis;
  const ag = run.results['agent-review'];
  const out = [...header(project, run, 'Project review')];
  if (!f) return [...out, '_The review did not finish._'].join('\n');
  out.push(`## Summary`, '', `Findings: ${SEV_ORDER.map((s) => `${f.counts[s]} ${s}`).join(', ')}.`, `The original project was ${f.source_unmodified ? '**not modified** (content digest identical before and after)' : '**MODIFIED — isolation violation**'}: \`${f.source_digest?.slice(0, 16)}…\`.`, '');
  out.push('## Project', '', `- Languages: ${Object.entries(d.languages).map(([l, v]) => `${l} (${v.files})`).join(', ') || 'none'}; frameworks: ${d.frameworks.join(', ') || 'none'}; test frameworks: ${d.test_frameworks.join(', ') || 'none'}; ${d.test_file_count} test files; ${d.file_count} files.`, ...d.notes.map((n) => `- Note: ${n}`), '');
  out.push('## Baseline', '', ...verification(run.results.baseline), '');
  out.push('## Analysis', '', a.rea?.ran ? `- REA analyzed ${a.rea.modules} modules in ${a.rea.passes} pass(es); ${a.rea.external_dependencies.length} external dependencies; evidence IDs: ${a.rea.evidence_ids.map((e) => `\`${e.slice(0, 20)}…\``).join(', ')}.` : `- REA: not used — ${a.rea?.reason}.`, ...(a.rea?.limitations ?? []).map((l) => `- REA limitation: ${l}`), ag?.ran ? `- Coding-agent review by \`${ag.agent}\`: ${ag.accepted.length} finding(s) accepted, ${ag.rejected.length} rejected as unverifiable${typeof ag.cost_usd === 'number' ? `, cost $${ag.cost_usd.toFixed(4)}` : ''}.` : `- Coding-agent review: not performed — ${ag?.error ?? ag?.reason}.`, '');
  out.push('## Findings', '');
  for (const sev of SEV_ORDER) {
    const list = f.findings.filter((x) => x.severity === sev);
    if (!list.length) continue;
    out.push(`### ${sev[0].toUpperCase()}${sev.slice(1)} (${list.length})`, '');
    for (const x of list) {
      out.push(`- **${x.title}** — ${x.category}, source: ${x.source}, confidence: ${x.confidence}${x.verified === true ? ', snippet verified' : x.verified === false ? ', snippet NOT found in file' : ''}`);
      out.push(`  - Where: ${x.locations.length ? x.locations.map(loc).join(', ') : 'project level'}`);
      out.push(`  - Evidence: ${redactText(x.evidence).split('\n').join(' ⏎ ')}`);
      if (x.detail) out.push(`  - ${x.detail}`);
      if (x.recommendation) out.push(`  - Recommendation: ${x.recommendation}`);
    }
    out.push('');
  }
  if (ag?.rejected?.length) out.push('## Agent findings rejected', '', ...ag.rejected.map((r) => `- ${r.title ?? '(untitled)'}: ${r.reason}`), '');
  out.push('_Heuristic static findings are pattern matches, not confirmed vulnerabilities. Static analysis does not prove runtime behavior._');
  return out.join('\n');
}

function changeSection(fin) {
  return [
    '## Change',
    '',
    `- Files changed: ${fin.files.length}${fin.files.length ? ` (${fin.files.map((f) => `${f.status} ${f.path}`).slice(0, 15).join(', ')})` : ''}`,
    fin.stat ? '```\n' + fin.stat + '\n```' : '',
    fin.patch_file ? `- Reviewable diff: \`${fin.patch_file}\` (sha256 \`${fin.patch_sha256.slice(0, 16)}…\`)` : '',
    '',
  ];
}

// Multi-agent section: who did what, what they received and what leaves this machine.
function teamSection(run) {
  const fin = run.results.finalize;
  const roles = run.team?.roles ?? fin?.team?.roles;
  if (!roles) return [];
  const out = ['## Team', '', '| Role | Agent |', '|---|---|', ...Object.entries(roles).map(([r, a]) => `| ${r} | ${a ?? '—'} |`), ''];
  if (fin?.team?.independence) out.push(`Review independence: ${fin.team.independence}.`, '');
  const ex = run.exposure;
  if (ex) out.push('### Data exposure', '', ex.remote_providers.length ? `- Source code was made available to remote provider(s): ${ex.remote_providers.join(', ')} (authorized by the user: ${ex.consented_providers.join(', ') || 'none'}).` : '- No remote provider received project content.', `- Withheld from agents: ${ex.withheld_files.length ? ex.withheld_files.slice(0, 10).join('; ') : 'nothing needed withholding'}.`, ...(ex.secret_content_files.length ? [`- Secret-looking content in: ${ex.secret_content_files.join('; ')} (${ex.secret_content_allowed ? 'allowed by the user' : 'blocked'}).`] : []), '');
  const design = run.results.architecture;
  if (design) out.push('### Architecture', '', `By \`${design.agent}\`${design.parsed ? '' : ' (output was not structured JSON; shown as text)'}${typeof design.cost_usd === 'number' ? `, cost $${design.cost_usd.toFixed(4)}` : ''}: ${design.design.summary || '(no summary)'}`, '', `${design.design.files.length} file(s) planned; full design in \`handoffs/design.md\`.`, '');
  const review = fin?.review;
  if (review) {
    out.push('### Independent review', '', `Reviewer \`${review.reviewer}\`; blocking threshold: ${review.block_on}; correction rounds used: ${review.corrections}.`, '');
    for (const r of review.rounds) out.push(`- Round ${r.round}: ${r.accepted.length} finding(s) accepted, ${r.rejected.length} rejected as unverifiable, ${r.blocking.length} blocking.${typeof r.cost_usd === 'number' ? ` Cost $${r.cost_usd.toFixed(4)}.` : ''}`, ...r.accepted.slice(0, 8).map((f) => `  - [${f.severity}] ${f.title} (${f.locations[0]?.file ?? '?'}${f.locations[0]?.line ? `:${f.locations[0].line}` : ''})`));
    out.push('', review.unresolved.length ? `**Unresolved blocking findings: ${review.unresolved.length}.**` : 'No unresolved blocking findings.', '');
  }
  if (run.handoffs?.length) out.push('### Hand-offs', '', '| From | To | Artifact | sha256 |', '|---|---|---|---|', ...run.handoffs.map((h) => `| ${h.from} | ${h.to} | \`${h.artifact}\` | \`${h.sha256.slice(0, 12)}…\` |`), '');
  return out;
}

export function renderModify(project, run) {
  const fin = run.results.finalize;
  const out = [...header(project, run, 'Project modification')];
  const base = run.results.baseline;
  out.push('## Baseline', '', ...verification(base), '');
  const an = run.results.analysis;
  if (an) out.push('## Analysis', '', an.rea?.ran ? `- REA analyzed ${an.rea.modules} modules in ${an.rea.passes} pass(es); evidence IDs ${an.rea.evidence_ids.map((e) => `\`${e.slice(0, 20)}…\``).join(', ')}.` : `- REA: not used — ${an.rea?.reason}.`, `- ${an.static.length} static finding(s) of severity low or above (see \`era project review\` for the full list).`, '');
  if (run.results.plan) out.push('## Plan', '', `See \`plan.md\` (${run.results.plan.relevant_files.length} relevant file hint(s)).`, '');
  out.push(...teamSection(run));
  out.push('## Attempts', '', ...(run.attempts.length ? run.attempts.map((a) => `- Attempt ${a.n} (${a.agent}): ${a.pass ? '**passed verification**' : `failed — ${a.reasons.join(' ')}`}`) : ['- none']), '');
  if (!fin) return [...out, `_The run is ${run.status}${run.error ? `: ${run.error}` : ''}._`].join('\n');
  out.push('## Decision', '', fin.pass ? '**Accepted for review**: every acceptance check passed and no regression was detected. Nothing has been applied to the original project.' : `**Rejected**:\n${fin.reasons.map((r) => `- ${r}`).join('\n')}`, '');
  if (fin.warnings.length) out.push('### Warnings', '', ...fin.warnings.map((w) => `- ${w}`), '');
  out.push('## Verification after the change', '', ...verification(fin.verification), '');
  if (fin.verification?.tests && base.tests) out.push(`- Tests: ${base.tests.passed.length} passed / ${base.tests.failed.length} failed at baseline → ${fin.verification.tests.passed.length} passed / ${fin.verification.tests.failed.length} failed now.`, '');
  out.push(...changeSection(fin));
  out.push(fin.pass ? `Approve with \`era project approve ${project.id}\` to apply the diff to the original project (reversible with \`era project rollback ${project.id}\`).` : `Resume with \`era project resume ${project.id}\` after adjusting, or discard with \`era project cancel ${project.id}\`.`);
  return out.join('\n');
}

export function renderRebuild(project, run) {
  const fin = run.results.finalize;
  const ref = run.results.reference;
  const ev = run.results.evidence;
  const spec = run.results.spec;
  const out = [...header(project, run, 'Project rebuild')];
  out.push('## Authorization', '', project.authorization ?? '(none recorded)', '');
  if (ref) out.push('## Reference', '', `- ${ref.identity.kind} \`${ref.identity.name}\`, sha256 \`${ref.identity.sha256}\``, `- ERA detection: ${ref.detection.kind} — ${ref.detection.reason}${ref.detection.supported ? '' : ' (no verified REA workflow)'}`, '');
  if (ev) out.push('## REA evidence', '', ev.available ? `- Status ${ev.status}; ${ev.runs.length} REA execution(s): ${ev.runs.map((r) => `${r.label} ${r.status}`).join(', ')}; evidence IDs ${ev.evidence_ids.map((e) => `\`${e.slice(0, 20)}…\``).join(', ')}.` : `- ${ev.reason}`, '');
  if (spec) out.push('## Unknowns and assumptions', '', ...spec.unknowns.map((u) => `- Unknown: ${u}`), ...spec.assumptions.map((a) => `- Assumption: ${a}`), '');
  out.push('## Attempts', '', ...(run.attempts.length ? run.attempts.map((a) => `- Attempt ${a.n} (${a.agent}): ${a.pass ? '**passed acceptance**' : `failed — ${a.reasons.join(' ')}`}`) : ['- none']), '');
  if (!fin) return [...out, `_The run is ${run.status}${run.error ? `: ${run.error}` : ''}._`].join('\n');
  out.push('## Behavioral comparison (expected vs implemented)', '', fin.behaviors.length ? '| Behavior | Source | Result | Expected | Actual |\n|---|---|---|---|---|' : 'No behaviors were specified.');
  for (const b of fin.behaviors) out.push(`| ${b.name} | ${b.source} | ${b.match ? 'match' : `**MISMATCH** (${b.reasons.join(', ')})`} | \`${JSON.stringify(b.expected.stdout)}\` exit ${b.expected.exit_code} | \`${JSON.stringify(b.actual.stdout)}\` exit ${b.actual.exit_code} |`);
  out.push('', '## Decision', '', fin.pass ? '**Accepted for review**: all acceptance checks passed. Nothing has been written to the destination yet.' : `**Rejected**:\n${fin.reasons.map((r) => `- ${r}`).join('\n')}`, '');
  if (fin.warnings.length) out.push('### Warnings', '', ...fin.warnings.map((w) => `- ${w}`), '');
  out.push('## Verification', '', ...verification(fin.verification), '', ...changeSection(fin));
  out.push('_This is an independent reimplementation of observed behavior, not recovered source code. Unknown behavior is listed above._', fin.pass ? `Approve with \`era project approve ${project.id}\` to write the project to \`${project.destination}\`.` : '');
  return out.join('\n');
}

export function renderRun(project, run) {
  const text = run.op === 'review' ? renderReview(project, run) : run.op === 'modify' ? renderModify(project, run) : renderRebuild(project, run);
  return redactText(text);
}
