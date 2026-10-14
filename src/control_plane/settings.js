// ERA Studio settings: one validated document under <stateDir>/studio/settings.json.
// The UI edits it through the control plane; the control plane enforces it. Nothing here stores credentials:
// AI providers keep their own sign-in (ERA only asks the CLIs whether they are signed in).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { realish } from '../project_lab/schema.js';
import { presetTable } from '../agents/team.js';

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'simple',
  general: { language: 'en', startup: 'home', updates: 'manual' },
  appearance: { theme: 'dark', accent: 'blue', fontSize: 13, editorFont: 'SF Mono, Menlo, Consolas, monospace', density: 'comfortable' },
  agents: { preset: 'codex-only', roles: { architect: null, implementer: null, reviewer: null }, review: { rounds: 1, block_on: 'high' } },
  workspaces: { defaultLocation: null, allowedRoots: [], improvementCheckout: null },
  permissions: {
    // Editing the user's ORIGINAL project files from the editor. Off: originals are read-only, only isolated working copies are editable.
    directEdit: false,
    // A shell inside the workbench (sandboxed on macOS). Off by default.
    terminal: false,
    // Running a target program to capture runtime behavior during analysis.
    runtimeCapture: false,
    // Running project commands outside ERA's sandbox (only for code you trust).
    trustedExecution: false,
  },
  privacy: { defaultRemoteConsent: [], logRetentionDays: 30, runRetentionDays: 0 },
  execution: { concurrentJobs: 2, commandTimeoutMs: 600_000, agentTimeoutMs: 1_800_000, maxAttempts: 2, maxCostUsd: 5, maxCostUsdTotal: 20,
    // Run agents that cannot report a dollar cost (for example Codex) WITHOUT a dollar spending cap. Off until you turn it on.
    allowUnmeteredAgents: false },
  advanced: { diagnostics: true, devTools: false, experimental: false },
});

const THEMES = ['dark', 'light', 'system'];
const ACCENTS = ['blue', 'teal', 'violet', 'amber'];
const DENSITIES = ['comfortable', 'compact'];
const STARTUPS = ['home', 'last-project'];
const BLOCK = ['critical', 'high', 'medium', 'none'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
};

// Returns { value, errors }. Unknown keys are errors (a typo must not silently do nothing).
export function validateSettings(candidate, { eraConfig = {} } = {}) {
  const errors = [];
  const out = {};
  const unknown = (obj, allowed, path) => {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${path ? `${path}.` : ''}${k}: unknown setting`);
  };
  const oneOf = (v, list, path) => {
    if (!list.includes(v)) errors.push(`${path}: must be one of ${list.join(', ')}`);
    return v;
  };
  const int = (v, lo, hi, path) => {
    if (!Number.isInteger(v) || v < lo || v > hi) errors.push(`${path}: must be an integer from ${lo} to ${hi}`);
    return v;
  };
  const num = (v, lo, hi, path) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) errors.push(`${path}: must be a number from ${lo} to ${hi}`);
    return v;
  };
  const bool = (v, path) => {
    if (typeof v !== 'boolean') errors.push(`${path}: must be true or false`);
    return v;
  };
  const pathOrNull = (v, path) => {
    if (v === null) return null;
    if (typeof v !== 'string' || !isAbsolute(v) || v.includes('\0')) errors.push(`${path}: must be an absolute path or null`);
    return v;
  };

  if (!isObj(candidate)) return { value: null, errors: ['settings must be an object'] };
  unknown(candidate, Object.keys(DEFAULT_SETTINGS), '');
  out.mode = oneOf(candidate.mode, ['simple', 'advanced'], 'mode');

  const g = candidate.general ?? {};
  unknown(g, ['language', 'startup', 'updates'], 'general');
  out.general = { language: /^[a-z]{2}(-[A-Z]{2})?$/.test(g.language) ? g.language : (errors.push('general.language: use a code like "en" or "de-DE"'), g.language), startup: oneOf(g.startup, STARTUPS, 'general.startup'), updates: oneOf(g.updates, ['manual'], 'general.updates') };

  const a = candidate.appearance ?? {};
  unknown(a, ['theme', 'accent', 'fontSize', 'editorFont', 'density'], 'appearance');
  out.appearance = { theme: oneOf(a.theme, THEMES, 'appearance.theme'), accent: oneOf(a.accent, ACCENTS, 'appearance.accent'), fontSize: int(a.fontSize, 11, 20, 'appearance.fontSize'), editorFont: typeof a.editorFont === 'string' && /^[\w ,'"-]{1,120}$/.test(a.editorFont) ? a.editorFont : (errors.push('appearance.editorFont: a font-family list of up to 120 plain characters'), a.editorFont), density: oneOf(a.density, DENSITIES, 'appearance.density') };

  const ag = candidate.agents ?? {};
  unknown(ag, ['preset', 'roles', 'review'], 'agents');
  const presets = presetTable(eraConfig);
  const preset = ag.preset === 'custom' || presets[ag.preset] ? ag.preset : (errors.push(`agents.preset: must be one of ${[...Object.keys(presets), 'custom'].join(', ')}`), ag.preset);
  const roles = ag.roles ?? {};
  unknown(roles, ['architect', 'implementer', 'reviewer'], 'agents.roles');
  const role = (k) => (roles[k] === null || (typeof roles[k] === 'string' && /^[a-z0-9][a-z0-9:_-]{0,40}$/.test(roles[k])) ? roles[k] ?? null : (errors.push(`agents.roles.${k}: an agent id or null`), roles[k]));
  const rv = ag.review ?? {};
  unknown(rv, ['rounds', 'block_on'], 'agents.review');
  out.agents = { preset, roles: { architect: role('architect'), implementer: role('implementer'), reviewer: role('reviewer') }, review: { rounds: int(rv.rounds, 0, 3, 'agents.review.rounds'), block_on: oneOf(rv.block_on, BLOCK, 'agents.review.block_on') } };

  const w = candidate.workspaces ?? {};
  unknown(w, ['defaultLocation', 'allowedRoots', 'improvementCheckout'], 'workspaces');
  const roots = Array.isArray(w.allowedRoots) ? w.allowedRoots.map((r, i) => pathOrNull(r, `workspaces.allowedRoots[${i}]`)) : (errors.push('workspaces.allowedRoots: must be a list of absolute paths'), []);
  out.workspaces = { defaultLocation: pathOrNull(w.defaultLocation ?? null, 'workspaces.defaultLocation'), allowedRoots: roots, improvementCheckout: pathOrNull(w.improvementCheckout ?? null, 'workspaces.improvementCheckout') };

  const p = candidate.permissions ?? {};
  unknown(p, ['directEdit', 'terminal', 'runtimeCapture', 'trustedExecution'], 'permissions');
  out.permissions = { directEdit: bool(p.directEdit, 'permissions.directEdit'), terminal: bool(p.terminal, 'permissions.terminal'), runtimeCapture: bool(p.runtimeCapture, 'permissions.runtimeCapture'), trustedExecution: bool(p.trustedExecution, 'permissions.trustedExecution') };

  const pr = candidate.privacy ?? {};
  unknown(pr, ['defaultRemoteConsent', 'logRetentionDays', 'runRetentionDays'], 'privacy');
  const consent = Array.isArray(pr.defaultRemoteConsent) && pr.defaultRemoteConsent.every((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9:_-]{0,40}$/.test(x)) ? [...new Set(pr.defaultRemoteConsent)] : (errors.push('privacy.defaultRemoteConsent: a list of agent ids'), []);
  out.privacy = { defaultRemoteConsent: consent, logRetentionDays: int(pr.logRetentionDays, 1, 3650, 'privacy.logRetentionDays'), runRetentionDays: int(pr.runRetentionDays, 0, 3650, 'privacy.runRetentionDays') };

  const e = candidate.execution ?? {};
  unknown(e, ['concurrentJobs', 'commandTimeoutMs', 'agentTimeoutMs', 'maxAttempts', 'maxCostUsd', 'maxCostUsdTotal', 'allowUnmeteredAgents'], 'execution');
  out.execution = { concurrentJobs: int(e.concurrentJobs, 1, 4, 'execution.concurrentJobs'), commandTimeoutMs: int(e.commandTimeoutMs, 1000, 3_600_000, 'execution.commandTimeoutMs'), agentTimeoutMs: int(e.agentTimeoutMs, 1000, 14_400_000, 'execution.agentTimeoutMs'), maxAttempts: int(e.maxAttempts, 1, 5, 'execution.maxAttempts'), maxCostUsd: num(e.maxCostUsd, 0, 100, 'execution.maxCostUsd'), maxCostUsdTotal: num(e.maxCostUsdTotal, 0, 1000, 'execution.maxCostUsdTotal'), allowUnmeteredAgents: bool(e.allowUnmeteredAgents, 'execution.allowUnmeteredAgents') };

  const ad = candidate.advanced ?? {};
  unknown(ad, ['diagnostics', 'devTools', 'experimental'], 'advanced');
  out.advanced = { diagnostics: bool(ad.diagnostics, 'advanced.diagnostics'), devTools: bool(ad.devTools, 'advanced.devTools'), experimental: bool(ad.experimental, 'advanced.experimental') };
  return { value: errors.length ? null : out, errors };
}

export class SettingsStore {
  constructor(stateDir, { eraConfig = {} } = {}) {
    this.dir = join(stateDir, 'studio');
    this.file = join(this.dir, 'settings.json');
    this.eraConfig = eraConfig;
  }

  load() {
    let stored = {};
    if (existsSync(this.file)) {
      try {
        stored = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        stored = {}; // a corrupt file never blocks the app; defaults apply and the next save repairs it
      }
    }
    const merged = merge(structuredClone(DEFAULT_SETTINGS), stored);
    const { value } = validateSettings(merged, { eraConfig: this.eraConfig });
    return value ?? structuredClone(DEFAULT_SETTINGS);
  }

  // Partial update, validated as a whole; either everything applies or nothing does.
  update(patch) {
    if (!isObj(patch)) return { ok: false, errors: ['body must be an object'] };
    const current = this.load();
    const merged = merge(current, patch);
    // Lists replace instead of merging.
    for (const key of ['allowedRoots']) if (patch.workspaces && key in patch.workspaces) merged.workspaces[key] = patch.workspaces[key];
    if (patch.privacy && 'defaultRemoteConsent' in patch.privacy) merged.privacy.defaultRemoteConsent = patch.privacy.defaultRemoteConsent;
    const { value, errors } = validateSettings(merged, { eraConfig: this.eraConfig });
    if (errors.length) return { ok: false, errors };
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    return { ok: true, settings: value, changed: diffKeys(current, value) };
  }
}

function diffKeys(a, b, prefix = '') {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isObj(a[k]) && isObj(b[k])) out.push(...diffKeys(a[k], b[k], path));
    else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(path);
  }
  return out;
}

// Is `path` inside one of the allowed workspace roots (when any are configured)?
export function insideAllowedRoots(path, settings) {
  const roots = settings.workspaces.allowedRoots;
  if (roots.length === 0) return true;
  try {
    const p = realish(path);
    return roots.some((r) => {
      const rel = relative(realish(r), p);
      return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../');
    });
  } catch {
    return false;
  }
}

