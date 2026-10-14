// Steps shared by the Review, Modify and Rebuild workflows.
import { existsSync } from 'node:fs';
import { detectProject } from './detect.js';
import { exposureFilter } from './exposure.js';
import { copyProject, initBaseline, removeWorkspace, treeDigest } from './workspace.js';

export async function stepDetect(c) {
  return c.step('detect', () => detectProject(c.project.source));
}

// Isolated working copy of the ORIGINAL project, with a baseline commit to diff against.
export async function stepWorkspace(c) {
  return c.step('workspace', async () => {
    // a previous attempt may have been interrupted mid-copy; starting on top of leftovers would mix two states
    const cleared = removeWorkspace(c.workspace);
    if (!cleared.ok && existsSync(c.workspace)) throw new Error(`The previous working copy could not be removed (${cleared.error}). Close anything using ${c.workspace} and resume.`);
    const before = treeDigest(c.project.source);
    const copied = copyProject(c.project.source, c.workspace, { maxBytes: c.project.limits.maxCopyBytes, maxFiles: c.project.limits.maxCopyFiles, exclude: exposureFilter(c.project, c.config) });
    const exposure = c.exposureCheck(copied);
    const baseline = await initBaseline(c.workspace);
    const after = treeDigest(c.project.source);
    if (before.sha256 !== after.sha256) throw new Error('The source project changed while it was being copied; nothing was recorded. Re-run when it is stable.');
    c.run.source_digest = before.sha256;
    c.save();
    return { baseline_commit: baseline, source_digest: before.sha256, files: copied.files, bytes: copied.bytes, skipped: copied.skipped, excluded: copied.excluded, exposure };
  });
}

// Configured commands win; otherwise the detected candidates whose tool exists.
export function resolveCommands(project, detection) {
  const configured = (list) => list.map((command) => ({ command, source: 'configured' }));
  const detected = (list) => list.filter((c) => c.tool_available).map((c) => ({ command: c.command, source: `detected (${c.source})` }));
  return {
    build: project.commands.build.length ? configured(project.commands.build) : detected(detection?.build ?? []),
    test: project.commands.test.length ? configured(project.commands.test) : detected(detection?.test ?? []),
  };
}

export function mergeTests(results) {
  const parsed = results.map((r) => r.tests).filter(Boolean);
  if (parsed.length === 0) return null;
  const passed = new Set();
  const failed = new Set();
  const skipped = new Set();
  for (const t of parsed) {
    t.passed.forEach((x) => passed.add(x));
    t.failed.forEach((x) => failed.add(x));
    t.skipped.forEach((x) => skipped.add(x));
  }
  for (const f of failed) passed.delete(f);
  return { formats: [...new Set(parsed.map((t) => t.format))], passed: [...passed].sort(), failed: [...failed].sort(), skipped: [...skipped].sort() };
}

// Runs build, test and (optionally) acceptance commands in the working copy.
export async function runVerification(c, commands, { acceptance = true } = {}) {
  const build = await c.commands(commands.build, 'build');
  const test = await c.commands(commands.test, 'test');
  const accept = acceptance ? await c.commands(c.project.acceptance.commands.map((a) => ({ command: a.command, name: a.name, source: 'acceptance' })), 'acceptance') : [];
  return {
    build,
    test,
    acceptance: accept,
    tests: mergeTests(test),
    build_ok: build.every((r) => r.ok),
    test_ok: test.every((r) => r.ok),
    acceptance_ok: accept.every((r) => r.ok),
  };
}

export const failedNames = (v) => v.tests?.failed ?? [];

export function summarizeCommands(v) {
  const line = (r) => `${r.kind}: \`${r.command}\` → ${r.timed_out ? 'timed out' : r.spawn_error ? `not started (${r.spawn_error})` : `exit ${r.exit_code}`} (${r.duration_ms} ms)`;
  return [...v.build, ...v.test, ...v.acceptance].map(line);
}
