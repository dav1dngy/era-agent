// Shared machinery for Project Lab operations: checkpointed steps, command
// execution, agent invocation (budget, ledger, redaction) and integrity checks.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { newId } from '../core/util.js';
import { redactText } from '../safety/secrets.js';
import { authorizeAgentRun, effectiveBudget, SafetyError } from '../safety/policy.js';
import { candidateIsolation, protectedStatePaths, wrapCandidate } from '../safety/candidate-sandbox.js';
import { sandboxAvailable } from '../safety/sandbox.js';
import { spentUsd } from '../orchestration/cycle.js';
import { runProjectCommand } from './runner.js';
import { agentCapabilities } from '../agents/coding-agents.js';
import { assertRemoteConsent, remoteProviders, rolesOf } from '../agents/team.js';
import { exposureFilter, findWithheldNow, removeWithheld, scanSecretContent } from './exposure.js';
import { copyProject, removeWorkspace, treeDigest, wgit, workspaceChanges } from './workspace.js';

// Raised by a step that cannot continue until a human acts (manual agent).
export class Pause extends Error {
  constructor(message, status = 'awaiting-implementation') {
    super(message);
    this.name = 'Pause';
    this.status = status;
  }
}

// Token usage under neutral key names: the log redactor masks anything called "*token*" as a credential.
export const usageOf = (t) => (t ? { input: t.input_tokens ?? t.input ?? null, output: t.output_tokens ?? t.output ?? null, cached_input: t.cache_read_input_tokens ?? t.cached_input_tokens ?? null } : null);

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

  // ---- coding agents, by ROLE. Workflows ask for a role; the project's team decides who plays it.
  agentFor(role = 'implementer') {
    this._agents ??= {};
    if (!(role in this._agents)) {
      const id = rolesOf(this.project)[role] ?? (role === 'implementer' ? this.config.projectLab?.agent ?? 'manual' : null);
      const cfg = { ...this.config, improvement: { ...this.config.improvement, implementerCommand: this.project.agent_command ?? this.config.projectLab?.agentCommand ?? this.config.improvement?.implementerCommand } };
      this._agents[role] = id ? this.lab.createAgent(id, cfg) : null;
    }
    return this._agents[role];
  }

  agent() {
    return this.agentFor('implementer');
  }

  // How the implementer can see images ('flag' | 'read-tool' | 'env' | 'none').
  agentImageSupport() {
    const a = this.agent();
    return a ? agentCapabilities(a.id, this.config, { strict: false }).images ?? 'none' : 'none';
  }

  hasRole(role) {
    return !!rolesOf(this.project)[role];
  }

  // Remote providers need explicit consent; credential-like files were withheld when the copy was made;
  // secret-looking content in source files blocks transmission unless the user allowed it.
  exposureCheck(copied) {
    const roles = rolesOf(this.project);
    const exposure = this.project.exposure ?? { remote_consent: [], allow_secret_content: false };
    assertRemoteConsent(roles, exposure.remote_consent, this.config);
    const remote = remoteProviders(roles, this.config);
    const secrets = remote.length ? scanSecretContent(this.workspace) : [];
    if (secrets.length && !exposure.allow_secret_content) {
      throw new SafetyError(`Secret-looking content was found in ${secrets.length} source file(s) (${secrets.slice(0, 5).map((x) => `${x.file}: ${x.kind}`).join('; ')}). It would be sent to ${remote.join(', ')}. Remove the secrets from the project, or authorize this with exposure.allow_secret_content (--allow-secret-content).`);
    }
    const info = { remote_providers: remote, consented_providers: remote.filter((id) => exposure.remote_consent.includes(id)), withheld_files: (copied.excluded ?? []).map((e) => `${e.path} (${e.reason})`), secret_content_files: secrets.map((x) => `${x.file} (${x.kind})`), secret_content_allowed: !!exposure.allow_secret_content };
    this.run.exposure = info;
    this.save();
    this.store.log(this.project.id, { type: 'exposure-recorded', run_id: this.run.run_id, remote_providers: remote, withheld: info.withheld_files.length, secret_content_files: secrets.length });
    return info;
  }

  // Exposure is a property of each INVOCATION, not of the initial copy: build/test/acceptance commands and earlier agents can
  // recreate withheld instruction files and credential files, and role snapshots are copied later still. Before every agent
  // run, the directory that agent will see is checked again: withheld files are removed from that view, newly appearing
  // secret-looking content stops the run (fail closed), and the result is recorded per invocation.
  enforceInvocationExposure({ cwd, agent, caps, role, phase, attempt }) {
    const exposure = this.project.exposure ?? { remote_consent: [], allow_secret_content: false };
    const remote = !!caps.remote;
    const instructions = !!caps.readsInstructionFiles && exposure.keep_instruction_files !== true;
    if (!remote && !instructions) return { checked: false };
    const found = findWithheldNow(cwd, { remote, instructions });
    removeWithheld(cwd, found);
    const secrets = remote ? scanSecretContent(cwd) : [];
    const record = { at: new Date().toISOString(), role, phase, attempt, agent, remote, withheld_before_run: found.map((f) => f.path), secret_content_files: secrets.map((x) => `${x.file} (${x.kind})`) };
    this.run.exposure_invocations = [...(this.run.exposure_invocations ?? []), record].slice(-200);
    this.save();
    this.store.log(this.project.id, { type: 'exposure-checked', run_id: this.run.run_id, role, phase, attempt, agent, withheld_before_run: found.length, secret_content_files: secrets.length });
    if (secrets.length && !exposure.allow_secret_content) {
      throw new SafetyError(`Secret-looking content appeared in ${secrets.length} file(s) (${secrets.slice(0, 5).map((x) => `${x.file}: ${x.kind}`).join('; ')}) before the ${role} agent (${agent}) would run; it would be sent to a remote provider. The agent was not started. Remove the secrets, stop the project's commands from generating them, or authorize this with exposure.allow_secret_content (--allow-secret-content).`);
    }
    return { checked: true, withheld: found.map((f) => f.path) };
  }

  budget() {
    const pb = this.config.projectLab?.budget ?? {};
    return effectiveBudget({ maxCostUsdPerCycle: this.project.limits.maxCostUsd, maxCostUsdTotal: this.project.limits.maxCostUsdTotal, allowUnmeteredAgents: pb.allowUnmeteredAgents === true });
  }

  async invokeAgent({ phase, prompt, readOnly = false, attempt = 1, role = 'implementer', cwd = this.workspace, images = [] }) {
    const agent = this.agentFor(role);
    if (!agent) throw new Error(`No agent is assigned to the ${role} role.`);
    if (agent.id === 'manual') return { manual: true, agent: 'manual', role };
    const caps = agentCapabilities(agent.id, this.config, { strict: false });
    if (caps.remote && !(this.project.exposure?.remote_consent ?? []).includes(agent.id)) {
      throw new SafetyError(`Remote transmission of this project to ${agent.id} is not authorized (role: ${role}). Authorize it with --allow-remote ${agent.id}.`);
    }
    const probe = await agent.probe();
    if (!probe.available) throw new Error(`Coding agent "${agent.id}" is not available: ${probe.detail}`);
    this._authChecked ??= new Map();
    if (typeof agent.auth === 'function' && !this._authChecked.has(agent.id)) {
      const a = await agent.auth();
      if (a.authenticated === false) throw new Error(`Coding agent "${agent.id}" is not authenticated: ${a.detail}`);
      this._authChecked.set(agent.id, a);
    }
    // One agent at a time: two agents never edit (or race on) the same files, and a read-only role
    // never runs while a writer is active.
    if (this._active) throw new SafetyError(`Refusing to start the ${role} agent while the ${this._active.role} agent is still running.`);
    this._active = { role, agent: agent.id };
    try {
      if (images.length && (caps.images ?? 'none') === 'none') throw new Error(`Coding agent "${agent.id}" cannot look at images, so it cannot rebuild from a screenshot. Choose an agent with image support (for example Codex, or Claude Code) in the Agent Command Center.`);
      return await this.runAgentOnce({ agent, caps, phase, prompt, readOnly, attempt, role, cwd, images });
    } finally {
      this._active = null;
    }
  }

  async runAgentOnce({ agent, caps, phase, prompt, readOnly, attempt, role, cwd, images = [] }) {
    const events = this.store.events(this.project.id);
    const budget = this.budget();
    const perRunLeft = budget.maxCostUsdPerCycle - spentUsd(events, this.run.run_id);
    if (agent.metered && perRunLeft <= 0) throw new SafetyError(`Per-run coding-agent budget exhausted for ${this.run.run_id} ($${budget.maxCostUsdPerCycle.toFixed(2)}).`);
    const budgetUsd = Math.min(authorizeAgentRun({ agent, budget, spentUsd: spentUsd(events) }), perRunLeft);
    const agentRunId = newId('agent');
    const promptText = redactText(prompt);
    const promptFile = this.writeArtifact(`prompts/${role}-${phase}-${attempt}.md`, promptText);
    this.store.log(this.project.id, { type: 'implementer-started', run_id: agentRunId, cycle_id: this.run.run_id, agent: agent.id, role, phase, attempt, read_only: readOnly, images: images.length, budget_usd: agent.metered ? budgetUsd : null });
    const isolation = sandboxAvailable() ? candidateIsolation() : null;
    // Fresh exposure check of exactly what this agent will see (the live working copy or a role snapshot).
    this.enforceInvocationExposure({ cwd, agent: agent.id, caps, role, phase, attempt });
    const task = {
      worktree: cwd,
      prompt: promptText,
      instructionsFile: promptFile,
      proposalFile: join(this.runDir, 'run.json'),
      cycleId: this.run.run_id,
      phase,
      readOnly,
      timeoutMs: this.project.limits.agentTimeoutMs,
      images: images.map((i) => ({ path: i.path, name: i.name, mime: i.mime, width: i.width, height: i.height })),
      budgetUsd: agent.metered ? budgetUsd : null,
      // A configured agent command may use the network and its own credentials, but
      // can write only inside its own directory and a private temp directory.
      wrapCommand: isolation ? (command, args, env) => wrapCandidate(isolation, command, args, { writable: readOnly ? [] : [cwd], denyRead: this.denyRead(), tmp: cwd + '.tmp', env, network: true, keepEnv: true }) : undefined,
    };
    if (task.wrapCommand) mkdirSync(cwd + '.tmp', { recursive: true });
    // Read-only roles: prove nothing changed, in their directory and in the working copy.
    const before = readOnly ? this.fingerprint(cwd) : null;
    const result = await agent.implement(task);
    this.guard.check();
    if (readOnly) await this.assertUnchanged(before, cwd, { role, agent: agent.id, phase });
    const output = result.output ?? '';
    if (output) this.writeArtifact(`agent/${role}-${phase}-${attempt}.txt`, output);
    this.store.log(this.project.id, { type: 'implementer-finished', run_id: agentRunId, cycle_id: this.run.run_id, agent: agent.id, role, phase, attempt, ok: !!result.ok, cost_usd: result.cost_usd ?? null, cost_reported: !!result.cost_reported, usage: usageOf(result.tokens), duration_ms: result.duration_ms ?? null });
    this.log.info('project.agent', { agent: agent.id, role, phase, attempt, ok: !!result.ok, cost_usd: result.cost_usd ?? null, duration_ms: result.duration_ms ?? null });
    return { agent: agent.id, role, read_only: readOnly, ok: !!result.ok, exit_code: result.exit_code ?? null, timed_out: !!result.timed_out, duration_ms: result.duration_ms ?? null, cost_usd: result.cost_usd ?? null, cost_reported: !!result.cost_reported, usage: usageOf(result.tokens), stdout_tail: result.stdout_tail ?? '', stderr_tail: result.stderr_tail ?? '', output, agent_run_id: agentRunId, remote: caps.remote };
  }

  fingerprint(cwd) {
    return { dir: cwd, digest: treeDigest(cwd).sha256, workspace: cwd === this.workspace ? null : treeDigest(this.workspace).sha256 };
  }

  async assertUnchanged(before, cwd, meta) {
    const now = this.fingerprint(cwd);
    let changed = now.digest !== before.digest ? cwd : now.workspace !== before.workspace ? this.workspace : null;
    if (!changed && cwd === this.workspace && this.run.results.workspace?.baseline_commit) {
      const wc = await workspaceChanges(this.workspace, this.run.results.workspace.baseline_commit);
      if (wc.files.length) changed = this.workspace;
    }
    if (!changed) return;
    // Put the working copy back exactly as it was before a read-only role touched it.
    if (changed === this.workspace && this.run.op === 'review' && this.run.results.workspace?.baseline_commit) {
      await wgit(this.workspace, ['reset', '--hard', this.run.results.workspace.baseline_commit], { allowFail: true });
      await wgit(this.workspace, ['clean', '-fdq'], { allowFail: true });
    }
    this.store.log(this.project.id, { type: 'role-violation', run_id: this.run.run_id, role: meta.role, agent: meta.agent, phase: meta.phase, changed: changed === this.workspace ? 'working-copy' : 'role-directory' });
    throw new SafetyError(`READ-ONLY VIOLATION: the ${meta.role} agent (${meta.agent}) changed files although it was run read-only (${changed === this.workspace ? 'the working copy' : 'its own directory'}). Its output was discarded.`);
  }

  // Role-private copy of the working copy (no .git): read-only roles inspect it, never the live workspace.
  snapshot(name) {
    const dir = join(`${this.workspace}.roles`, name);
    removeWorkspace(dir);
    copyProject(this.workspace, dir, { maxBytes: this.project.limits.maxCopyBytes, maxFiles: this.project.limits.maxCopyFiles, exclude: exposureFilter(this.project, this.config) });
    return dir;
  }

  dropSnapshots() {
    removeWorkspace(`${this.workspace}.roles`);
    removeWorkspace(`${this.workspace}.roles.tmp`);
  }

  // Explicit, recorded hand-off of an artifact from one role to another. Receivers get the content
  // (redacted, bounded) inside their prompt; they never get ERA's state directory.
  handoff({ from, to, name, content }) {
    const text = redactText(String(content)).slice(0, 200_000);
    this.writeArtifact(`handoffs/${name}`, text);
    const entry = { from, to, artifact: `handoffs/${name}`, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), at: new Date().toISOString() };
    this.run.handoffs = [...(this.run.handoffs ?? []).filter((h) => h.artifact !== entry.artifact), entry];
    this.save();
    this.store.log(this.project.id, { type: 'handoff', run_id: this.run.run_id, from, to, artifact: entry.artifact, sha256: entry.sha256 });
    return text;
  }

  // ---- integrity: the original project must be byte-identical to when the run began.
  sourceDigest() {
    return this.project.source ? treeDigest(this.project.source).sha256 : null;
  }
}

export const slim = slimCommand;
