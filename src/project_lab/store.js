// Independent per-project state (Project Lab):
//   <stateDir>/projects/<id>/project.json     configuration + status + approval
//   <stateDir>/projects/<id>/runs/<run>/run.json   one operation (review|modify|rebuild)
//   <stateDir>/projects/<id>/work/<run>/      isolated working copy for that run
//   <stateDir>/projects/<id>/ledger.jsonl     append-only events (agent spend, approvals, ...)
// Every file is written atomically; every project has its own lock.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { newId, writeJson } from '../core/util.js';
import { appendLedger, readLedger } from '../orchestration/ledger.js';
import { ID_PATTERN } from './schema.js';

export const RUN_ACTIVE = ['running'];
export const RUN_RESUMABLE = ['interrupted', 'failed', 'awaiting-implementation', 'running'];

export class ProjectStore {
  constructor(stateDir) {
    this.root = join(stateDir, 'projects');
  }

  dir(id) {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid project id "${id}".`);
    return join(this.root, id);
  }

  exists(id) {
    return existsSync(join(this.dir(id), 'project.json'));
  }

  load(id) {
    const file = join(this.dir(id), 'project.json');
    if (!existsSync(file)) throw new Error(`Unknown project "${id}". Create it with \`era project create\` or list projects with \`era project list\`.`);
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`Project "${id}" has a corrupt project.json: ${err.message}`, { cause: err });
    }
  }

  save(project) {
    project.updated_at = new Date().toISOString();
    writeJson(join(this.dir(project.id), 'project.json'), project);
    return project;
  }

  list() {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((id) => ID_PATTERN.test(id) && this.exists(id))
      .sort()
      .map((id) => this.load(id));
  }

  remove(id) {
    rmSync(this.dir(id), { recursive: true, force: true });
  }

  // ---- runs
  runDir(id, runId) {
    return join(this.dir(id), 'runs', runId);
  }

  workDir(id, runId) {
    return join(this.dir(id), 'work', runId);
  }

  newRun(project, op) {
    const dir = join(this.dir(project.id), 'runs');
    const run = {
      run_id: newId('run'),
      seq: (existsSync(dir) ? readdirSync(dir).length : 0) + 1, // counts directories, including a run that is still being created
      project_id: project.id,
      op,
      status: 'running',
      created_at: new Date().toISOString(),
      steps: {},
      results: {},
      attempts: [],
      pid: process.pid,
    };
    this.saveRun(run);
    return run;
  }

  loadRun(id, runId) {
    const file = join(this.runDir(id, runId), 'run.json');
    if (!existsSync(file)) throw new Error(`Unknown run "${runId}" in project "${id}".`);
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  saveRun(run) {
    run.updated_at = new Date().toISOString();
    writeJson(join(this.runDir(run.project_id, run.run_id), 'run.json'), run);
    return run;
  }

  listRuns(id) {
    const dir = join(this.dir(id), 'runs');
    if (!existsSync(dir)) return [];
    // Run IDs have one-second resolution: order by the run's sequence number, then creation time, then ID.
    // A run directory is created before its run.json is published (the write is atomic: temp file, then rename).
    // A directory without run.json is a run that is still being created, not a missing run: skip it.
    return readdirSync(dir)
      .filter((r) => existsSync(join(dir, r, 'run.json')))
      .map((r) => this.loadRun(id, r))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.created_at.localeCompare(b.created_at) || a.run_id.localeCompare(b.run_id));
  }

  latestRun(id, filter = () => true) {
    return this.listRuns(id).filter(filter).at(-1) ?? null;
  }

  // ---- ledger
  log(id, event) {
    return appendLedger(this.dir(id), event);
  }

  events(id) {
    return readLedger(this.dir(id));
  }
}

export function mkdirp(p) {
  mkdirSync(p, { recursive: true });
  return p;
}
