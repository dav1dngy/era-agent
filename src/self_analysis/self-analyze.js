// Self-Analysis Engine: prepares ERA's own shipped artifact (npm pack output
// plus its test suite), runs REA against it, and derives findings.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../core/process.js';
import { newId, sha256File, writeJson, writeText } from '../core/util.js';
import { runRules } from './rules.js';
import { renderRunTable } from '../analysis/report.js';

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
  if (existsSync(join(eraRoot, 'tests'))) cpSync(join(eraRoot, 'tests'), join(packageDir, 'tests'), { recursive: true });
  return { tarball, tarball_sha256: await sha256File(tarball), packaged_files: files.length, packageDir };
}

export async function selfAnalyze({ eraRoot, rea, stateDir, label = 'self-analysis' }) {
  const id = newId('self');
  const dir = join(stateDir, 'self-analyses', id);
  const artifact = await prepareSelfArtifact(eraRoot, join(dir, 'work'));

  const jsRun = await rea.run('analyze-javascript-application', [artifact.packageDir], { inputPath: artifact.packageDir, label: `${label}:static-graph` });
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

  if (jsRun.record.status !== 'succeeded') {
    throw new Error(`REA static self-analysis failed: ${jsRun.record.errors.join('; ')}`);
  }
  const capture = runtimeRun.record.status === 'succeeded' ? runtimeRun.result : null;
  const findings = runRules(jsRun.result, capture);
  const nr = jsRun.result.normalized_result;
  const startup = capture ? Date.parse(capture.normalized_result.manifest.completed_at) - Date.parse(capture.normalized_result.manifest.started_at) : null;

  const report = {
    self_analysis_id: id,
    created_at: new Date().toISOString(),
    era_root: eraRoot,
    artifact: { tarball_sha256: artifact.tarball_sha256, packaged_files: artifact.packaged_files, analyzed_dir: artifact.packageDir },
    runs: [jsRun.record, runtimeRun.record],
    metrics: {
      modules: (nr.graph?.nodes ?? []).filter((n) => n.kind === 'javascript-module' && n.observations?.[0]?.properties?.semantic_role === 'source-module').length,
      parsed_files: nr.statistics?.parsed_javascript_files ?? null,
      semantic_unknowns: nr.semantic_graph?.unknowns?.length ?? null,
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
  out.push(`- Artifact: npm pack tarball sha256 \`${r.artifact.tarball_sha256}\` (${r.artifact.packaged_files} files) + test suite`);
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
