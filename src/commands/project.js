// `era project …`: ERA Project Lab commands. A thin layer over src/project_lab/lab.js.
import { readFileSync } from 'node:fs';
import { createProjectLab } from '../project_lab/lab.js';
import { confirm } from './lab.js';

const print = (value, asJson) => process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${value}\n`);

const EXIT = { complete: 0, 'awaiting-approval': 0, 'awaiting-implementation': 0, applied: 0, rejected: 1, failed: 1, interrupted: 130, cancelled: 130 };

// Builds a project definition from --config <file> and flags (flags win).
export function projectInputFromArgs({ positional, flags }) {
  let input = {};
  if (flags.config) {
    try {
      input = JSON.parse(readFileSync(String(flags.config), 'utf8'));
    } catch (err) {
      throw new Error(`Cannot read --config ${flags.config}: ${err.message}`, { cause: err });
    }
  }
  const set = (key, value) => {
    if (value !== undefined && value !== true && value !== false) input[key] = value;
  };
  set('id', positional[1] ?? flags.id);
  for (const k of ['mode', 'source', 'reference', 'destination', 'task', 'agent', 'authorization']) set(k, flags[k]);
  set('agent_command', flags['agent-command']);
  const list = (v) => (Array.isArray(v) && v.length ? v : undefined);
  if (list(flags.build) || list(flags.test) || flags.run) input.commands = { ...input.commands, ...(list(flags.build) ? { build: flags.build } : {}), ...(list(flags.test) ? { test: flags.test } : {}), ...(flags.run ? { run: flags.run } : {}) };
  if (list(flags.criteria) || list(flags.accept) || list(flags['accept-fail'])) {
    const a = input.acceptance ?? {};
    input.acceptance = { ...a, criteria: [...(a.criteria ?? []), ...(flags.criteria ?? [])], commands: [...(a.commands ?? []), ...(flags.accept ?? []).map((command) => ({ command })), ...(flags['accept-fail'] ?? []).map((command) => ({ command, baseline: 'fail' }))] };
  }
  if (list(flags.protect)) input.protected = [...(input.protected ?? []), ...flags.protect];
  const limits = { ...input.limits };
  if (flags['max-cost']) limits.maxCostUsd = Number(flags['max-cost']);
  if (flags['timeout-ms']) limits.commandTimeoutMs = Number(flags['timeout-ms']);
  if (flags['max-attempts']) limits.maxAttempts = Number(flags['max-attempts']);
  if (Object.keys(limits).length) input.limits = limits;
  if (flags['trust-project']) input.trust_project = true;
  return input;
}

const table = (rows, cols) => {
  if (!rows.length) return '(none)';
  const w = cols.map(([h, f]) => Math.max(h.length, ...rows.map((r) => String(f(r) ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join('  ');
  return [line(cols.map(([h]) => h)), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map(([, f]) => f(r) ?? '')))].join('\n');
};

function summarize(result) {
  const { project, run } = result;
  const lines = [`${project.id}: ${run.op} run ${run.run_id} → ${run.status}`];
  if (run.error) lines.push(`Error: ${run.error}`);
  if (run.pause_message) lines.push(run.pause_message);
  const fin = run.results.finalize;
  if (fin) lines.push(fin.pass ? `Verified: ${fin.files.length} file(s) changed in the isolated copy; nothing has been applied.` : `Rejected: ${fin.reasons.join(' ')}`);
  if (run.results.findings) lines.push(`Findings: ${Object.entries(run.results.findings.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  return lines.join('\n');
}

export async function run(command, ctx, { positional, flags }) {
  const lab = createProjectLab({ config: ctx.config, rea: ctx.rea, log: ctx.log });
  const sub = positional[0];
  const id = positional[1] ?? flags.id;
  const need = () => {
    if (!id) throw new Error(`Usage: era project ${sub} <id>`);
    return id;
  };
  const opts = { trust: !!flags['trust-project'], agent: flags.agent ?? null };
  const finish = (result) => {
    if (flags.json) print({ project_id: result.project.id, run_id: result.run.run_id, op: result.run.op, status: result.run.status, error: result.run.error ?? null, results: result.run.results, attempts: result.run.attempts }, true);
    else {
      print(flags.brief ? summarize(result) : result.report);
      print(`\n${summarize(result)}\nReport: ${ctx.config.stateDirAbs}/projects/${result.project.id}/runs/${result.run.run_id}/report.md`);
      const next = lab.status(result.project.id).next;
      if (next) print(`Next: ${next}`);
    }
    return EXIT[result.run.status] ?? 1;
  };

  switch (sub) {
    case 'create': {
      const project = lab.create(projectInputFromArgs({ positional, flags }));
      if (flags.json) return print(project, true), 0;
      print(`Created project "${project.id}" (${project.mode}). Next: era project ${project.mode} ${project.id}`);
      return 0;
    }
    case 'list': {
      const rows = lab.list();
      if (flags.json) return print(rows, true), 0;
      print(table(rows, [['ID', (r) => r.id], ['MODE', (r) => r.mode], ['STATUS', (r) => r.status], ['APPROVAL', (r) => r.approval], ['TARGET', (r) => r.source ?? r.reference]]));
      return 0;
    }
    case 'review':
      return finish(await lab.review(need(), opts));
    case 'modify':
      return finish(await lab.modify(need(), opts));
    case 'rebuild':
      return finish(await lab.rebuild(need(), opts));
    case 'resume':
      return finish(await lab.resume(need(), opts));
    case 'status': {
      const s = lab.status(need());
      if (flags.json) return print(s, true), 0;
      const r = s.latest_run;
      print([`Project ${s.project.id}: ${s.project.mode}, status ${s.project.status}, approval ${s.project.approval.status}`, `Agent: ${s.project.agent}; spend: $${s.spend.agent_usd.toFixed(4)} of $${s.spend.limit_usd}`, r ? `Latest run ${r.run_id} (${r.op}): ${r.status}${r.current_step ? `, step ${r.current_step}` : ''}${r.attempts.length ? `, ${r.attempts.length} attempt(s)` : ''}${r.error ? `\n  error: ${r.error}` : ''}${r.pause_message ? `\n  ${r.pause_message}` : ''}` : 'No runs yet.', s.next ? `Next: ${s.next}` : ''].filter(Boolean).join('\n'));
      return 0;
    }
    case 'show': {
      const s = lab.show(need(), { runId: flags.run ?? null });
      if (flags.json) return print({ project: s.project, run: s.run }, true), 0;
      print(s.report);
      return 0;
    }
    case 'approve': {
      const s = lab.show(need());
      const fin = s.run.results.finalize;
      if (s.run.status !== 'awaiting-approval' || !fin) throw new Error(`Nothing to approve: latest run is ${s.run.status}.`);
      print(`${s.run.op === 'modify' ? 'Apply to the ORIGINAL project' : 'Write to'} ${s.run.op === 'modify' ? s.project.source : s.project.destination}:\n${fin.stat || fin.files.map((f) => `${f.status} ${f.path}`).join('\n')}\n`);
      const by = flags.by ?? `${process.env.USER ?? 'unknown'}`;
      if (!(await confirm(`Approve ${s.run.run_id} for project ${s.project.id} as ${by}?`, flags))) return print('Not approved; nothing changed.'), 1;
      const r = await lab.approve(s.project.id, { by, runId: s.run.run_id });
      if (flags.json) return print(r, true), 0;
      print(`Applied ${r.op} run ${r.run_id}. Undo with: era project rollback ${s.project.id}`);
      return 0;
    }
    case 'rollback': {
      const r = await lab.rollback(need());
      print(flags.json ? r : `Rolled back run ${r.run_id}${r.restored ? ' (original restored)' : ''}.`, !!flags.json);
      return 0;
    }
    case 'cancel': {
      const r = await lab.cancel(need());
      print(flags.json ? r : `Cancelled run ${r.run_id}; its working copy was removed.`, !!flags.json);
      return 0;
    }
    case 'delete': {
      need();
      if (!(await confirm(`Delete project ${id} and all its runs? (the original project is not touched)`, flags))) return print('Not deleted.'), 1;
      print(lab.remove(id), true);
      return 0;
    }
    default:
      throw new Error(`Unknown project command "${sub ?? ''}". Use: create, list, review, modify, rebuild, status, show, approve, cancel, resume, rollback, delete. See \`era --help\`.`);
  }
}
