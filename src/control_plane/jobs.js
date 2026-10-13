// Execution-plane job manager. A job is an existing ERA CLI command run as a supervised child process
// (`era project modify …`, `era analyze …`, `era improve …`): the same code path, locks, sandboxing,
// cancellation and recovery as on the command line. The control plane only schedules, observes and
// records. Progress comes from the backend's own state files through `poll`, never from the UI.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from '../core/util.js';
import { redactText } from '../safety/secrets.js';

const ERA_BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'era.mjs');
const TAIL_LINES = 500;

// The CLI prints its --json result last; anything before it (progress text) is ignored.
function parseTrailingJson(text) {
  const t = text.trim();
  for (let i = t.indexOf('{'); i >= 0; i = t.indexOf('\n{', i + 1) + 1 || -1) {
    try {
      return JSON.parse(t.slice(i));
    } catch {
      // try the next candidate start
    }
  }
  return null;
}
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'interrupted'];


export class JobManager {
  constructor({ config, bus, audit, getSettings, eraBin = ERA_BIN, env = process.env }) {
    this.config = config;
    this.bus = bus;
    this.audit = audit;
    this.getSettings = getSettings;
    this.eraBin = eraBin;
    this.env = env;
    this.dir = join(config.stateDirAbs, 'studio', 'jobs');
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.jobs = new Map();
    this.children = new Map();
    this.pollers = new Map();
    this.queue = [];
    this.runtime = new Map();
    this.listeners = new Set();
    this.closing = false;
    this.load();
  }

  load() {
    for (const f of readdirSync(this.dir).filter((n) => n.endsWith('.json'))) {
      try {
        const job = JSON.parse(readFileSync(join(this.dir, f), 'utf8'));
        if (TERMINAL.includes(job.status) && Date.parse(job.finished_at) < Date.now() - this.getSettings().privacy.logRetentionDays * 86_400_000) {
          unlinkSync(join(this.dir, f));
          continue;
        }
        // A restarted server cannot reattach pipes or supervise an old PID (it may even have been reused).
        // Project Lab's own locks still prevent resuming over a surviving project process.
        if (!TERMINAL.includes(job.status)) {
          job.status = 'interrupted';
          job.finished_at ??= new Date().toISOString();
          job.error ??= 'ERA Studio restarted and no longer owns this job. Check for a surviving process before resuming; Project Lab enforces its run lock.';
          this.persist(job);
        }
        this.jobs.set(job.id, job);
      } catch {
        // an unreadable record is ignored
      }
    }
  }

  persist(job) {
    const file = join(this.dir, `${job.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  }

  summary(job) {
    const { log_tail: _log, ...rest } = job;
    return rest;
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((j) => this.summary(j));
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  active(projectId) {
    return [...this.jobs.values()].find((j) => j.project_id === projectId && !TERMINAL.includes(j.status)) ?? null;
  }

  onFinish(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // spec: { kind, label, args: [..era args..], project_id?, poll?: () => snapshot, cancel?: async () => void, env?: {} }
  start(spec) {
    if (this.closing) throw new Error('ERA Studio is shutting down.');
    if (spec.project_id && this.active(spec.project_id)) {
      const e = new Error(`Project "${spec.project_id}" already has an active job (${this.active(spec.project_id).id}).`);
      e.status = 409;
      throw e;
    }
    const job = { id: newId('job'), kind: spec.kind, label: spec.label, project_id: spec.project_id ?? null, args: (spec.exec ? spec.exec.args : spec.args).map((a) => redactText(String(a))), status: 'queued', created_at: new Date().toISOString(), started_at: null, finished_at: null, exit_code: null, signal: null, pid: null, cancel_requested: false, result: null, error: null, log_tail: [] };
    this.jobs.set(job.id, job);
    this.runtime.set(job.id, spec);
    this.persist(job);
    this.queue.push(job.id);
    this.audit.record('job.queued', { job_id: job.id, kind: job.kind, project_id: job.project_id, args: job.args });
    this.bus.publish('job.updated', { job: this.summary(job) });
    this.pump();
    return this.summary(job);
  }

  pump() {
    if (this.closing) return;
    const max = this.getSettings().execution.concurrentJobs;
    while (this.queue.length && [...this.jobs.values()].filter((j) => j.status === 'running').length < max) {
      const id = this.queue.shift();
      const job = this.jobs.get(id);
      if (job?.status === 'queued') this.spawnJob(job);
    }
  }

  spawnJob(job) {
    const spec = this.runtime.get(job.id);
    const env = { ...this.env, ...(spec.env ?? {}), ERA_STATE_DIR: this.config.stateDirAbs };
    delete env.NODE_TEST_CONTEXT;
    // Inside the Electron shell, process.execPath is the Electron binary: run it as plain Node for CLI jobs.
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    let child;
    try {
      // Normally the ERA CLI; services may also build an allowlisted fixed command (git clone), never from raw client input.
      const [file, argv] = spec.exec ? [spec.exec.command, spec.exec.args] : [process.execPath, [this.eraBin, ...spec.args]];
      child = spawn(file, argv, { cwd: spec.cwd ?? this.config.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (err) {
      this.finish(job, { status: 'failed', error: err.message });
      return;
    }
    this.children.set(job.id, child);
    job.status = 'running';
    job.started_at = new Date().toISOString();
    job.pid = child.pid;
    this.persist(job);
    this.bus.publish('job.updated', { job: this.summary(job) });
    let stdout = '';
    const feed = (stream) => (chunk) => {
      const text = redactText(chunk.toString('utf8'));
      if (stream === 'stdout') stdout = (stdout + text).slice(-2_000_000);
      const lines = text.split('\n').filter((l) => l.length);
      if (!lines.length) return;
      job.log_tail.push(...lines.map((l) => `${stream === 'stderr' ? '! ' : ''}${l}`));
      if (job.log_tail.length > TAIL_LINES) job.log_tail.splice(0, job.log_tail.length - TAIL_LINES);
      this.bus.publish('job.log', { job_id: job.id, stream, lines: lines.slice(-50) });
    };
    child.stdout.on('data', feed('stdout'));
    child.stderr.on('data', feed('stderr'));
    if (spec.poll) {
      let last = '';
      const tick = () => {
        try {
          const snap = spec.poll();
          const text = JSON.stringify(snap);
          if (text !== last) {
            last = text;
            this.bus.publish('progress', { job_id: job.id, project_id: job.project_id, snapshot: snap });
          }
        } catch {
          // state files may be mid-write; the next tick retries
        }
      };
      tick();
      this.pollers.set(job.id, setInterval(tick, 700));
    }
    child.on('error', (err) => this.finish(job, { status: 'failed', error: `could not start: ${err.message}` }));
    child.on('close', (code, signal) => {
      const result = parseTrailingJson(stdout);
      const status = job.cancel_requested ? 'cancelled' : code === 0 ? 'succeeded' : signal ? 'interrupted' : 'failed';
      const analysisErrors = result?.runs?.flatMap((r) => r.errors ?? []).join('; ');
      const err = status === 'failed' || status === 'interrupted' ? job.log_tail.filter((l) => l.startsWith('! ')).slice(-3).map((l) => l.slice(2)).join('\n') || analysisErrors || `exited with code ${code}` : null;
      this.finish(job, { status, exit_code: code, signal, result, error: err });
    });
  }

  finish(job, patch) {
    if (TERMINAL.includes(job.status)) return;
    Object.assign(job, patch, { finished_at: new Date().toISOString() });
    const poller = this.pollers.get(job.id);
    if (poller) clearInterval(poller);
    this.pollers.delete(job.id);
    this.children.delete(job.id);
    this.runtime?.delete(job.id);
    this.persist(job);
    this.audit.record('job.finished', { job_id: job.id, kind: job.kind, status: job.status, exit_code: job.exit_code });
    this.bus.publish('job.updated', { job: this.summary(job) });
    for (const fn of this.listeners) {
      try {
        fn(job);
      } catch {
        // a listener must not break job accounting
      }
    }
    this.pump();
  }

  async cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (TERMINAL.includes(job.status)) return this.summary(job);
    job.cancel_requested = true;
    this.audit.record('job.cancel', { job_id: id, kind: job.kind });
    if (job.status === 'queued') {
      this.queue = this.queue.filter((q) => q !== id);
      this.finish(job, { status: 'cancelled' });
      return this.summary(job);
    }
    const spec = this.runtime?.get(id);
    try {
      if (spec?.cancel) await spec.cancel();
    } catch (err) {
      job.error = `cancel: ${err.message}`;
    }
    const child = this.children.get(id);
    if (child && job.status === 'running') {
      // Give the backend's own cancellation a moment, then stop the process group.
      const kill = (sig) => {
        try {
          process.kill(-child.pid, sig);
        } catch {
          // already gone
        }
      };
      if (!spec?.cancel) kill('SIGTERM');
      setTimeout(() => this.children.has(id) && kill('SIGKILL'), 10_000).unref();
    }
    this.bus.publish('job.updated', { job: this.summary(job) });
    return this.summary(job);
  }

  // Server shutdown: stop running jobs gracefully; project runs stay resumable.
  async shutdown() {
    this.closing = true;
    for (const id of this.queue.splice(0)) {
      const job = this.jobs.get(id);
      if (job?.status === 'queued') this.finish(job, { status: 'interrupted', error: 'ERA Studio closed before this job started.' });
    }
    const pending = [...this.children.entries()];
    for (const [id, child] of pending) {
      this.jobs.get(id).error ??= 'ERA Studio closed while this job was running.';
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    if (pending.length) await new Promise((r) => setTimeout(r, 1500));
    for (const [id, child] of pending) {
      if (!this.children.has(id)) continue;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      this.finish(this.jobs.get(id), { status: 'interrupted', error: 'ERA Studio closed while this job was running.' });
    }
    for (const p of this.pollers.values()) clearInterval(p);
  }
}
