// Agent Command Center data: provider capability/availability, teams, live activity and usage.
// Every value is read from the adapters (probe/auth) or from Project Lab's run records and ledgers.
import { agentCapabilities, codingAgentIds } from '../../agents/coding-agents.js';
import { ROLE_NAMES, ROLES, detectTeam, presetTable, rolesProviders } from '../../agents/team.js';

const CACHE_MS = 10_000;

// installed ≠ authenticated ≠ available. "simulated" means a user-declared stand-in (custom agent with simulated: true).
export function providerState(row, def = {}) {
  if (def.simulated === true) return 'simulated';
  if (row.id === 'manual') return 'manual';
  if (!row.available) return 'unavailable';
  if (row.authenticated === false) return 'not-signed-in';
  return 'ready';
}

export function agentsService(ctx) {
  let cache = null;

  async function providers({ fresh = false } = {}) {
    if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
    const custom = ctx.config.projectLab?.customAgents ?? {};
    const ids = [...codingAgentIds(), ...Object.keys(custom).map((n) => `custom:${n}`)];
    const rows = [];
    for (const id of ids) {
      const agent = ctx.createAgent(id, ctx.config);
      let probe;
      let auth = { authenticated: null, detail: null };
      try {
        probe = await agent.probe();
        if (probe.available && typeof agent.auth === 'function') auth = await agent.auth();
      } catch (err) {
        probe = { available: false, version: null, detail: err.message };
      }
      const row = { id, installed: probe.available, available: probe.available, version: probe.version, authenticated: auth.authenticated, detail: auth.authenticated === false ? auth.detail : probe.detail, metered: !!agent.metered, description: agent.description ?? '', capabilities: agentCapabilities(id, ctx.config) };
      row.state = providerState(row, custom[id.slice('custom:'.length)]);
      rows.push(row);
    }
    cache = { at: Date.now(), rows };
    return rows;
  }

  async function presets() {
    const rows = await providers();
    const by = new Map(rows.map((r) => [r.id, r]));
    const table = presetTable(ctx.config);
    const out = Object.entries(table).map(([name, roles]) => {
      const needed = rolesProviders(roles);
      const notReady = needed.filter((id) => by.get(id)?.state !== 'ready');
      return { name, roles, ready: notReady.length === 0, not_ready: notReady.map((id) => ({ id, state: by.get(id)?.state ?? 'unknown', detail: by.get(id)?.detail ?? '' })), remote: needed.filter((id) => by.get(id)?.capabilities.remote) };
    });
    out.push({ name: 'custom', roles: null, ready: true, not_ready: [], remote: [] });
    return out;
  }

  // First ready preset in a stable order of preference; null when no automated agent is ready.
  async function recommend() {
    const list = await presets();
    const pick = ['claude+codex', 'codex-only', 'claude-only'].map((n) => list.find((p) => p.name === n)).find((p) => p?.ready);
    return pick ? { preset: pick.name, roles: pick.roles, remote: pick.remote, reason: 'Every agent in this team is installed and signed in.' } : { preset: null, roles: null, remote: [], reason: 'No complete team is ready. Open the Agent Command Center to see what is missing.' };
  }

  async function team(projectId) {
    const project = ctx.lab.get(projectId);
    const roles = project.team?.roles ?? { architect: null, implementer: project.agent ?? 'manual', reviewer: null };
    return { project: projectId, preset: project.team?.preset ?? 'single', roles, review: project.team?.review ?? null, remote_consent: project.exposure?.remote_consent ?? [], providers: await detectTeam({ roles }, ctx.config) };
  }

  const STEP_ROLE = [[/^architecture$/, 'architect'], [/^(implement|correct)-/, 'implementer'], [/^review-/, 'reviewer'], [/^analysis$/, 'rea'], [/^(detect|workspace|baseline|plan|verify|reverify|finalize)/, 'era']];
  const roleOfStep = (name) => STEP_ROLE.find(([re]) => re.test(name))?.[1] ?? 'era';

  // Active work and recent history per project, read from run.json (steps with real timestamps).
  function activity() {
    const items = [];
    for (const p of ctx.lab.list()) {
      const run = ctx.lab.store.latestRun(p.id);
      if (!run) continue;
      const project = ctx.lab.get(p.id);
      const roles = { ...(rolesOf(project) ?? {}), rea: 'rea', era: 'era' };
      const active = ctx.jobs.active(p.id);
      for (const [name, st] of Object.entries(run.steps ?? {})) {
        const role = roleOfStep(name);
        items.push({ project_id: p.id, run_id: run.run_id, step: name, role, agent: roles[role] ?? null, status: st.status === 'running' && !active ? 'stalled' : st.status, started_at: st.started_at ?? null, finished_at: st.finished_at ?? null, duration_ms: st.duration_ms ?? null, error: st.error ?? null });
      }
      if (run.status === 'awaiting-approval') items.push({ project_id: p.id, run_id: run.run_id, step: 'approval', role: 'user', agent: null, status: 'waiting', started_at: run.updated_at, finished_at: null, duration_ms: null, error: null });
    }
    return items.sort((a, b) => ((a.started_at ?? '') < (b.started_at ?? '') ? 1 : -1)).slice(0, 200);
  }

  function rolesOf(project) {
    return project.team?.roles ?? { architect: null, implementer: project.agent ?? null, reviewer: null };
  }

  // Calls, time, tokens and dollar cost per agent, summed from project ledgers.
  function usage() {
    const by = new Map();
    for (const p of ctx.lab.list()) {
      for (const e of ctx.lab.store.events(p.id)) {
        if (e.type !== 'implementer-finished') continue;
        const row = by.get(e.agent) ?? { agent: e.agent, calls: 0, ok: 0, failed: 0, duration_ms: 0, cost_usd: 0, cost_reported: false, input_tokens: 0, output_tokens: 0 };
        row.calls++;
        row[e.ok ? 'ok' : 'failed']++;
        row.duration_ms += e.duration_ms ?? 0;
        if (typeof e.cost_usd === 'number') {
          row.cost_usd += e.cost_usd;
          row.cost_reported = true;
        }
        row.input_tokens += e.usage?.input ?? 0;
        row.output_tokens += e.usage?.output ?? 0;
        by.set(e.agent, row);
      }
    }
    return [...by.values()].sort((a, b) => b.calls - a.calls);
  }

  return { providers, presets, recommend, team, activity, usage, roles: () => ROLE_NAMES.map((r) => ({ role: r, ...ROLES[r] })) };
}
