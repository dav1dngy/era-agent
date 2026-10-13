// Analysis Mode (REA) for the control plane: target detection, jobs, stored analyses and evidence-derived graphs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detectTarget } from '../../analysis/detect.js';
import { renderAnalysisReport } from '../../analysis/report.js';
import { validateAnalysis } from '../../commands/analysis.js';
import { assertTargetPath, SafetyError } from '../../safety/policy.js';
import { insideAllowedRoots } from '../settings.js';
import { bad, denied, missing } from '../errors.js';

const ID = /^analysis-[0-9T]+-[0-9a-f]+$/;
const MAX_NODES = 300;

// Nodes and edges come ONLY from facts REA produced (module/import/call/dependency/external/entry facts).
// Nothing is inferred; when the evidence has no relationships the graph is empty and says why.
export function buildGraph(facts) {
  const nodes = new Map();
  const edges = [];
  const node = (id, kind, label = id) => {
    if (!nodes.has(id) && nodes.size < MAX_NODES) nodes.set(id, { id, kind, label });
    return nodes.has(id);
  };
  for (const f of facts) {
    const i = f.indexOf(':');
    const cat = f.slice(0, i);
    const rest = f.slice(i + 1);
    if (cat === 'module') node(rest, 'module');
    else if (cat === 'entry') node(rest, 'entry');
    else if (cat === 'external') node(`ext:${rest}`, 'external', rest);
    else if (cat === 'dependency') node(`dep:${rest}`, 'dependency', rest.split('/').pop());
    else if (cat === 'function') node(`fn:${rest}`, 'function', rest);
    else if (cat === 'import' && rest.includes('->')) {
      const [from, to] = rest.split('->');
      if (node(from, 'module') && node(to, 'module')) edges.push({ from, to, kind: 'imports' });
    } else if (cat === 'call' && rest.includes('->')) {
      const [from, to] = rest.split('->');
      if (node(`fn:${from}`, 'function', from) && node(`fn:${to}`, 'function', to)) edges.push({ from: `fn:${from}`, to: `fn:${to}`, kind: 'calls' });
    } else if (cat === 'unresolved' && rest.includes('->')) {
      const [from, to] = rest.split('->');
      if (node(from, 'module') && node(`ext:${to}`, 'external', `${to} (unresolved)`)) edges.push({ from, to: `ext:${to}`, kind: 'unresolved' });
    }
  }
  return { nodes: [...nodes.values()], edges, truncated: nodes.size >= MAX_NODES, note: edges.length ? null : 'The evidence for this target contains no import or call relationships, so there is nothing to draw.' };
}

export function analysisService(ctx) {
  const { jobs, audit, rea } = ctx;
  const dir = () => join(ctx.config.stateDirAbs, 'analyses');

  const load = (id) => {
    if (!ID.test(id)) throw bad('Invalid analysis id.');
    const file = join(dir(), id, 'analysis.json');
    if (!existsSync(file)) throw missing(`Unknown analysis "${id}".`);
    return validateAnalysis(JSON.parse(readFileSync(file, 'utf8')));
  };

  function list() {
    if (!existsSync(dir())) return [];
    return readdirSync(dir())
      .filter((n) => ID.test(n) && existsSync(join(dir(), n, 'analysis.json')))
      .sort()
      .reverse()
      .slice(0, 100)
      .map((n) => {
        try {
          const a = load(n);
          return { analysis_id: n, target: a.target, status: a.status, engine: a.engine, facts: a.facts.length, groups: Object.fromEntries(Object.entries(a.fact_groups).map(([k, v]) => [k, v.length])), rea_runs: a.runs.length, at: statSync(join(dir(), n, 'analysis.json')).mtime.toISOString() };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function get(id) {
    const a = load(id);
    return { ...a, report: renderAnalysisReport(a), graph: buildGraph(a.facts) };
  }

  async function detect(path) {
    if (typeof path !== 'string' || !path) throw bad('target path is required.');
    const target = resolve(path);
    if (!existsSync(target)) throw missing(`Target does not exist: ${target}`);
    try {
      assertTargetPath(target);
    } catch (err) {
      throw denied(err.message);
    }
    const detection = detectTarget(target);
    const status = await rea.status();
    return { target, ...detection, size: statSync(target).isFile() ? statSync(target).size : null, rea: { available: status.available, version: status.version ?? null, decompiler_available: status.decompiler_available ?? false, error: status.error ?? null } };
  }

  async function start(body = {}) {
    const info = await detect(body.target);
    if (!insideAllowedRoots(info.target, ctx.settings())) throw denied('The target is outside the allowed workspace roots (Settings → Workspaces).');
    if (!info.supported) throw bad(`ERA cannot analyze this target: ${info.reason}`, { kind: info.kind });
    if (!info.rea.available) throw bad(`REA is not available: ${info.rea.error ?? 'not found'}. Run \`era rea doctor\`.`);
    const args = ['analyze', info.target, '--json'];
    if (body.runtime) {
      if (!ctx.settings().permissions.runtimeCapture) throw denied('Runtime capture executes the target program. Enable Settings → Permissions → Runtime capture first.');
      args.push('--runtime');
    }
    if (body.no_decompile) args.push('--no-decompile');
    const job = jobs.start({ kind: 'analysis', label: `analyze ${info.target.split('/').pop()}`, args });
    audit.record('analysis.started', { job_id: job.id, target: info.target, kind: info.kind, runtime: !!body.runtime });
    return job;
  }

  return { list, get, detect, start, buildGraph, SafetyError };
}
