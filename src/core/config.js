// Configuration loading. Values come from era.config.json in the working
// directory (if present), then environment overrides. Safety hard limits are
// enforced separately in src/safety/policy.js and cannot be raised here.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({
  stateDir: '.era',
  rea: {
    // null = auto-resolve (ERA_REA_BIN, local node_modules/.bin/rea, then PATH).
    command: null,
    timeoutMs: 600_000,
    measureResources: true,
  },
  analysis: {
    // Exported functions decompiled per Mach-O when a deep provider is available.
    maxDecompiledFunctions: 8,
  },
  limits: {
    maxCycles: 3,
    maxReaRunsPerCycle: 12,
    commandTimeoutMs: 900_000,
  },
  improvement: {
    // Coding agent: manual | command | claude-code | codex. null = "command" when
    // implementerCommand is set, otherwise "manual".
    agent: null,
    // Shell command for the "command" agent (cwd = experiment worktree).
    implementerCommand: null,
    implementerTimeoutMs: 1_800_000,
    budget: { maxCostUsdPerCycle: 5, maxCostUsdTotal: 20, allowUnmeteredAgents: false },
  },
  projectLab: {
    // Coding agent for Project Lab: manual | command | claude-code | codex. null = "manual".
    agent: null,
    // Shell command for the "command" agent (cwd = isolated working copy).
    agentCommand: null,
    commandTimeoutMs: 600_000,
    agentTimeoutMs: 1_800_000,
    maxAttempts: 2,
    // Per-project spending caps (USD). Metered agents only; unmetered agents need opt-in.
    budget: { maxCostUsdPerRun: 5, maxCostUsdTotal: 20, allowUnmeteredAgents: false },
    // Multi-agent teams. Data only: add presets or declare local command agents without touching code.
    //   presets:       { "name": { "architect": "<agent>", "implementer": "<agent>", "reviewer": "<agent>" } }
    //   customAgents:  { "name": { "command": "...", "remote": false, "capabilities": {...} } }  → agent id "custom:name"
    //   agentOverrides:{ "<agent id>": { "remote": true } }  → adjust the declared capabilities of an adapter
    presets: {},
    customAgents: {},
    agentOverrides: {},
  },
  agents: {
    'claude-code': { command: 'claude', model: null },
    codex: { command: null, model: null },
  },
  reasoning: {
    // none (local, deterministic) | command | claude-code
    provider: 'none',
    // Remote providers additionally need --allow-remote on each call.
    allowRemote: false,
    command: { run: null, remote: true },
  },
  benchmark: {
    repetitions: 3,
  },
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override ?? {})) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(cwd = process.cwd(), env = process.env) {
  let fileConfig = {};
  const file = join(cwd, 'era.config.json');
  if (existsSync(file)) {
    try {
      fileConfig = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`Invalid era.config.json: ${err.message}`, { cause: err });
    }
  }
  const config = deepMerge(DEFAULT_CONFIG, fileConfig);
  if (env.ERA_REA_BIN) config.rea = { ...config.rea, command: env.ERA_REA_BIN };
  if (env.ERA_STATE_DIR) config.stateDir = env.ERA_STATE_DIR;
  config.cwd = cwd;
  config.stateDirAbs = resolve(cwd, config.stateDir);
  return config;
}
