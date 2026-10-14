// Preflight: everything that would stop (or weaken) an operation, reported BEFORE it starts, as one checklist.
// A check is { id, label, status: 'pass'|'warn'|'fail'|'info', message, fix? }. Any 'fail' blocks the operation.
// Nothing here changes state: it probes agents, reads paths and inspects configuration.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { detectTarget } from '../analysis/detect.js';
import { agentCapabilities } from '../agents/coding-agents.js';
import { assertRemoteConsent, rolesOf } from '../agents/team.js';
import { effectiveBudget } from '../safety/policy.js';
import { sandboxAvailable } from '../safety/sandbox.js';
import { detectProject } from './detect.js';
import { imageReferencePaths, inspectImage, IMAGE_LIMITS } from './images.js';
import { findRenderer } from './visual.js';

export class PreflightError extends Error {
  constructor(op, checks) {
    const failed = checks.filter((c) => c.status === 'fail');
    super(`Cannot start ${op}: ${failed.map((c) => c.message).join(' ')}`);
    this.name = 'PreflightError';
    this.checks = checks;
  }
}

const isDirEmpty = (d) => !existsSync(d) || (statSync(d).isDirectory() && readdirSync(d).length === 0);

export async function preflight({ project, op, config, rea = null, createAgent, trust = false, studio = false }) {
  const checks = [];
  const add = (id, label, status, message, fix = null) => checks.push({ id, label, status, message, ...(fix ? { fix } : {}) });
  const unmeteredFix = studio ? 'Settings → Execution → "Allow agents that do not report a dollar cost". You then accept that spending is limited only by your provider plan.' : 'Set projectLab.budget.allowUnmeteredAgents to true in era.config.json (spending is then limited only by your provider plan).';

  // ---- what the operation works on
  if (op === 'review' || op === 'modify') {
    if (!project.source) add('source', 'Project folder', 'fail', 'No project folder is set.', 'Choose the project folder.');
    else if (!existsSync(project.source) || !statSync(project.source).isDirectory()) add('source', 'Project folder', 'fail', `The project folder does not exist: ${project.source}`, 'Fix the path or restore the folder.');
    else add('source', 'Project folder', 'pass', project.source);
  }
  if (op === 'modify' && !project.task.trim()) add('task', 'Task', 'fail', 'No task is described.', 'Describe what should change.');

  let screenshot = false;
  if (op === 'rebuild') {
    if (!project.reference) add('reference', 'Reference', 'fail', 'No reference is set.', 'Choose the authorized application, file or screenshot(s) to rebuild from.');
    else if (!existsSync(project.reference)) add('reference', 'Reference', 'fail', `The reference does not exist: ${project.reference}`, 'Fix the path.');
    else {
      const imagePaths = imageReferencePaths(project.reference);
      screenshot = !!imagePaths;
      if (screenshot) {
        add('reference', 'Reference', 'pass', `${imagePaths.length} screenshot${imagePaths.length > 1 ? 's' : ''}`);
        try {
          imagePaths.forEach((p, i) => inspectImage(p, `Screenshot ${i + 1}`));
          if (imagePaths.length > IMAGE_LIMITS.maxFiles) throw new Error(`At most ${IMAGE_LIMITS.maxFiles} screenshots are supported.`);
          add('images', 'Screenshot files', 'pass', 'PNG/JPEG/WebP verified by content; metadata is removed before an agent sees them.');
        } catch (err) {
          add('images', 'Screenshot files', 'fail', err.message, 'Use PNG, JPEG or WebP files (at least 64px, under 12 MB each).');
        }
      } else {
        const d = detectTarget(project.reference);
        add('reference', 'Reference', 'pass', `${d.kind}${d.supported ? '' : ' (not analyzable by REA)'}`);
        if (!d.supported) add('rea-support', 'REA support', 'warn', `REA has no verified workflow for this reference (${d.reason}); the specification will rely on the behaviors you state.`);
        else if (rea) {
          const st = await rea.status().catch((err) => ({ available: false, error: err.message }));
          add('rea', 'REA engine', st.available ? 'pass' : 'warn', st.available ? `version ${st.version}` : `REA is unavailable (${st.error ?? 'not found'}); the specification will rely on the behaviors you state.`, st.available ? null : 'Run `era rea doctor`.');
        }
      }
    }
    if (!project.destination) add('destination', 'Destination', 'fail', 'No destination folder is set for the new project.', 'Choose an empty folder.');
    else if (!isAbsolute(project.destination)) add('destination', 'Destination', 'fail', 'The destination must be an absolute path.');
    else if (!isDirEmpty(project.destination)) add('destination', 'Destination', 'fail', `The destination is not empty: ${project.destination}`, 'Choose a new or empty folder.');
    else add('destination', 'Destination', 'pass', project.destination);
    if (!project.task.trim()) add('task', 'Task', 'fail', 'Describe what to reconstruct.', 'For example: "Recreate this landing page as a static website".');
    if (!project.authorization) add('authorization', 'Authorization', 'fail', 'No authorization statement is recorded.', 'State why you may analyze this reference (for example that you own it).');
    else add('authorization', 'Authorization', 'pass', 'recorded');

    // acceptance: what decides success
    const a = project.acceptance;
    const hasCommands = a.commands.length > 0 || project.commands.test.length > 0;
    if (screenshot) {
      const renderer = findRenderer();
      if (renderer) add('renderer', 'Visual comparison', 'pass', `The generated page is rendered offline in a sandbox and compared with the screenshot (${renderer.source}); required similarity ${a.visual?.threshold ?? 0.75}.`);
      else if (hasCommands) add('renderer', 'Visual comparison', 'warn', 'No renderer is installed, so the page will NOT be compared with the screenshot; only your commands decide.', 'Run npm install in apps/studio (or start ERA from the Studio app) to enable the visual comparison.');
      else add('renderer', 'Visual comparison', 'fail', 'Nothing can verify this rebuild: no renderer is installed and no acceptance or test command is configured, so any page would count as success.', 'Install the renderer (npm install in apps/studio), or add an acceptance command.');
      if (a.behaviors.some((b) => b.capture === 'reference')) add('behaviors', 'Behaviors', 'fail', 'Behaviors cannot be captured from a screenshot (there is no program to run).', 'State the expected output yourself, or use acceptance commands.');
    } else if (!a.behaviors.length && !hasCommands) {
      add('acceptance', 'Acceptance', 'fail', 'No acceptance check is defined, so any output would count as success.', 'Add at least one: an expected behavior (arguments → expected output), an acceptance command, or a test command.');
    } else {
      add('acceptance', 'Acceptance', 'pass', `${a.behaviors.length} behavior(s), ${a.commands.length} acceptance command(s), ${project.commands.test.length} test command(s)`);
    }
    if (a.behaviors.length && !project.commands.run) add('run-command', 'Run command', 'fail', 'Behaviors need a run command (how to start the new program; the arguments are appended).', 'For example: node app.js');
    if (!screenshot && a.behaviors.some((b) => b.capture === 'reference') && project.reference && existsSync(project.reference) && statSync(project.reference).isDirectory()) add('capture', 'Capture from reference', 'fail', 'A behavior asks to capture the reference, but the reference is a folder, not an executable file.', 'State the expected output yourself.');
  }

  if (op === 'modify') {
    const a = project.acceptance;
    let detected = [];
    if (project.source && existsSync(project.source)) detected = (await detectProject(project.source).catch(() => null))?.test?.filter((t) => t.tool_available) ?? [];
    if (!a.commands.length && !project.commands.test.length && !detected.length) add('acceptance', 'Acceptance', 'warn', 'No test or acceptance command is configured or detected: ERA cannot tell whether the change works.', 'Add a command that fails now and passes once the task is done.');
    else add('acceptance', 'Acceptance', 'pass', a.commands.length ? `${a.commands.length} acceptance command(s)` : `tests: ${(project.commands.test.length ? project.commands.test : detected.map((d) => d.command)).join('; ')}`);
  }

  // ---- agents (everything below applies to modify/rebuild, and to review when an agent is configured)
  const roles = rolesOf(project);
  const needsAgent = op === 'modify' || op === 'rebuild';
  const ids = [...new Set(Object.values(roles).filter(Boolean))];
  if (needsAgent && !roles.implementer) add('agent', 'Implementer', 'fail', 'No coding agent is assigned to write the code.', 'Choose a team or an implementation agent.');
  const budget = effectiveBudget({ maxCostUsdPerCycle: project.limits.maxCostUsd, maxCostUsdTotal: project.limits.maxCostUsdTotal, allowUnmeteredAgents: config.projectLab?.budget?.allowUnmeteredAgents === true });
  const consent = project.exposure?.remote_consent ?? [];
  for (const id of ids) {
    if (id === 'manual') {
      add(`agent:${id}`, 'Agent manual', 'info', 'You will edit the working copy yourself and resume the run.');
      continue;
    }
    let agent;
    let probe;
    let auth = { authenticated: null, detail: '' };
    try {
      agent = createAgent(id, { ...config, improvement: { ...config.improvement, implementerCommand: project.agent_command ?? config.projectLab?.agentCommand ?? config.improvement?.implementerCommand } });
      probe = await agent.probe();
      if (probe.available && typeof agent.auth === 'function') auth = await agent.auth();
    } catch (err) {
      add(`agent:${id}`, `Agent ${id}`, 'fail', `${id}: ${err.message}`, 'Choose another agent in the Agent Command Center.');
      continue;
    }
    if (!probe.available) { add(`agent:${id}`, `Agent ${id}`, 'fail', `${id} is not installed or not runnable (${probe.detail}).`, 'Install it, or choose another agent in the Agent Command Center.'); continue; }
    if (auth.authenticated === false) { add(`agent:${id}`, `Agent ${id}`, 'fail', `${id} is installed but not signed in (${auth.detail}).`, `Sign in with the ${id === 'codex' ? 'codex login' : id === 'claude-code' ? 'claude auth login' : `${id} sign-in`} command, then check again.`); continue; }
    add(`agent:${id}`, `Agent ${id}`, 'pass', `${probe.version ?? 'available'}${auth.authenticated ? ', signed in' : ''}`);
    const caps = agentCapabilities(id, config, { strict: false });
    if (!agent.metered && needsAgent && !budget.allowUnmeteredAgents) add(`spend:${id}`, `Spending cap for ${id}`, 'fail', `${id} does not report a dollar cost, so ERA cannot enforce a spending cap on it, and running without a cap is not enabled.`, unmeteredFix);
    else if (!agent.metered && needsAgent) add(`spend:${id}`, `Spending cap for ${id}`, 'warn', `${id} reports no dollar cost: it runs without a dollar cap (explicitly allowed). Time limits and attempt limits still apply.`);
    else if (agent.metered) add(`spend:${id}`, `Spending cap for ${id}`, 'pass', `capped at $${project.limits.maxCostUsd} per run, $${project.limits.maxCostUsdTotal} per project`);
    if (screenshot && id === roles.implementer) {
      if ((caps.images ?? 'none') === 'none') add('agent-images', 'Image input', 'fail', `${id} cannot look at images, so it cannot rebuild from a screenshot.`, 'Choose an agent with image input (Codex passes images natively; Claude Code reads them with its file tool).');
      else if (caps.images === 'read-tool') add('agent-images', 'Image input', 'warn', `${id} reads the screenshot with its file tool. This path has not been validated against the real Claude Code CLI in this release.`);
      else add('agent-images', 'Image input', 'pass', caps.images === 'flag' ? `${id} receives the screenshot as a native image argument.` : `${id} reads the screenshot paths from ERA_REFERENCE_IMAGES.`);
    }
  }
  if (ids.some((id) => id !== 'manual')) {
    try {
      assertRemoteConsent(roles, consent, config);
      const remote = ids.filter((id) => agentCapabilities(id, config, { strict: false }).remote);
      add('consent', 'Sending data to AI services', remote.length ? 'pass' : 'info', remote.length ? `Authorized by you for: ${remote.join(', ')}. Credential files and agent instruction files are withheld; secret-looking content blocks the run.` : 'No remote service is used; nothing leaves this machine.');
    } catch (err) {
      const named = ids.filter((id) => agentCapabilities(id, config, { strict: false }).remote && !consent.includes(id));
      add('consent', 'Sending data to AI services', 'fail', `${named.join(', ')} send${named.length === 1 ? 's' : ''} project content to an external service and ${named.length === 1 ? 'has' : 'have'} not been authorized by you for this project.`, studio ? 'Tick the authorization for the named provider(s), then start.' : `Authorize them explicitly with --allow-remote ${named.join(',')} (recorded in the run ledger).`);
    }
  }

  // ---- isolation
  if (needsAgent || op === 'review') {
    if (sandboxAvailable()) add('isolation', 'Execution isolation', 'pass', 'Project commands run in the macOS sandbox (no network, confined writes).');
    else if (trust || project.trust_project) add('isolation', 'Execution isolation', 'warn', 'No sandbox on this platform: project commands run UNCONFINED because you declared the project trusted.');
    else add('isolation', 'Execution isolation', 'fail', 'No sandbox is available on this platform, so project commands would run unconfined.', 'Only for code you trust: enable trusted execution (Studio: Settings → Permissions; CLI: --trust-project).');
  }
  const failed = checks.filter((c) => c.status === 'fail');
  return { op, ok: failed.length === 0, screenshot, checks, blockers: failed.map((c) => c.message), warnings: checks.filter((c) => c.status === 'warn').map((c) => c.message) };
}
