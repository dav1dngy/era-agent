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
    // Shell command run inside the experiment worktree to implement a proposal.
    // null = manual mode: ERA prepares the worktree and waits for `era improve evaluate`.
    implementerCommand: null,
    implementerTimeoutMs: 1_800_000,
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
      throw new Error(`Invalid era.config.json: ${err.message}`);
    }
  }
  const config = deepMerge(DEFAULT_CONFIG, fileConfig);
  if (env.ERA_REA_BIN) config.rea = { ...config.rea, command: env.ERA_REA_BIN };
  if (env.ERA_STATE_DIR) config.stateDir = env.ERA_STATE_DIR;
  config.cwd = cwd;
  config.stateDirAbs = resolve(cwd, config.stateDir);
  return config;
}
