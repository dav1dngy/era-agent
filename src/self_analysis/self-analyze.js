// Self-Analysis Engine: prepares ERA's own shipped artifact (npm pack output
// plus its test suite), runs REA against it, and derives findings.
//
// REA's JavaScript analyzer has a fixed per-run result budget (~993 MB of
// expanded relationships). ERA's packaged source alone now exceeds it, which
// leaves files with `resource_constraint` (incomplete) coverage. The artifact
// is therefore split into passes of at most PASS_BYTE_BUDGET bytes of real
// ("focus") files. Each real file is analyzed in exactly one pass. Local files
// that a pass's focus files import, but that belong to other passes, are staged
// as one-line placeholders, so REA can resolve every import edge without
// spending budget on them. The placeholders contain no code; all facts about a
// file come from the pass in which it is a focus file.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { runProcess } from '../core/process.js';
import { newId, sha256File, writeJson, writeText } from '../core/util.js';
import { runRules, graphView } from './rules.js';
import { renderRunTable } from '../analysis/report.js';

export const PASS_BYTE_BUDGET = 50_000;
export const PLACEHOLDER = '// ERA self-analysis placeholder: this file is analyzed in another REA pass.\n';

export async function prepareSelfArtifact(eraRoot, workDir) {
  mkdirSync(workDir, { recursive: true });
  const pack = await runProcess('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', workDir], { cwd: eraRoot, timeoutMs: 120_000 });
  if (pack.exitCode !== 0) throw new Error(`npm pack failed: ${pack.stderr.trim() || pack.spawnError}`);
  const [{ filename, files }] = JSON.parse(pack.stdout);
  const tarball = join(workDir, filename);
  const extractDir = join(workDir, 'artifact');
  mkdirSync(extractDir, { recursive: true });
  const tar = await runProcess('tar', ['-xzf', tarball, '-C', extractDir], { timeoutMs: 60_000 });
  if (tar.exitCode !== 0) throw new Error(`tar extraction failed: ${tar.stderr.trim()}`);
  const packageDir = join(extractDir, 'package');
  return { tarball, tarball_sha256: await sha256File(tarball), packaged_files: files.length, packageDir };
}

const JS_FILE = /\.(m|c)?js$/;

function listJs(root, dir = root, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (e === 'node_modules' || e.startsWith('.')) continue;
    if (statSync(p).isDirectory()) listJs(root, p, acc);
    else if (JS_FILE.test(e)) acc.push(relative(root, p));
  }
  return acc;
}

// Relative import specifiers (static, dynamic, re-export, require) used only to
// decide which placeholders a pass needs; REA performs the actual analysis.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

export function directLocalImports(root, file) {
  const text = readFileSync(join(root, file), 'utf8');
  const out = new Set();
  for (const [, spec] of text.matchAll(SPECIFIER)) {
    const target = normalize(join(dirname(file), spec));
    if (!target.startsWith('..') && existsSync(join(root, target)) && statSync(join(root, target)).isFile()) out.add(target);
  }
  return [...out].sort();
}

// The analysis universe: the packed artifact (bin, src, package.json) plus
// ERA's tests. Fixture data files are not JavaScript and are not needed.
export function stageUniverse(packageDir, eraRoot, dest) {
  cpSync(packageDir, dest, { recursive: true });
  const tests = join(eraRoot, 'tests');
  for (const f of listJs(tests)) {
    mkdirSync(dirname(join(dest, 'tests', f)), { recursive: true });
    cpSync(join(tests, f), join(dest, 'tests', f));
  }
  return dest;
}

export function planPasses(universe, byteBudget = PASS_BYTE_BUDGET) {
  const files = listJs(universe);
  const passes = [];
  let current = null;
  for (const f of files) {
    const bytes = statSync(join(universe, f)).size;
    if (!current || (current.bytes + bytes > byteBudget && current.focus.length > 0)) {
      current = { focus: [], bytes: 0 };
      passes.push(current);
    }
    current.focus.push(f);
    current.bytes += bytes;
  }
  for (const p of passes) {
    const focus = new Set(p.focus);
    p.placeholders = [...new Set(p.focus.flatMap((f) => directLocalImports(universe, f)))].filter((t) => !focus.has(t)).sort();
  }
  return passes;
}

export function stagePass(universe, dest, pass) {
  mkdirSync(dest, { recursive: true });
  if (existsSync(join(universe, 'package.json'))) cpSync(join(universe, 'package.json'), join(dest, 'package.json'));
  for (const f of pass.focus) {
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    cpSync(join(universe, f), join(dest, f));
  }
  for (const f of pass.placeholders) {
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    writeFileSync(join(dest, f), PLACEHOLDER);
  }
  return dest;
}

export function stagePasses(packageDir, eraRoot, workDir, byteBudget = PASS_BYTE_BUDGET) {
  const universe = stageUniverse(packageDir, eraRoot, join(workDir, 'universe'));
  return planPasses(universe, byteBudget).map((pass, i) => ({ ...pass, dir: stagePass(universe, join(workDir, `pass-${i + 1}`), pass) }));
}

export async function selfAnalyze({ eraRoot, rea, stateDir, label = 'self-analysis' }) {
  const id = newId('self');
  const dir = join(stateDir, 'self-analyses', id);
  const artifact = await prepareSelfArtifact(eraRoot, join(dir, 'work'));

  const passes = stagePasses(artifact.packageDir, eraRoot, join(dir, 'work', 'passes'));
  const jsRuns = [];
  for (const [i, pass] of passes.entries()) {
    jsRuns.push(await rea.run('analyze-javascript-application', [pass.dir], { inputPath: pass.dir, label: `${label}:static-graph-${i + 1}/${passes.length}` }));
  }
  const scenarioPath = join(dir, 'help-scenario.json');
  writeJson(scenarioPath, {
    executable: process.execPath,
    arguments: [join(artifact.packageDir, 'bin', 'era.mjs'), '--help'],
    working_directory: dir,
    filesystem_observation_paths: [artifact.packageDir],
    timeout_ms: 30_000,
    idle_timeout_ms: 30_000,
    finalization_ms: 500,
  });
  const runtimeRun = await rea.run('capture-process', [scenarioPath], { inputPath: join(artifact.packageDir, 'bin', 'era.mjs'), label: `${label}:runtime-help` });

  const failed = jsRuns.filter((r) => r.record.status !== 'succeeded');
  if (failed.length) {
    throw new Error(`REA static self-analysis failed: ${failed.flatMap((r) => r.record.errors).join('; ')}`);
  }
  const capture = runtimeRun.record.status === 'succeeded' ? runtimeRun.result : null;
  const evidence = jsRuns.map((r) => r.result);
  const findings = runRules(evidence, capture);
  const unknownIds = new Set(evidence.flatMap((e) => (e.normalized_result.semantic_graph?.unknowns ?? []).map((u) => u.node_id)));
  const startup = capture ? Date.parse(capture.normalized_result.manifest.completed_at) - Date.parse(capture.normalized_result.manifest.started_at) : null;

  const report = {
    self_analysis_id: id,
    created_at: new Date().toISOString(),
    era_root: eraRoot,
    artifact: { tarball_sha256: artifact.tarball_sha256, packaged_files: artifact.packaged_files, analyzed_dir: artifact.packageDir, passes: passes.map((p) => ({ dir: p.dir, focus: p.focus, placeholders: p.placeholders, bytes: p.bytes })) },
    runs: [...jsRuns.map((r) => r.record), runtimeRun.record],
    metrics: {
      modules: graphView(evidence).modules.length,
      passes: passes.length,
      semantic_unknowns: unknownIds.size,
      startup_ms: startup,
      findings: findings.length,
    },
    findings,
  };
  writeJson(join(dir, 'self-analysis.json'), report);
  writeText(join(dir, 'report.md'), renderSelfReport(report));
  report.report_path = join(dir, 'report.md');
  return report;
}

export function renderSelfReport(r) {
  const out = [`# ERA self-analysis ${r.self_analysis_id}`, ''];
  out.push(`- Artifact: npm pack tarball sha256 \`${r.artifact.tarball_sha256}\` (${r.artifact.packaged_files} files) + test suite, analyzed in ${r.metrics.passes} REA passes`);
  out.push(`- Modules recovered by REA: ${r.metrics.modules}; semantic unknowns: ${r.metrics.semantic_unknowns}; \`era --help\` runtime: ${r.metrics.startup_ms ?? 'n/a'} ms`, '');
  out.push('## REA executions', '', renderRunTable(r.runs), '');
  out.push(`## Findings (${r.findings.length})`, '');
  out.push('| ID | Area (priority) | Rule | Title |', '|---|---|---|---|');
  for (const f of r.findings) out.push(`| ${f.id} | ${f.area} (${f.priority}) | ${f.rule} | ${f.title} |`);
  out.push('');
  return out.join('\n');
}

export function listSelfAnalyses(stateDir) {
  const dir = join(stateDir, 'self-analyses');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}
