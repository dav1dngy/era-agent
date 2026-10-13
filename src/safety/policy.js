// Safety Controller. This module is a protected path: experiments that modify
// it (or the benchmark datasets, acceptance criteria and evaluator) are rejected
// automatically, so ERA cannot loosen its own constraints.
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const HARD_LIMITS = Object.freeze({
  maxCycles: 10,
  maxReaRunsPerCycle: 50,
  commandTimeoutMs: 3_600_000,
  implementerTimeoutMs: 7_200_000,
  maxParallel: 1,
  maxCostUsdPerCycle: 50,
  maxCostUsdTotal: 200,
});

export const PROTECTED_PATHS = Object.freeze([
  'src/safety/',
  'src/evaluation/',
  'src/self_analysis/rules.js',
  'benchmarks/datasets/',
  'benchmarks/acceptance.json',
  'tests/safety.test.js',
  'tests/evaluation.test.js',
  'tests/self-analysis.test.js',
]);

export class SafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafetyError';
  }
}

// Clamp configured limits to hard limits; configuration can only tighten them.
export function effectiveLimits(limits = {}, improvement = {}) {
  const clamp = (value, max, fallback) => {
    const n = Number(value ?? fallback);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
  };
  return {
    maxCycles: clamp(limits.maxCycles, HARD_LIMITS.maxCycles, 3),
    maxReaRunsPerCycle: clamp(limits.maxReaRunsPerCycle, HARD_LIMITS.maxReaRunsPerCycle, 12),
    commandTimeoutMs: clamp(limits.commandTimeoutMs, HARD_LIMITS.commandTimeoutMs, 900_000),
    implementerTimeoutMs: clamp(improvement.implementerTimeoutMs, HARD_LIMITS.implementerTimeoutMs, 1_800_000),
    maxParallel: HARD_LIMITS.maxParallel,
  };
}

// API spending limits for coding agents. Configuration can only tighten them.
export function effectiveBudget(budget = {}) {
  const clamp = (value, max, fallback) => {
    const n = Number(value ?? fallback);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
  };
  return {
    maxCostUsdPerCycle: clamp(budget.maxCostUsdPerCycle, HARD_LIMITS.maxCostUsdPerCycle, 5),
    maxCostUsdTotal: clamp(budget.maxCostUsdTotal, HARD_LIMITS.maxCostUsdTotal, 20),
    allowUnmeteredAgents: budget.allowUnmeteredAgents === true,
  };
}

// Returns the dollar budget for one agent run, or throws when spending is not allowed.
export function authorizeAgentRun({ agent, budget, spentUsd }) {
  const remaining = budget.maxCostUsdTotal - spentUsd;
  if (remaining <= 0) throw new SafetyError(`Coding-agent budget exhausted ($${spentUsd.toFixed(2)} of $${budget.maxCostUsdTotal.toFixed(2)} spent).`);
  if (!agent.metered && !budget.allowUnmeteredAgents) {
    throw new SafetyError(`Coding agent "${agent.id}" cannot report its API cost; set improvement.budget.allowUnmeteredAgents to true to run it without cost enforcement.`);
  }
  return Math.min(budget.maxCostUsdPerCycle, remaining);
}

export function assertCycleAllowed(completedCycles, limits) {
  if (completedCycles >= limits.maxCycles) {
    throw new SafetyError(`Cycle limit reached (${completedCycles}/${limits.maxCycles}). Raise limits.maxCycles in era.config.json (hard cap ${HARD_LIMITS.maxCycles}).`);
  }
}

export function assertNotCI(env = process.env) {
  if (env.CI || env.GITHUB_ACTIONS) {
    throw new SafetyError('Self-improvement is disabled in CI environments (CI/GITHUB_ACTIONS is set).');
  }
}

export function protectedChanges(changedFiles) {
  return changedFiles.filter((f) => PROTECTED_PATHS.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)));
}

export function assertTargetPath(path) {
  if (!path) throw new SafetyError('A target path is required.');
  if (!existsSync(path)) throw new SafetyError(`Target does not exist: ${path}`);
  const st = statSync(path);
  if (!st.isFile() && !st.isDirectory()) throw new SafetyError(`Target must be a regular file or directory: ${path}`);
}

function readLock(lockFile) {
  try {
    return JSON.parse(readFileSync(lockFile, 'utf8'));
  } catch {
    return null;
  }
}

// Removes a lock whose holder process no longer exists. Returns true if removed.
export function clearStaleLock(stateDir) {
  const lockFile = join(stateDir, 'improve.lock');
  if (!existsSync(lockFile)) return false;
  const holder = readLock(lockFile);
  if (holder && isAlive(holder.pid)) return false;
  unlinkSync(lockFile);
  return true;
}

// Single-writer lock for self-improvement. Stale locks (dead pid) are replaced.
export function acquireLock(stateDir, owner) {
  mkdirSync(stateDir, { recursive: true });
  const lockFile = join(stateDir, 'improve.lock');
  if (existsSync(lockFile)) {
    const holder = readLock(lockFile);
    if (holder && isAlive(holder.pid)) {
      throw new SafetyError(`Another improvement run holds the lock (pid ${holder.pid}, ${holder.owner}).`);
    }
  }
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, owner, at: new Date().toISOString() }));
  return () => {
    try {
      unlinkSync(lockFile);
    } catch {
      // already removed
    }
  };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}
