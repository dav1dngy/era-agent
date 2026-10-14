// Multi-agent teams: which coding agent plays which ROLE, what each role may do, and which
// providers may receive project content. The workflow (src/project_lab/team.js) only knows
// roles; provider names appear here solely as DATA (default presets) and in user configuration.
//
// Layers kept separate:
//   reverse-engineering engine   REA (src/core/rea-client.js), evidence only
//   reasoning provider           text-only models for reports (src/agents/reasoning.js), no filesystem
//   architecture / implementation / review agents   coding agents playing a role (this file)
//   workflow orchestrator        ERA itself (src/project_lab/*)
import { SafetyError } from '../safety/policy.js';
import { agentCapabilities, createCodingAgent } from './coding-agents.js';

export const ROLES = Object.freeze({
  architect: { label: 'architecture agent', optional: true, readOnly: true, requires: ['read', 'automated'], purpose: 'requirements analysis, technical design, acceptance criteria' },
  implementer: { label: 'implementation agent', optional: false, readOnly: false, requires: ['read', 'write'], purpose: 'code changes, bug fixes, tests' },
  reviewer: { label: 'review agent', optional: true, readOnly: true, requires: ['read', 'automated'], purpose: 'independent code review of the verified change' },
});
export const ROLE_NAMES = Object.keys(ROLES);

// Defaults only; override or extend with projectLab.presets in era.config.json.
export const DEFAULT_PRESETS = Object.freeze({
  'claude-only': { architect: 'claude-code', implementer: 'claude-code', reviewer: 'claude-code' },
  'codex-only': { architect: 'codex', implementer: 'codex', reviewer: 'codex' },
  'claude+codex': { architect: 'claude-code', implementer: 'codex', reviewer: 'claude-code' },
});

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
export const BLOCK_LEVELS = [...SEVERITY_ORDER.slice(0, 3), 'none'];

export const presetTable = (config = {}) => ({ ...DEFAULT_PRESETS, ...(config.projectLab?.presets ?? {}) });

const idList = (v, label) => {
  if (v === undefined || v === null || v === '') return [];
  const items = Array.isArray(v) ? v : String(v).split(',');
  const out = items.map((x) => String(x).trim()).filter(Boolean);
  for (const id of out) if (!/^[a-z0-9][a-z0-9:_-]{0,40}$/.test(id)) throw new Error(`${label}: "${id}" is not a valid agent id.`);
  return [...new Set(out)];
};

// Capability check for one assignment. Returns a list of problems (empty = fine).
export function roleProblems(role, agentId, config = {}) {
  const spec = ROLES[role];
  let caps;
  try {
    caps = agentCapabilities(agentId, config);
  } catch (err) {
    return [err.message];
  }
  const problems = [];
  for (const need of spec.requires) if (!caps[need]) problems.push(`${agentId} cannot be the ${spec.label}: it lacks the "${need}" capability.`);
  if (spec.readOnly && caps.readOnlyMode === 'none') problems.push(`${agentId} cannot be the ${spec.label}: this role must not modify files and ${agentId} has no read-only mode ERA can enforce or verify.`);
  return problems;
}

// Normalizes the "team" part of a project configuration. Returns null for "no team" (single agent).
export function normalizeTeam(input, config = {}, { implementerFallback = null } = {}) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('team must be an object.');
  const presets = presetTable(config);
  // "custom" and "single" are labels derived from explicit roles, not presets (a stored team round-trips through here).
  const presetName = input.preset ?? null;
  const derived = presetName === 'custom' || presetName === 'single';
  if (presetName && !derived && !presets[presetName]) throw new Error(`Unknown team preset "${presetName}". Known: ${Object.keys(presets).join(', ')}, custom.`);
  const base = presetName && !derived ? presets[presetName] : {};
  const roles = {};
  for (const role of ROLE_NAMES) {
    const v = input.roles?.[role] ?? input[role] ?? base[role] ?? null;
    roles[role] = v ? String(v) : null;
  }
  if (!roles.implementer) roles.implementer = implementerFallback;
  if (!roles.implementer) throw new Error('A team needs an implementer: use --team <preset> or --implementer <agent>.');
  const problems = ROLE_NAMES.filter((r) => roles[r]).flatMap((r) => roleProblems(r, roles[r], config));
  if (problems.length) throw new Error(problems.join(' '));

  const review = { rounds: 1, block_on: 'high', ...(input.review ?? {}) };
  if (!Number.isInteger(Number(review.rounds)) || Number(review.rounds) < 0 || Number(review.rounds) > 3) throw new Error('team.review.rounds must be an integer from 0 to 3.');
  if (!BLOCK_LEVELS.includes(review.block_on)) throw new Error(`team.review.block_on must be one of ${BLOCK_LEVELS.join(', ')}.`);
  review.rounds = Number(review.rounds);
  return { preset: presetName && !derived ? presetName : roles.architect || roles.reviewer ? 'custom' : 'single', roles, review };
}

// What may leave this machine. Stored on the project (not the team) so single-agent projects are covered too.
export function normalizeExposure(input, existing = null) {
  const e = { remote_consent: [], allow_secret_content: false, keep_instruction_files: false, ...(existing ?? {}), ...(input ?? {}) };
  return {
    // Providers explicitly authorized to receive this project's source code. Never inferred.
    remote_consent: idList(e.remote_consent, 'exposure.remote_consent'),
    // Secret-looking CONTENT in source files blocks transmission to remote providers unless allowed.
    allow_secret_content: e.allow_secret_content === true,
    keep_instruction_files: e.keep_instruction_files === true,
  };
}

// Roles in effect for a project: its team, or a single implementer.
export const rolesOf = (project) => project.team?.roles ?? { architect: null, implementer: project.agent ?? null, reviewer: null };
export const rolesProviders = (roles) => [...new Set(ROLE_NAMES.map((r) => roles[r]).filter(Boolean))];
export const teamProviders = (team) => rolesProviders(team.roles);

export function remoteProviders(roles, config = {}) {
  return rolesProviders(roles).filter((id) => agentCapabilities(id, config, { strict: false }).remote);
}

// Project content may leave this machine only for providers the user named.
export function assertRemoteConsent(roles, consent, config = {}) {
  const missing = remoteProviders(roles, config).filter((id) => !consent.includes(id));
  if (missing.length) {
    throw new SafetyError(`Remote transmission of this project's source code to ${missing.join(', ')} is not authorized. These providers send project content to an external service. Authorize them explicitly: --allow-remote ${missing.join(',')} (recorded in the run ledger).`);
  }
}

export function independence(roles) {
  if (!roles.reviewer) return 'none (no review agent)';
  const same = roles.reviewer === roles.implementer;
  return same ? 'same provider as the implementer (fresh session, sees only the diff and results)' : 'different provider from the implementer';
}

// Capability detection: availability, version, authentication and capabilities per provider.
export async function detectTeam(team, config = {}, createAgent = createCodingAgent) {
  const out = [];
  for (const id of teamProviders(team)) {
    const caps = agentCapabilities(id, config);
    const row = { id, roles: ROLE_NAMES.filter((r) => team.roles[r] === id), capabilities: caps, available: false, version: null, authenticated: null, detail: '' };
    try {
      const agent = createAgent(id, config);
      const probe = await agent.probe();
      Object.assign(row, { available: probe.available, version: probe.version, detail: probe.detail });
      if (probe.available && typeof agent.auth === 'function') {
        const a = await agent.auth();
        row.authenticated = a.authenticated;
        row.detail = a.detail;
      }
    } catch (err) {
      row.detail = err.message;
    }
    row.ready = row.available && row.authenticated !== false;
    out.push(row);
  }
  return out;
}

export async function detectAllProviders(config = {}, ids, createAgent = createCodingAgent) {
  const fake = { roles: { architect: null, implementer: null, reviewer: null } };
  const rows = [];
  for (const id of ids) {
    const t = { ...fake, roles: { ...fake.roles, implementer: id } };
    rows.push(...(await detectTeam(t, config, createAgent)));
  }
  return rows.map((r) => ({ ...r, roles: [] }));
}
