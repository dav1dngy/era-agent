// Shared machinery for Project Lab operations: checkpointed steps, command
// execution, agent invocation (budget, ledger, redaction) and integrity checks.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../core/util.js';
import { redactText } from '../safety/secrets.js';
import { authorizeAgentRun, effectiveBudget, SafetyError } from '../safety/policy.js';
import { candidateIsolation, protectedStatePaths, wrapCandidate } from '../safety/candidate-sandbox.js';
import { sandboxAvailable } from '../safety/sandbox.js';
import { spentUsd } from '../orchestration/cycle.js';
import { runProjectCommand } from './runner.js';
import { treeDigest } from './workspace.js';

// Raised by a step that cannot continue until a human acts (manual agent).
export class Pause extends Error {
  constructor(message, status = 'awaiting-implementation') {
    super(message);
    this.name = 'Pause';
    this.status = status;
  }
}

const slimCommand = ({ stdout: _stdout, ...rest }) => rest;

export class RunContext {
  constructor({ lab, project, run, guard }) {
    this.lab = lab;
    this.project = project;
    this.run = run;
    this.guard = guard;
    this.store = lab.store;
    this.config = lab.config;
    this.rea = lab.rea;
    this.log = lab.log.child({ correlation_id: run.run_id, project_id: project.id });
    this.runDir = this.store.runDir(project.id, run.run_id);
    this.workspace = this.store.workDir(project.id, run.run_id);
    mkdirSync(this.runDir, { recursive: true });
  }

  save() {
    this.store.saveRun(this.run);
  }

  // Idempotent, checkpointed unit of work. A finished step is never repeated on resume.
  async step(name, fn) {
    this.guard.check();
    const prev = this.run.steps[name];
    if (prev?.status === 'done') return this.run.results[name];
    const started = Date.now();
    this.run.steps[name] = { status: 'running', started_at: new Date().toISOString() };
    this.run.current_step = name;
    this.save();
    this.log.info('project.step.start', { step: name, op: this.run.op });
    let result;
    try {
      result = await fn();
    } catch (err) {
      this.run.steps[name] = { ...this.run.steps[name], status: err instanceof Pause ? 'paused' : 'failed', error: err.message };
      this.save();
      throw err;
    }
    this.guard.check();
    this.run.steps[name] = { ...this.run.steps[name], status: 'done', finished_at: new Date().toISOString(), duration_ms: Date.now() - started };
    this.run.results[name] = result ?? null;
    this.save();
    this.log.info('project.step.done', { step: name, duration_ms: Date.now() - started });
    return result;
  }

  // Forgets a step so it runs again (used when a human fixes things and resumes).
  reset(...names) {
    for (const n of names) {
      delete this.run.steps[n];
      delete this.run.results[n];
    }
    this.save();
  }

  writeArtifact(name, text) {
    const file = join(this.runDir, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
    return file;
  }

  readArtifact(name) {
    const file = join(this.runDir, name);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }

  // ---- isolation of project commands
  isolation() {
    // Fails closed (SafetyError) where no sandbox exists, unless the maintainer trusts the project.
    return candidateIsolation({ trust: !!this.project.trust_project || !!this.run.trust_project });
  }

  denyRead() {
    const others = this.store.list().map((p) => p.id);
    return [...protectedStatePaths(this.config.stateDirAbs), ...others.filter((id) => id !== this.project.id).map((id) => this.store.dir(id))];
  }

  // ---- project commands (build, test, acceptance) in the working copy
  async command(command, { cwd = this.workspace, input = null, timeoutMs = this.project.limits.commandTimeoutMs } = {}) {
    this.guard.check();
    const r = await runProjectCommand({ command, cwd, timeoutMs, isolation: this.isolation(), denyRead: this.denyRead(), input });
    this.guard.check();
    this.log.info('project.command', { command: command.slice(0, 200), exit_code: r.exit_code, duration_ms: r.duration_ms, timed_out: r.timed_out });
    return r;
  }

  async commands(list, kind) {
    const out = [];
    for (const c of list) {
      const spec = typeof c === 'string' ? { command: c } : c;
      const r = await this.command(spec.command);
      out.push({ ...slimCommand(r), name: spec.name ?? kind, kind, command_source: spec.source ?? 'configured' });
    }
    return out;
  }

  // ---- coding agent
  agent() {
    if (!this._agent) {
      const id = this.project.agent ?? this.config.projectLab?.agent ?? 'manual';
      const cfg = { ...this.config, improvement: { ...this.config.improvement, implementerCommand: this.project.agent_command ?? this.config.projectLab?.agentCommand ?? this.config.improvement?.implementerCommand } };
      this._agent = this.lab.createAgent(id, cfg);
    }
    return this._agent;
  }

  budget() {
    const pb = this.config.projectLab?.budget ?? {};
    return effectiveBudget({ maxCostUsdPerCycle: this.project.limits.maxCostUsd, maxCostUsdTotal: this.project.limits.maxCostUsdTotal, allowUnmeteredAgents: pb.allowUnmeteredAgents === true });
  }

  async invokeAgent({ phase, prompt, readOnly = false, attempt = 1 }) {
    const agent = this.agent();
    if (agent.id === 'manual') return { manual: true, agent: 'manual' };
    const probe = await agent.probe();
    if (!probe.available) throw new Error(`Coding agent "${agent.id}" is not available: ${probe.detail}`);
    const events = this.store.events(this.project.id);
    const budget = this.budget();
    const perRunLeft = budget.maxCostUsdPerCycle - spentUsd(events, this.run.run_id);
    if (agent.metered && perRunLeft <= 0) throw new SafetyError(`Per-run coding-agent budget exhausted for ${this.run.run_id} ($${budget.maxCostUsdPerCycle.toFixed(2)}).`);
    const budgetUsd = Math.min(authorizeAgentRun({ agent, budget, spentUsd: spentUsd(events) }), perRunLeft);
    const agentRunId = newId('agent');
    const promptText = redactText(prompt);
    const promptFile = this.writeArtifact(`prompts/${phase}-${attempt}.md`, promptText);
    this.store.log(this.project.id, { type: 'implementer-started', run_id: agentRunId, cycle_id: this.run.run_id, agent: agent.id, phase, attempt, budget_usd: agent.metered ? budgetUsd : null });
    const isolation = sandboxAvailable() ? candidateIsolation() : null;
    const task = {
      worktree: this.workspace,
      prompt: promptText,
      instructionsFile: promptFile,
      proposalFile: join(this.runDir, 'run.json'),
      cycleId: this.run.run_id,
      phase,
      readOnly,
      timeoutMs: this.project.limits.agentTimeoutMs,
      budgetUsd: agent.metered ? budgetUsd : null,
      // A configured agent command may use the network and its own credentials, but
      // can write only inside the working copy and a private temp directory.
      wrapCommand: isolation ? (command, args, env) => wrapCandidate(isolation, command, args, { writable: [this.workspace], denyRead: this.denyRead(), tmp: this.workspace + '.tmp', env, network: true, keepEnv: true }) : undefined,
    };
    if (task.wrapCommand) mkdirSync(this.workspace + '.tmp', { recursive: true });
    const result = await agent.implement(task);
    this.guard.check();
    const output = result.output ?? '';
    if (output) this.writeArtifact(`agent/${phase}-${attempt}.txt`, output);
    this.store.log(this.project.id, { type: 'implementer-finished', run_id: agentRunId, cycle_id: this.run.run_id, agent: agent.id, phase, attempt, ok: !!result.ok, cost_usd: result.cost_usd ?? null, cost_reported: !!result.cost_reported, duration_ms: result.duration_ms ?? null });
    this.log.info('project.agent', { agent: agent.id, phase, attempt, ok: !!result.ok, cost_usd: result.cost_usd ?? null, duration_ms: result.duration_ms ?? null });
    return { agent: agent.id, ok: !!result.ok, exit_code: result.exit_code ?? null, timed_out: !!result.timed_out, duration_ms: result.duration_ms ?? null, cost_usd: result.cost_usd ?? null, cost_reported: !!result.cost_reported, tokens: result.tokens ?? null, stdout_tail: result.stdout_tail ?? '', stderr_tail: result.stderr_tail ?? '', output, agent_run_id: agentRunId };
  }

  // ---- integrity: the original project must be byte-identical to when the run began.
  sourceDigest() {
    return this.project.source ? treeDigest(this.project.source).sha256 : null;
  }
}

export const slim = slimCommand;
