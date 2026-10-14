#!/usr/bin/env node
// REAL validation of screenshot-to-website rebuilding with OpenAI Codex.
//   REAL: the Codex CLI (your login; spends a little of your quota), the Electron renderer, Project Lab, the sandbox, git.
//   The "screenshot" is a capture of tests/fixtures/screenshot/page-a rendered by the real renderer (a page written for tests).
//   A CONTROL run gives Codex the identical task WITHOUT the image: if the image mattered, the control scores far lower.
// Usage: node scripts/validate-screenshot-rebuild.mjs [--out experiments/screenshot-rebuild]
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { createCodingAgent } from '../src/agents/coding-agents.js';
import { createProjectLab } from '../src/project_lab/lab.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { findRenderer, renderAndCompare } from '../src/project_lab/visual.js';
import { candidateIsolation } from '../src/safety/candidate-sandbox.js';
import { sandboxAvailable } from '../src/safety/sandbox.js';
import { redactText } from '../src/safety/secrets.js';
import { makePng } from '../tests/image-fixtures.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'experiments/screenshot-rebuild');
const tmpRoot = realpathSync(tmpdir());
const clean = (t) => redactText(String(t)).split(tmpRoot).join('<tmp>').split(homedir()).join('~').split(ROOT).join('<era>');
const sites = join(ROOT, 'tests/fixtures/screenshot');
const evidence = { validated_at: new Date().toISOString(), provider: 'codex', host: process.platform, runs: {} };

const renderer = findRenderer();
if (!renderer) throw new Error('No Electron renderer: run npm install in apps/studio.');
const probe = await createCodingAgent('codex', loadConfig(ROOT, {})).probe();
const auth = await createCodingAgent('codex', loadConfig(ROOT, {})).auth();
evidence.codex = { available: probe.available, version: probe.version, authenticated: auth.authenticated, detail: auth.detail };
if (!probe.available || auth.authenticated !== true) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'result.json'), `${JSON.stringify({ ...evidence, status: 'unavailable' }, null, 2)}\n`);
  console.log('Codex is not available or not signed in; nothing was run.');
  process.exit(0);
}

const work = realpathSync(mkdtempSync(join(tmpdir(), 'era-shot-')));
const iso = sandboxAvailable() ? candidateIsolation() : { mode: 'trusted', mechanism: 'none' };
mkdirSync(join(work, 'seed'), { recursive: true });
writeFileSync(join(work, 'seed', 'dummy.png'), makePng(1280, 720));
const ref = await renderAndCompare({ renderer, htmlPath: join(sites, 'page-a', 'index.html'), referencePath: join(work, 'seed', 'dummy.png'), outDir: join(work, 'ref'), width: 1280, height: 720, isolation: iso });
if (!ref.ok) throw new Error(`could not create the reference screenshot: ${ref.error}`);
const screenshot = join(work, 'ref', 'rendered.png');

async function rebuild(label, { withImage }) {
  const cwd = join(work, label);
  mkdirSync(cwd, { recursive: true });
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state') });
  // The user-visible policy switches, set explicitly for this validation (they are never on by default):
  config.projectLab = { ...config.projectLab, budget: { ...config.projectLab.budget, allowUnmeteredAgents: true } };
  const realCreate = (id, cfg) => {
    const a = createCodingAgent(id, cfg);
    if (withImage || id !== 'codex') return a;
    // CONTROL: same agent, same prompt, but the images are withheld.
    return { ...a, id: a.id, metered: a.metered, probe: a.probe.bind(a), auth: a.auth.bind(a), implement: (task) => a.implement({ ...task, images: [] }) };
  };
  const lab = createProjectLab({ config, rea: new ReaClient({ command: join(ROOT, 'tests/fixtures/fake-rea-engine.mjs'), stateDir: config.stateDirAbs, measureResources: false }), createAgent: realCreate });
  lab.create({ id: label, mode: 'rebuild', reference: screenshot, destination: join(cwd, 'site'), task: 'Recreate the page shown in the screenshot as a static website (index.html with its CSS). Match the layout, colors, proportions and every visible text.', authorization: 'The screenshot is of a test page written by the ERA maintainers for validation.', team: { roles: { implementer: 'codex' } }, exposure: { remote_consent: ['codex'] }, limits: { maxAttempts: 2, agentTimeoutMs: 900_000 }, trust_project: !sandboxAvailable() });
  const started = Date.now();
  const { run } = await lab.rebuild(label);
  const fin = run.results.finalize ?? null;
  const dest = join(out, label);
  mkdirSync(dest, { recursive: true });
  const runDir = lab.store.runDir(label, run.run_id);
  for (const f of ['report.md']) if (existsSync(join(runDir, f))) writeFileSync(join(dest, f), clean(readFileSync(join(runDir, f), 'utf8')));
  const ws = lab.store.workDir(label, run.run_id);
  for (const f of ['index.html']) if (existsSync(join(ws, f))) cpSync(join(ws, f), join(dest, f));
  for (const n of [1, 2]) if (existsSync(join(runDir, `visual-attempt-${n}`, 'rendered.png'))) cpSync(join(runDir, `visual-attempt-${n}`, 'rendered.png'), join(dest, `rendered-attempt-${n}.png`));
  cpSync(screenshot, join(dest, 'reference-screenshot.png'));
  const events = lab.store.events(label).filter((e) => e.type === 'implementer-finished');
  return {
    with_image: withImage,
    status: run.status,
    duration_s: Math.round((Date.now() - started) / 1000),
    attempts: run.attempts.map((a) => ({ n: a.n, pass: a.pass, reasons: a.reasons.map(clean) })),
    final_score: fin?.visual?.score ?? null,
    last_attempt_score: [...Object.entries(run.results)].filter(([k]) => k.startsWith('verify-')).map(([, v]) => v.visual?.score ?? null),
    threshold: fin?.visual?.threshold ?? 0.75,
    metrics: fin?.visual?.metrics ?? null,
    files: fin?.files?.map((f) => `${f.status} ${f.path}`) ?? [],
    usage: events.map((e) => ({ duration_ms: e.duration_ms, usage: e.usage, ok: e.ok })),
    error: run.error ? clean(run.error) : null,
    images_sent: events.length ? withImage : false,
    metadata_removed: run.results.reference?.images?.[0]?.metadata_removed ?? [],
  };
}

// A BLIND control that cannot find the image: Codex gets only a generic brief in an empty directory (no image, no file
// names to search for, no spec). Its page is scored against the same screenshot with the same renderer. The earlier control
// that reused the rebuild flow minus the image argument was INVALID (see evidence): the agent located the reference file on
// disk by the name listed in the specification and viewed it, because Codex's sandbox allows reading anywhere.
async function blindControl() {
  const dir = join(work, 'blind');
  mkdirSync(dir, { recursive: true });
  const agent = createCodingAgent('codex', loadConfig(ROOT, {}));
  const started = Date.now();
  const r = await agent.implement({ worktree: dir, cycleId: 'control', timeoutMs: 900_000, budgetUsd: null, instructionsFile: '', proposalFile: '', prompt: 'Create a static landing page for a small coffee roastery: index.html with its CSS in the current directory. It must work offline (no external resources). Reply with one sentence when done.' });
  const page = join(dir, 'index.html');
  const res = existsSync(page) ? await renderAndCompare({ renderer, htmlPath: page, referencePath: screenshot, outDir: join(work, 'blind-out'), width: 1280, height: 720, isolation: iso }) : { ok: false, error: 'no index.html was produced' };
  const dest = join(out, 'blind-control');
  mkdirSync(dest, { recursive: true });
  if (existsSync(page)) cpSync(page, join(dest, 'index.html'));
  if (res.ok) cpSync(join(work, 'blind-out', 'rendered.png'), join(dest, 'rendered.png'));
  return { agent_ok: r.ok, duration_s: Math.round((Date.now() - started) / 1000), tokens: r.tokens, score: res.ok ? res.score : null, metrics: res.ok ? res.metrics : null, error: res.ok ? null : res.error, text_contains_reference_content: existsSync(page) ? /Northwind|Single origin|Harbour/i.test(readFileSync(page, 'utf8')) : false };
}

mkdirSync(out, { recursive: true });
const resultFile = join(out, 'result.json');
if (args.includes('--control-only') && existsSync(resultFile)) {
  // Keep the already recorded with-image run; replace the invalid control by the blind one.
  const prev = JSON.parse(readFileSync(resultFile, 'utf8'));
  evidence.runs = prev.runs;
  if (evidence.runs.control_without_image) {
    evidence.runs.control_1_invalid = { ...evidence.runs.control_without_image, invalid: 'The agent found the reference screenshot on disk (its file name was listed in the specification) and viewed it, so this was not a blind control: its page reproduces text only the screenshot contained.' };
    delete evidence.runs.control_without_image;
  }
  evidence.codex = prev.codex;
  evidence.validated_at = prev.validated_at;
} else {
  console.log('Run 1/2: Codex WITH the screenshot …');
  evidence.runs.with_image = await rebuild('with-image', { withImage: true });
  console.log(JSON.stringify({ status: evidence.runs.with_image.status, scores: evidence.runs.with_image.last_attempt_score }));
}
console.log('Blind control: Codex WITHOUT any image …');
evidence.runs.control_blind = await blindControl();
console.log(JSON.stringify({ score: evidence.runs.control_blind.score, leaked: evidence.runs.control_blind.text_contains_reference_content }));
evidence.status = 'completed';
evidence.summary = { with_image_best: Math.max(...(evidence.runs.with_image.last_attempt_score ?? []).filter((x) => x !== null), 0), blind_control: evidence.runs.control_blind.score };
writeFileSync(resultFile, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Evidence written to ${out}`);
