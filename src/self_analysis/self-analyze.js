// Self-Analysis Engine: prepares ERA's own shipped artifact (npm pack output
// plus its test suite), runs REA against it, and derives findings.
//
// REA's JavaScript analyzer has a fixed per-run result budget; analyzing the
// whole package and test suite in one pass leaves later test files with
// `resource_constraint` (incomplete) coverage. The test suite is therefore split
// into groups: every pass contains the full packaged source (so test imports
// resolve) plus the shared test support files and one group of test files.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../core/process.js';
import { newId, sha256File, writeJson, writeText } from '../core/util.js';
import { runRules, graphView } from './rules.js';
import { renderRunTable } from '../analysis/report.js';

export const TEST_FILES_PER_PASS = 3;

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

// Size-balanced groups (largest file into the lightest group), since REA's
// budget is consumed roughly in proportion to source size.
export function testGroups(testsDir, perPass = TEST_FILES_PER_PASS) {
  if (!existsSync(testsDir)) return { support: [], groups: [] };
  const entries = readdirSync(testsDir).sort();
  const tests = entries.filter((f) => f.endsWith('.test.js'));
  const support = entries.filter((f) => !f.endsWith('.test.js'));
  const count = Math.ceil(tests.length / perPass);
  const groups = Array.from({ length: count }, () => ({ bytes: 0, files: [] }));
  const bySize = tests.map((f) => ({ f, bytes: statSync(join(testsDir, f)).size })).sort((a, b) => b.bytes - a.bytes || a.f.localeCompare(b.f));
  for (const t of bySize) {
    const g = groups.filter((x) => x.files.length < perPass).sort((a, b) => a.bytes - b.bytes)[0];
    g.files.push(t.f);
    g.bytes += t.bytes;
  }
  return { support, groups: groups.map((g) => g.files.sort()) };
}

// One staged directory per REA pass: packaged ERA + test support + a test group.
export function stagePasses(packageDir, eraRoot, workDir, perPass = TEST_FILES_PER_PASS) {
  const testsDir = join(eraRoot, 'tests');
  const { support, groups } = testGroups(testsDir, perPass);
  if (groups.length === 0) return [{ dir: packageDir, tests: [] }];
  return groups.map((group, i) => {
    const dir = join(workDir, `pass-${i + 1}`);
    cpSync(packageDir, dir, { recursive: true });
    for (const f of [...support, ...group]) cpSync(join(testsDir, f), join(dir, 'tests', f), { recursive: true });
    return { dir, tests: group };
  });
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
    artifact: { tarball_sha256: artifact.tarball_sha256, packaged_files: artifact.packaged_files, analyzed_dir: artifact.packageDir, passes: passes.map((p) => ({ dir: p.dir, tests: p.tests })) },
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
