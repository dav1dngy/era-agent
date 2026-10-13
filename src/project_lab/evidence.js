// Evidence about an external project (Project Lab): REA analysis where it adds
// something (JavaScript applications, via ERA's byte-bounded pass planner),
// language-agnostic static checks, and validation of agent-reported findings.
// Every finding carries severity, evidence and source locations.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { sha256Text } from '../core/util.js';
import { SECRET_PATTERNS, redactText } from '../safety/secrets.js';
import { extractFacts } from '../analysis/facts.js';
import { graphView, ruleSpawnWithoutErrorListener } from '../self_analysis/rules.js';
import { planPasses, stagePass } from '../self_analysis/self-analyze.js';
import { walkFiles } from './workspace.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const CATEGORIES = ['security', 'reliability', 'maintainability', 'testing', 'build', 'performance', 'correctness'];
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
const CONF = { high: 0, medium: 1, low: 2 };

export function findingId(source, title, file = '', line = '') {
  return `P-${sha256Text(`${source}|${title}|${file}|${line}`).slice(0, 10)}`;
}

export function makeFinding({ source, severity, category, title, detail = '', locations = [], evidence = '', confidence = 'medium', recommendation = null, verified = null }) {
  return {
    id: findingId(source, title, locations[0]?.file, locations[0]?.line),
    source,
    severity,
    category,
    title,
    detail,
    locations,
    evidence: redactText(String(evidence)).slice(0, 600),
    confidence,
    recommendation,
    verified,
  };
}

export function prioritize(findings) {
  return [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity] || CONF[a.confidence] - CONF[b.confidence] || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}

// ---- REA

// Is the local import `specifier` of `fromFile` actually present in the project?
function localTargetExists(root, fromFile, specifier) {
  const base = resolve(root, dirname(fromFile), specifier);
  if (!base.startsWith(resolve(root) + sep)) return false;
  const candidates = [base, ...['.js', '.mjs', '.cjs', '.json', '.node', '.ts', '.tsx', '.jsx'].map((e) => base + e), ...['index.js', 'index.mjs', 'index.cjs', 'index.json'].map((i) => join(base, i))];
  return candidates.some((c) => existsSync(c));
}

export async function reaJavaScriptAnalysis({ dir, rea, workDir, maxPasses = 8, log }) {
  const universePasses = planPasses(dir);
  if (universePasses.length === 0) return { ran: false, reason: 'no JavaScript sources found', findings: [], runs: [], facts: [] };
  const todo = universePasses.slice(0, maxPasses);
  const evidence = [];
  const runs = [];
  const limitations = [];
  if (universePasses.length > todo.length) limitations.push(`REA analyzed ${todo.length} of ${universePasses.length} source groups (limit ${maxPasses}); the rest of the project was not analyzed with REA.`);
  for (const [i, pass] of todo.entries()) {
    const stage = stagePass(dir, join(workDir, `rea-pass-${i + 1}`), pass);
    const { record, result } = await rea.run('analyze-javascript-application', [stage], { inputPath: stage, label: `project:rea-pass-${i + 1}/${todo.length}` });
    runs.push(record);
    log?.info?.('project.rea', { pass: i + 1, status: record.status, run_id: record.run_id });
    if (record.status === 'succeeded' && result) evidence.push(result);
    else limitations.push(`REA pass ${i + 1} ${record.status}: ${record.errors.join('; ') || 'no output'}`);
  }
  if (evidence.length === 0) return { ran: false, reason: `REA produced no evidence (${limitations.join(' | ')})`, findings: [], runs, facts: [], limitations };

  const g = graphView(evidence);
  const facts = new Set();
  for (const ev of evidence) for (const f of extractFacts(ev, { sourceRoot: dir })) facts.add(f);
  const findings = [];
  const seenUnresolved = new Set();
  for (const e of g.localEdges) {
    if (e.to !== null) continue;
    const key = `${e.from}->${e.specifier}`;
    if (seenUnresolved.has(key) || !e.from || localTargetExists(dir, e.from, e.specifier)) continue;
    seenUnresolved.add(key);
    findings.push(makeFinding({ source: 'rea', severity: 'medium', category: 'reliability', title: `Import of a missing local file: ${e.specifier}`, detail: `${e.from} imports "${e.specifier}", which does not exist in the project; loading this module will fail.`, locations: [{ file: e.from }], evidence: `REA application graph: unresolved ${e.kind} edge ${key}; confirmed absent on disk`, confidence: 'high', recommendation: 'Add the file, fix the path, or remove the import.' }));
  }
  for (const f of ruleSpawnWithoutErrorListener(g)) {
    findings.push(makeFinding({ source: 'rea', severity: 'low', category: 'reliability', title: f.title, detail: f.detail, locations: [{ file: f.subject }], evidence: `REA evidence ${f.evidence_ids.join(',').slice(0, 80)}: child_process launcher imported, no 'error' event listener recorded`, confidence: 'medium', recommendation: "Attach an 'error' listener to the spawned process." }));
  }
  for (const [file, code] of g.incomplete) limitations.push(`REA coverage of ${file} is incomplete (${code}); findings that depend on its relationships may be missing.`);
  const external = [...new Set(g.externalImports.map((i) => i.specifier).filter(Boolean))].sort();
  return {
    ran: true,
    passes: todo.length,
    total_passes: universePasses.length,
    modules: g.modules.length,
    external_dependencies: external,
    endpoints: [...facts].filter((f) => f.startsWith('endpoint:')).map((f) => f.slice(9)),
    unknowns: g.unknowns.length,
    facts: [...facts].sort(),
    findings,
    limitations,
    runs: runs.map((r) => ({ run_id: r.run_id, status: r.status, evidence_id: r.evidence_id, duration_ms: r.duration_ms })),
    evidence_ids: runs.map((r) => r.evidence_id).filter(Boolean),
  };
}

// ---- static checks (no engine): locations and evidence come straight from the files.
const SMELLS = [
  { id: 'eval', langs: /\.(m|c)?jsx?$|\.tsx?$/, re: /\beval\s*\(|\bnew Function\s*\(/, title: 'Dynamic code evaluation', severity: 'medium', category: 'security', rec: 'Avoid eval/new Function on data that is not fully trusted.' },
  { id: 'js-exec', langs: /\.(m|c)?jsx?$|\.tsx?$/, re: /\b(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|[^)]*\+)/, title: 'Shell command built from variable input', severity: 'high', category: 'security', rec: 'Use execFile/spawn with an argument array instead of composing a shell string.' },
  { id: 'innerhtml', langs: /\.(m|c)?jsx?$|\.tsx?$/, re: /\.innerHTML\s*=|document\.write\s*\(/, title: 'Unescaped HTML injection point', severity: 'medium', category: 'security', rec: 'Use textContent or a sanitizer.' },
  { id: 'py-shell', langs: /\.py$/, re: /shell\s*=\s*True/, title: 'Subprocess with shell=True', severity: 'medium', category: 'security', rec: 'Pass an argument list and avoid shell=True.' },
  { id: 'py-pickle', langs: /\.py$/, re: /\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader)/, title: 'Unsafe deserialization', severity: 'medium', category: 'security', rec: 'Use safe loaders (yaml.safe_load) and avoid unpickling untrusted data.' },
  { id: 'py-eval', langs: /\.py$/, re: /\beval\s*\(|\bexec\s*\(/, title: 'Dynamic code evaluation', severity: 'medium', category: 'security', rec: 'Avoid eval/exec.' },
  { id: 'weak-hash', langs: /\.(m|c)?jsx?$|\.py$|\.go$|\.java$/, re: /\b(?:md5|sha1)\b\s*[(\x22'`]/i, title: 'Weak hash algorithm', severity: 'low', category: 'security', rec: 'Use SHA-256 or stronger where the hash protects anything.' },
];

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

export function staticFindings(dir, detection) {
  const findings = [];
  const files = walkFiles(dir).filter((f) => f.type === 'file' && f.size <= 1_000_000);
  const todos = [];
  for (const f of files) {
    let buf;
    try {
      buf = readFileSync(f.full);
    } catch {
      continue;
    }
    if (isBinary(buf)) continue;
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (lines.length > 1500 && /\.(m|c)?jsx?$|\.tsx?$|\.py$|\.go$|\.java$|\.rs$|\.c(c|pp)?$/.test(f.rel)) {
      findings.push(makeFinding({ source: 'static', severity: 'low', category: 'maintainability', title: `Very large source file (${lines.length} lines)`, locations: [{ file: f.rel }], evidence: `${f.rel} has ${lines.length} lines`, confidence: 'high', recommendation: 'Split by responsibility.' }));
    }
    const hits = new Map();
    lines.forEach((line, idx) => {
      for (const [name, re] of SECRET_PATTERNS) {
        if (new RegExp(re.source).test(line)) {
          const critical = /private key/i.test(name);
          findings.push(makeFinding({ source: 'static', severity: critical ? 'critical' : 'high', category: 'security', title: `Possible ${name} in source`, detail: 'A value matching a credential pattern is committed in the project. Treat it as exposed and rotate it.', locations: [{ file: f.rel, line: idx + 1 }], evidence: `line ${idx + 1} matches the "${name}" pattern (value not shown)`, confidence: /Bearer/.test(name) ? 'low' : 'medium', recommendation: 'Remove the secret from the repository, rotate it, and load it from the environment.' }));
        }
      }
      for (const s of SMELLS) {
        if (s.langs.test(f.rel) && s.re.test(line)) {
          const list = hits.get(s.id) ?? [];
          list.push({ line: idx + 1, text: line.trim().slice(0, 160) });
          hits.set(s.id, list);
        }
      }
      if (/\b(?:TODO|FIXME|HACK|XXX)\b/.test(line) && !/\.(md|txt)$/.test(f.rel)) todos.push({ file: f.rel, line: idx + 1 });
    });
    for (const [id, list] of hits) {
      const s = SMELLS.find((x) => x.id === id);
      findings.push(makeFinding({ source: 'static', severity: s.severity, category: s.category, title: `${s.title} (${basename(f.rel)})`, detail: `Heuristic pattern match, not a confirmed vulnerability: ${list.length} occurrence(s).`, locations: list.slice(0, 5).map((h) => ({ file: f.rel, line: h.line })), evidence: list.slice(0, 3).map((h) => `${h.line}: ${h.text}`).join(' | '), confidence: 'low', recommendation: s.rec }));
    }
  }
  if (todos.length) findings.push(makeFinding({ source: 'static', severity: 'info', category: 'maintainability', title: `${todos.length} TODO/FIXME markers`, locations: todos.slice(0, 5), evidence: `first locations: ${todos.slice(0, 5).map((t) => `${t.file}:${t.line}`).join(', ')}`, confidence: 'high' }));
  if (detection && detection.file_count > 0 && Object.keys(detection.languages).length > 0 && detection.test_file_count === 0) {
    findings.push(makeFinding({ source: 'static', severity: 'medium', category: 'testing', title: 'No automated tests found', detail: 'No test files or test directories were detected.', evidence: `0 test files among ${detection.file_count} files`, confidence: 'high', recommendation: 'Add tests for the main behavior before changing it.' }));
  }
  if (detection && detection.test.length === 0 && detection.test_file_count > 0) {
    findings.push(makeFinding({ source: 'static', severity: 'low', category: 'build', title: 'Tests exist but no test command was detected', evidence: `${detection.test_file_count} test files; no package script, Makefile target or tool configuration found`, confidence: 'medium', recommendation: 'Configure commands.test for this project.' }));
  }
  return findings;
}

// ---- agent findings: accepted only when they point at real files and lines.
export function extractJsonArray(text) {
  const fenced = [...String(text).matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const candidate of [...fenced, String(text)]) {
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function validateAgentFindings(raw, root) {
  const accepted = [];
  const rejected = [];
  if (!Array.isArray(raw)) return { accepted, rejected: [{ reason: 'agent output contains no JSON findings array' }] };
  const realRoot = resolve(root);
  for (const [i, f] of raw.entries()) {
    const reject = (reason) => rejected.push({ index: i, title: typeof f?.title === 'string' ? f.title.slice(0, 80) : null, reason });
    if (!f || typeof f !== 'object') {
      reject('not an object');
      continue;
    }
    if (typeof f.title !== 'string' || !f.title.trim()) {
      reject('missing title');
      continue;
    }
    if (!SEVERITIES.includes(f.severity)) {
      reject(`invalid severity "${f.severity}"`);
      continue;
    }
    const category = CATEGORIES.includes(f.category) ? f.category : 'correctness';
    if (typeof f.evidence !== 'string' || f.evidence.trim().length < 8) {
      reject('missing evidence');
      continue;
    }
    if (typeof f.file !== 'string' || !f.file) {
      reject('missing file');
      continue;
    }
    const abs = resolve(realRoot, f.file);
    if (!abs.startsWith(realRoot + sep) || !existsSync(abs) || !statSync(abs).isFile()) {
      reject(`file "${f.file}" is not a file in the project`);
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    const lineCount = text.split('\n').length;
    let line = null;
    if (f.line !== undefined && f.line !== null) {
      line = Number(f.line);
      if (!Number.isInteger(line) || line < 1 || line > lineCount) {
        reject(`line ${f.line} is outside ${f.file} (${lineCount} lines)`);
        continue;
      }
    }
    let verified = null;
    if (typeof f.snippet === 'string' && f.snippet.trim()) {
      const norm = (s) => s.replace(/\s+/g, ' ').trim();
      verified = norm(text).includes(norm(f.snippet));
    }
    accepted.push(makeFinding({ source: 'agent', severity: f.severity, category, title: f.title.trim().slice(0, 200), detail: typeof f.detail === 'string' ? f.detail.slice(0, 1000) : '', locations: [{ file: f.file, ...(line ? { line } : {}) }], evidence: f.evidence, confidence: verified === true ? 'medium' : 'low', recommendation: typeof f.recommendation === 'string' ? f.recommendation.slice(0, 500) : null, verified }));
  }
  return { accepted, rejected };
}
