#!/usr/bin/env node
// ERA Studio measurement harness (Phase 3B). Measures real processes; invents nothing.
//   node experiments/studio-baseline/measure.mjs [--root DIR] [--out FILE] [--n N] [--only cp,electron,rea,fixpath]
// --root lets the same harness measure a candidate worktree for before/after comparison.
import { spawn, spawnSync, execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, cpus, totalmem, loadavg, release, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = resolve(arg('root', process.cwd()));
const N = Number(arg('n', 10));
const only = new Set(String(arg('only', 'cp,electron,rea,fixpath')).split(','));
const out = arg('out', join(ROOT, 'experiments', 'studio-baseline', 'results.json'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: +s[0].toFixed(2), median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) };
};
const ps = (pid) => {
  const r = spawnSync('ps', ['-o', 'rss=,time=', '-p', String(pid)], { encoding: 'utf8' });
  const [rss, time] = r.stdout.trim().split(/\s+/);
  const parts = (time ?? '0:0.00').split(':').map(Number);
  const cpuSeconds = parts.reduce((a, b) => a * 60 + b, 0);
  return { rssMb: +(Number(rss) / 1024).toFixed(1), cpuSeconds };
};
const tree = (pid) => {
  // Sum RSS over the whole process tree (Electron is multi-process).
  const all = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,time='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/));
  const kids = new Map();
  for (const [p, pp, rss, time] of all) { (kids.get(pp) ?? kids.set(pp, []).get(pp)).push({ p, rss: Number(rss), time }); }
  const self = all.find((r) => r[0] === String(pid));
  let rss = self ? Number(self[2]) : 0, count = self ? 1 : 0;
  const seen = new Set([String(pid)]);
  const walk = (p) => { for (const k of kids.get(String(p)) ?? []) { if (seen.has(k.p)) continue; seen.add(k.p); rss += k.rss; count++; walk(k.p); } };
  walk(pid);
  return { processes: count, rssMb: +(rss / 1024).toFixed(1) };
};
const fresh = () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'era-baseline-'));
  return { stateDir, env: { ...process.env, ERA_STATE_DIR: stateDir, ERA_NO_UPDATE_CHECK: '1' } };
};

const result = {
  harness: 'experiments/studio-baseline/measure.mjs',
  measuredAt: new Date().toISOString(),
  root: '<repo>', // the checkout measured (absolute path omitted)
  environment: {
    hardware: cpus()[0]?.model, cpuCount: cpus().length, memGb: +(totalmem() / 2 ** 30).toFixed(1),
    os: `${platform()} ${release()} ${arch()}`, node: process.version,
    electron: existsSync(join(ROOT, 'apps/studio/node_modules/electron/package.json')) ? JSON.parse((await import('node:fs')).readFileSync(join(ROOT, 'apps/studio/node_modules/electron/package.json'), 'utf8')).version : null,
    power: spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).stdout.split('\n')[0],
    loadavgBefore: loadavg().map((x) => +x.toFixed(2)),
    note: 'Other desktop apps (Claude, ChatGPT/Codex) were running on this machine; measurements include that background noise.',
  },
  runs: N,
};

async function http(url, token, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status };
}

async function controlPlane() {
  const startup = [], toFirstOk = [];
  let last;
  for (let i = 0; i < N; i++) {
    const { env } = fresh();
    const t0 = performance.now();
    const child = spawn(process.execPath, [join(ROOT, 'bin/era.mjs'), 'studio', 'serve', '--json'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const info = await new Promise((res, rej) => {
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; try { res(JSON.parse(buf)); } catch { /* wait for the full object */ } });
      child.on('exit', (c) => rej(new Error(`serve exited ${c}`)));
      setTimeout(() => rej(new Error('serve timeout')), 30000);
    });
    startup.push(performance.now() - t0);
    const base = info.url;
    const first = await http(`${base}/api/overview`, info.token);
    toFirstOk.push(performance.now() - t0);
    if (first.status !== 200) throw new Error(`overview ${first.status}`);
    if (i === N - 1) last = { child, info, base };
    else { child.kill('SIGTERM'); await sleep(300); }
    if (i === 0) await sleep(0);
  }
  const { child, info, base } = last;
  await sleep(1500);
  const a = ps(child.pid); const w0 = performance.now();
  await sleep(10000);
  const b = ps(child.pid);
  const idleCpuPct = +(((b.cpuSeconds - a.cpuSeconds) / ((performance.now() - w0) / 1000)) * 100).toFixed(2);
  // Latency: cold first request, then 30 sequential warm requests per endpoint.
  const endpoints = ['/', '/api/overview', '/api/projects', '/api/agents', '/api/improvement', '/api/diagnostics', '/api/tools', '/api/jobs', '/api/settings'];
  const latency = {};
  for (const ep of endpoints) {
    const cold = await http(`${base}${ep}`, info.token);
    const warm = [];
    for (let i = 0; i < 30; i++) warm.push((await http(`${base}${ep}`, info.token)).ms);
    latency[ep] = { status: cold.status, coldMs: +cold.ms.toFixed(2), warm: stats(warm) };
  }
  // Concurrency: 8 parallel requests x 3 rounds.
  const conc = [];
  for (let r = 0; r < 3; r++) { const t = performance.now(); await Promise.all(Array.from({ length: 8 }, () => http(`${base}/api/overview`, info.token))); conc.push(performance.now() - t); }
  const unauth = await fetch(`${base}/api/overview`).then((r) => r.status);
  const peak = ps(child.pid);
  child.kill('SIGTERM');
  return { startupToListeningMs: stats(startup), startupToFirstApiOkMs: stats(toFirstOk), idle: { rssMbAtStart: a.rssMb, rssMbAfter10s: b.rssMb, cpuPercentOver10s: idleCpuPct }, rssMbAfterLatencyRun: peak.rssMb, latency, concurrency8x3WallMs: stats(conc), unauthenticatedStatus: unauth };
}

async function electronSmoke() {
  const electron = join(ROOT, 'apps/studio/node_modules/.bin/electron');
  if (!existsSync(electron)) return { skipped: 'electron not installed' };
  const wall = [], details = [];
  for (let i = 0; i < N; i++) {
    const { env } = fresh();
    const t0 = performance.now();
    const r = await new Promise((res) => {
      const c = spawn(electron, [join(ROOT, 'apps/studio'), '--smoke'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let o = '';
      c.stdout.on('data', (d) => { o += d; });
      c.on('exit', (code) => res({ code, o }));
      setTimeout(() => { c.kill('SIGKILL'); res({ code: 'timeout', o }); }, 90000);
    });
    wall.push(performance.now() - t0);
    const line = r.o.split('\n').find((l) => l.startsWith('{')) ?? '';
    details.push({ exit: r.code, ok: line.includes('"ok":true') });
  }
  return { smokeWallMs: stats(wall), allOk: details.every((d) => d.ok && d.exit === 0), note: '--smoke = process start, PATH fix, control plane start, hidden window load, shell rendered, one API call, clean quit.' };
}

async function electronRunning() {
  // Shown window, idle: process-tree memory and CPU (the real desktop experience). Window opens briefly on screen.
  const electron = join(ROOT, 'apps/studio/node_modules/.bin/electron');
  if (!existsSync(electron)) return { skipped: 'electron not installed' };
  const { env } = fresh();
  const c = spawn(electron, [join(ROOT, 'apps/studio')], { env, stdio: 'ignore' });
  await sleep(12000);
  const a = tree(c.pid); const t0 = performance.now(); const cpuA = cpuSum(c.pid);
  await sleep(10000);
  const b = tree(c.pid); const cpuB = cpuSum(c.pid);
  const pct = +(((cpuB - cpuA) / ((performance.now() - t0) / 1000)) * 100).toFixed(2);
  c.kill('SIGTERM'); await sleep(1500);
  return { after12s: a, after22s: b, treeCpuPercentOver10s: pct };
}
function cpuSum(pid) {
  const all = spawnSync('ps', ['-axo', 'pid=,ppid=,time='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/));
  const kids = new Map(); for (const [p, pp, t] of all) (kids.get(pp) ?? kids.set(pp, []).get(pp)).push([p, t]);
  const secs = (t) => t.split(':').map(Number).reduce((x, y) => x * 60 + y, 0);
  let sum = 0; const seen = new Set();
  const self = all.find((r) => r[0] === String(pid)); if (self) sum += secs(self[2]);
  const walk = (p) => { for (const [k, t] of kids.get(String(p)) ?? []) { if (seen.has(k)) continue; seen.add(k); sum += secs(t); walk(k); } };
  walk(pid); return sum;
}

async function fixpath() {
  // The same two operations Studio's fixPath() performs before opening the window.
  const shell = process.env.SHELL || '/bin/zsh';
  const login = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await new Promise((res) => execFile(shell, ['-ilc', 'printf %s "$PATH"'], { timeout: 4000 }, () => res()));
    login.push(performance.now() - t0);
  }
  const nodeV = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await new Promise((res) => execFile(process.execPath, ['--version'], { timeout: 2000 }, () => res()));
    nodeV.push(performance.now() - t0);
  }
  return { interactiveLoginShellPathMs: stats(login), nodeVersionProbeMs: stats(nodeV), shell };
}

async function rea() {
  const target = join(ROOT, 'apps/studio/web/js/api.js');
  const run = (args) => { const { env } = fresh(); const t0 = performance.now(); const r = spawnSync(process.execPath, [join(ROOT, 'bin/era.mjs'), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 600000 }); return { ms: performance.now() - t0, status: r.status }; };
  const doctor = [], analyze = [];
  const n = Math.min(N, 5);
  for (let i = 0; i < n; i++) doctor.push(run(['rea', 'doctor']));
  for (let i = 0; i < Math.min(n, 3); i++) analyze.push(run(['analyze', target]));
  return { reaDoctorMs: stats(doctor.map((r) => r.ms)), reaDoctorExit: doctor.map((r) => r.status), analyzeSingleFileMs: stats(analyze.map((r) => r.ms)), analyzeExit: analyze.map((r) => r.status), target: 'apps/studio/web/js/api.js' };
}

if (only.has('fixpath')) { console.error('fixpath'); result.fixPath = await fixpath(); }
if (only.has('cp')) { console.error('control plane'); result.controlPlane = await controlPlane(); }
if (only.has('electron')) { console.error('electron smoke'); result.electronSmoke = await electronSmoke(); console.error('electron running'); result.electronRunning = await electronRunning(); }
if (only.has('rea')) { console.error('rea'); result.rea = await rea(); }
result.environment.loadavgAfter = loadavg().map((x) => +x.toFixed(2));
mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${out}`);
