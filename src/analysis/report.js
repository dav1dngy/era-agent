// Reporting Engine: Markdown rendering for analyses, self-analyses and cycles.

const CATEGORY_TITLES = {
  module: 'Source modules',
  entry: 'Entrypoints',
  import: 'Internal import edges',
  external: 'External dependencies',
  export: 'Exports',
  endpoint: 'Network endpoints (static string literals)',
  unresolved: 'Unresolved local imports',
  dependency: 'Linked libraries',
  arch: 'Architectures',
  member: 'Archive members',
  function: 'Decompiled functions',
  call: 'Native call edges',
  string: 'Referenced strings',
  exit: 'Process exit',
};

const NATIVE_TITLES = { import: 'Imported symbols', export: 'Exported symbols' };

export function renderRunTable(runs) {
  const lines = ['| Step | REA command | Status | Duration | Evidence |', '|---|---|---|---|---|'];
  for (const r of runs) {
    const cmd = r.command.slice(1, 3).join(' ');
    lines.push(`| ${r.label} | \`rea ${cmd}\` | ${r.status} | ${r.duration_ms} ms | ${r.evidence_id ? `\`${r.evidence_id.slice(0, 19)}…\`` : '—'} |`);
  }
  return lines.join('\n');
}

export function renderAnalysisReport(a) {
  const out = [];
  out.push(`# ERA analysis: ${a.target.path.split('/').pop()}`, '');
  out.push(`- Analysis ID: \`${a.analysis_id}\``);
  out.push(`- Target: \`${a.target.path}\` (${a.target.kind}; ${a.target.detection})`);
  out.push(`- Engine: rea-agents ${a.engine?.version ?? 'unknown'}`);
  out.push(`- Status: **${a.status}**`);
  if (a.runtime_sandbox) out.push(`- Runtime capture sandbox: ${a.runtime_sandbox.mechanism}${a.runtime_sandbox.network ? ` (network ${a.runtime_sandbox.network}, writes limited to the analysis scratch directory)` : ` (${a.runtime_sandbox.reason})`}`);
  out.push('');
  out.push('## REA executions', '', renderRunTable(a.runs), '');
  const failed = a.runs.filter((r) => r.status !== 'succeeded');
  if (failed.length) {
    out.push('## Errors', '');
    for (const r of failed) out.push(`- ${r.label}: ${r.errors.join('; ') || r.status}`);
    out.push('');
  }
  out.push('## Findings', '');
  const groups = a.fact_groups ?? {};
  if (Object.keys(groups).length === 0) out.push('No facts were recovered.', '');
  const titles = a.target.kind === 'mach-o' ? { ...CATEGORY_TITLES, ...NATIVE_TITLES } : CATEGORY_TITLES;
  for (const [cat, values] of Object.entries(groups)) {
    out.push(`### ${titles[cat] ?? cat} (${values.length})`, '');
    for (const v of values) out.push(`- \`${v}\``);
    out.push('');
  }
  const functions = a.evidence.filter((e) => e.function?.pseudocode);
  if (functions.length) {
    out.push('## Decompiled functions', '');
    for (const e of functions) {
      out.push(`### ${e.function.name} @ ${e.function.address}`, '', e.function.signature ? `Signature: \`${e.function.signature}\`` : '', '', '```c', e.function.pseudocode.trimEnd(), '```', '');
    }
  } else if (a.decompilation && a.decompilation !== 'not applicable') {
    out.push(`Native decompilation: ${a.decompilation}.`, '');
  }
  out.push('## Coverage and limitations', '');
  for (const e of a.evidence) {
    out.push(`- \`${e.operation}\` via ${e.provider}: coverage ${e.coverage ?? 'n/a'}${e.unknowns !== null ? `, ${e.unknowns} residual unknowns` : ''}`);
    for (const l of e.limitations) out.push(`  - ${l}`);
  }
  out.push('', '_Static findings describe the analyzed artifact; they do not prove runtime execution unless a process capture is listed above._', '');
  return out.join('\n');
}
