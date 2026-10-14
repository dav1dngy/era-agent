// Project configuration: normalization and validation (Project Lab).
// A project describes ONE external software project and what to do with it.
// Everything is validated before it is stored; paths are resolved and checked so
// that Project Lab can never be pointed at ERA's own implementation.
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARD_LIMITS, SafetyError } from '../safety/policy.js';
import { normalizeExposure, normalizeTeam } from '../agents/team.js';

export const MODES = ['review', 'modify', 'rebuild'];
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const ERA_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));

export const DEFAULT_LIMITS = Object.freeze({
  commandTimeoutMs: 600_000,
  agentTimeoutMs: 1_800_000,
  maxAttempts: 2,
  maxCostUsd: 5,
  maxCostUsdTotal: 20,
  maxChangedFiles: 200,
  maxDiffBytes: 2_000_000,
  maxCopyBytes: 200_000_000,
  maxCopyFiles: 20_000,
});

const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

// Resolves a path against the real filesystem, also when its tail does not exist yet.
export function realish(p) {
  const abs = resolve(p);
  let head = abs;
  const tail = [];
  while (!existsSync(head)) {
    tail.unshift(head.slice(dirname(head).length + 1));
    head = dirname(head);
  }
  return join(realpathSync(head), ...tail);
}

// Project Lab never reads from or writes to ERA's own installation as a "project".
export function assertExternalPath(p, label, { eraRoot = ERA_ROOT } = {}) {
  const real = realish(p);
  if (inside(real, eraRoot)) throw new SafetyError(`${label} (${p}) is inside ERA's own installation (${eraRoot}). Project Lab operates only on external projects; use the Improvement Lab for ERA itself.`);
  if (inside(eraRoot, real)) throw new SafetyError(`${label} (${p}) contains ERA's own installation.`);
  return real;
}

function list(value, label) {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  for (const v of items) if (typeof v !== 'string' || !v.trim()) throw new Error(`${label} must be a list of non-empty strings.`);
  return items.map((v) => v.trim());
}

function posInt(value, fallback, max, label) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${label} must be an integer from 1 to ${max} (got ${value}).`);
  return n;
}

function money(value, fallback, max, label) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${label} must be a number from 0 to ${max} (got ${value}).`);
  return n;
}

export function normalizeAcceptance(input = {}) {
  const commands = (input.commands ?? []).map((c, i) => {
    const o = typeof c === 'string' ? { command: c } : c;
    if (!o || typeof o.command !== 'string' || !o.command.trim()) throw new Error(`acceptance.commands[${i}] needs a non-empty command.`);
    const baseline = o.baseline ?? 'any';
    if (!['fail', 'any'].includes(baseline)) throw new Error(`acceptance.commands[${i}].baseline must be "fail" or "any".`);
    return { name: String(o.name ?? `acceptance-${i + 1}`), command: o.command.trim(), baseline };
  });
  const behaviors = (input.behaviors ?? []).map((b, i) => {
    if (!b || typeof b !== 'object') throw new Error(`acceptance.behaviors[${i}] must be an object.`);
    const args = list(b.args ?? [], `acceptance.behaviors[${i}].args`);
    const hasExpect = b.expect && typeof b.expect === 'object';
    if (!hasExpect && b.capture !== 'reference') throw new Error(`acceptance.behaviors[${i}] needs "expect" ({stdout, exit_code}) or capture: "reference".`);
    return { name: String(b.name ?? `behavior-${i + 1}`), args, stdin: typeof b.stdin === 'string' ? b.stdin : null, capture: b.capture === 'reference' ? 'reference' : null, expect: hasExpect ? { stdout: b.expect.stdout ?? null, exit_code: b.expect.exit_code ?? 0 } : null };
  });
  // Visual acceptance for screenshot rebuilds: how the generated site is rendered and how close it must be.
  let visual = null;
  if (input.visual !== undefined && input.visual !== null) {
    const v = input.visual;
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error('acceptance.visual must be an object.');
    const threshold = v.threshold === undefined ? 0.75 : Number(v.threshold);
    if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.99) throw new Error('acceptance.visual.threshold must be a number from 0.5 to 0.99.');
    const entry = v.entry === undefined ? 'index.html' : String(v.entry);
    if (!/^[\w./-]{1,120}$/.test(entry) || entry.startsWith('/') || entry.split('/').includes('..') || !/\.html?$/i.test(entry)) throw new Error('acceptance.visual.entry must be a relative .html file inside the new project.');
    const dim = (x, lo, hi, label) => {
      if (x === undefined || x === null) return null;
      const n = Number(x);
      if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label} must be an integer from ${lo} to ${hi}.`);
      return n;
    };
    visual = { threshold, entry, width: dim(v.width, 320, 1920, 'acceptance.visual.width'), height: dim(v.height, 240, 6000, 'acceptance.visual.height') };
  }
  return { criteria: list(input.criteria, 'acceptance.criteria'), commands, behaviors, visual };
}

export function normalizeProject(input, { existing = null, eraRoot = ERA_ROOT, config = {} } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Project configuration must be an object.');
  const id = String(input.id ?? existing?.id ?? '');
  if (!ID_PATTERN.test(id)) throw new Error(`Project id "${id}" is invalid: use 1-63 lowercase letters, digits, "-" or "_", starting with a letter or digit.`);
  const mode = input.mode ?? existing?.mode ?? 'review';
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')} (got "${mode}").`);

  const pathOf = (key, label, { mustExist = false, dir = false } = {}) => {
    const v = input[key] ?? existing?.[key];
    if (v === undefined || v === null || v === '') return null;
    const abs = resolve(String(v));
    if (mustExist && !existsSync(abs)) throw new Error(`${label} does not exist: ${abs}`);
    if (dir && existsSync(abs) && !statSync(abs).isDirectory()) throw new Error(`${label} must be a directory: ${abs}`);
    return assertExternalPath(abs, label, { eraRoot });
  };
  const source = pathOf('source', 'source', { mustExist: true, dir: true });
  const reference = pathOf('reference', 'reference', { mustExist: true });
  const destination = pathOf('destination', 'destination');
  if (destination) {
    if (existsSync(destination)) {
      if (!statSync(destination).isDirectory()) throw new Error(`destination must be a directory: ${destination}`);
      if (readdirSync(destination).length > 0) throw new Error(`destination must be empty or not exist yet: ${destination}`);
    }
    for (const other of [source, reference]) if (other && (inside(destination, other) || inside(other, destination))) throw new Error(`destination (${destination}) must not overlap the source/reference (${other}).`);
  }

  const lim = { ...DEFAULT_LIMITS, ...(existing?.limits ?? {}), ...(input.limits ?? {}) };
  const limits = {
    commandTimeoutMs: posInt(lim.commandTimeoutMs, DEFAULT_LIMITS.commandTimeoutMs, HARD_LIMITS.commandTimeoutMs, 'limits.commandTimeoutMs'),
    agentTimeoutMs: posInt(lim.agentTimeoutMs, DEFAULT_LIMITS.agentTimeoutMs, HARD_LIMITS.implementerTimeoutMs, 'limits.agentTimeoutMs'),
    maxAttempts: posInt(lim.maxAttempts, DEFAULT_LIMITS.maxAttempts, 5, 'limits.maxAttempts'),
    maxCostUsd: money(lim.maxCostUsd, DEFAULT_LIMITS.maxCostUsd, HARD_LIMITS.maxCostUsdPerCycle, 'limits.maxCostUsd'),
    maxCostUsdTotal: money(lim.maxCostUsdTotal, DEFAULT_LIMITS.maxCostUsdTotal, HARD_LIMITS.maxCostUsdTotal, 'limits.maxCostUsdTotal'),
    maxChangedFiles: posInt(lim.maxChangedFiles, DEFAULT_LIMITS.maxChangedFiles, 5000, 'limits.maxChangedFiles'),
    maxDiffBytes: posInt(lim.maxDiffBytes, DEFAULT_LIMITS.maxDiffBytes, 50_000_000, 'limits.maxDiffBytes'),
    maxCopyBytes: posInt(lim.maxCopyBytes, DEFAULT_LIMITS.maxCopyBytes, 2_000_000_000, 'limits.maxCopyBytes'),
    maxCopyFiles: posInt(lim.maxCopyFiles, DEFAULT_LIMITS.maxCopyFiles, 200_000, 'limits.maxCopyFiles'),
  };

  const cmd = { ...(existing?.commands ?? {}), ...(input.commands ?? {}) };
  const commands = { build: list(cmd.build, 'commands.build'), test: list(cmd.test, 'commands.test'), run: cmd.run ? String(cmd.run) : null };
  const acceptance = normalizeAcceptance(input.acceptance ?? existing?.acceptance ?? {});
  const protectedGlobs = list(input.protected ?? existing?.protected, 'protected');
  for (const g of protectedGlobs) if (isAbsolute(g) || g.split('/').includes('..')) throw new Error(`protected pattern "${g}" must be relative to the project and must not contain "..".`);

  const agent = input.agent ?? existing?.agent ?? null;
  const teamInput = input.team === null ? null : input.team ?? existing?.team ?? null;
  const team = teamInput ? normalizeTeam(teamInput, config, { implementerFallback: agent }) : null;
  const exposure = normalizeExposure(input.exposure, existing?.exposure);
  const authorization = input.authorization ?? existing?.authorization ?? null;
  const approval = existing?.approval ?? { status: 'none', by: null, at: null };
  return {
    id,
    mode,
    source,
    reference,
    destination,
    task: String(input.task ?? existing?.task ?? '').trim(),
    // With a team, "agent" mirrors the implementer so single-agent code paths keep working.
    agent: team ? team.roles.implementer : agent,
    team,
    exposure,
    // Shell command for the "command" agent (cwd = the isolated working copy).
    agent_command: input.agent_command ?? existing?.agent_command ?? null,
    commands,
    acceptance,
    protected: protectedGlobs,
    limits,
    authorization: authorization ? String(authorization).trim() : null,
    // "sandbox: false" is a maintainer decision that project commands are trusted.
    trust_project: input.trust_project ?? existing?.trust_project ?? false,
    // Pause after the plan (and the architect's design) so a human can read it before any code is written.
    review_plan: input.review_plan === undefined ? existing?.review_plan === true : input.review_plan === true,
    approval,
    status: existing?.status ?? 'created',
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Operation-specific requirements, checked when an operation starts.
export function assertReady(project, op) {
  const need = (cond, msg) => {
    if (!cond) throw new Error(`Project "${project.id}" cannot run ${op}: ${msg}`);
  };
  if (op === 'review') need(project.source, 'a source path is required (--source).');
  if (op === 'modify') {
    need(project.source, 'a source path is required (--source).');
    need(project.task, 'a task description is required (--task).');
  }
  if (op === 'rebuild') {
    need(project.reference, 'a reference artifact is required (--reference).');
    need(project.destination, 'a destination path is required (--destination).');
    need(project.task, 'a task description is required (--task), naming the functionality to reconstruct.');
    need(project.authorization, 'an authorization statement is required (--authorization "<why you may analyze this reference>"). Only analyze software you are authorized to analyze.');
  }
}

