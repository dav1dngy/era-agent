import { html, render } from './html.js';
import { ApiError, connectEvents, get, initAuth, put } from './api.js';
import { set, startRouter, state, toast } from './store.js';
import { App } from './app.js';

// ---- settings → document
export function applySettings(s) {
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = s.appearance.theme === 'system' ? (dark ? 'dark' : 'light') : s.appearance.theme;
  root.dataset.accent = s.appearance.accent;
  root.dataset.density = s.appearance.density;
  root.style.setProperty('--fs-base', `${s.appearance.fontSize}px`);
  root.style.setProperty('--font-mono', s.appearance.editorFont);
  document.documentElement.lang = s.general.language.split('-')[0];
}

export async function saveSettings(patch) {
  const r = await put('/api/settings', patch);
  set({ settings: r.settings });
  applySettings(r.settings);
  return r;
}

async function refreshProjects() {
  const r = await get('/api/projects');
  set({ projects: r.projects });
}

export async function refreshAll() {
  const [settings, overview, projects, jobs, tasks] = await Promise.all([get('/api/settings'), get('/api/overview'), get('/api/projects'), get('/api/jobs'), get('/api/tasks')]);
  set({ settings: settings.settings, overview, projects: projects.projects, jobs: Object.fromEntries(jobs.jobs.map((j) => [j.id, j])), tasks: tasks.tasks, ready: true, error: null });
  applySettings(settings.settings);
}

const logs = new Map();
export const jobLog = (id) => logs.get(id) ?? [];

function onEvent(ev) {
  switch (ev.type) {
    case 'job.updated': {
      const prev = state.jobs[ev.data.job.id];
      set((s) => ({ jobs: { ...s.jobs, [ev.data.job.id]: { ...prev, ...ev.data.job } } }));
      const done = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(ev.data.job.status);
      if (done && prev && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(prev.status)) {
        toast(`${ev.data.job.label}: ${ev.data.job.status}`, ev.data.job.status === 'succeeded' ? 'ok' : ev.data.job.status === 'failed' ? 'bad' : 'info');
        refreshProjects();
      }
      break;
    }
    case 'job.log': {
      const arr = logs.get(ev.data.job_id) ?? [];
      arr.push(...ev.data.lines.map((l) => ({ text: l, err: l.startsWith('! ') })));
      if (arr.length > 800) arr.splice(0, arr.length - 800);
      logs.set(ev.data.job_id, arr);
      set({ logTick: (state.logTick ?? 0) + 1 });
      break;
    }
    case 'progress':
      set((s) => ({ progress: { ...s.progress, [ev.data.project_id ?? ev.data.job_id]: ev.data.snapshot } }));
      break;
    case 'project.updated':
      refreshProjects();
      break;
    case 'task.updated':
      set((s) => ({ tasks: [ev.data.task, ...s.tasks.filter((t) => t.id !== ev.data.task.id)] }));
      break;
    case 'settings.updated':
      get('/api/settings').then((r) => {
        set({ settings: r.settings });
        applySettings(r.settings);
      });
      break;
    case 'resync':
      refreshAll().catch(() => {});
      break;
    default:
  }
}

async function boot() {
  const hasAuth = initAuth();
  document.body.classList.toggle('desktop-mac', !!window.eraDesktop && navigator.platform.startsWith('Mac'));
  startRouter();
  render(html`<${App} />`, document.getElementById('app'));
  if (!hasAuth) {
    set({ error: 'This page needs the access token. Open ERA Studio from `era studio serve` (the printed URL contains it) or use the desktop app.' });
    return;
  }
  try {
    await refreshAll();
    if (state.settings.general.startup === 'last-project' && state.route.path[0] === 'home') {
      try { const id = localStorage.getItem('era.lastProject'); if (state.projects.some((p) => p.id === id)) location.hash = `#/projects/${encodeURIComponent(id)}`; } catch { /* storage unavailable */ }
    }
  } catch (err) {
    set({ error: err instanceof ApiError && err.status === 401 ? 'The access token was rejected. Restart `era studio serve` and open the new URL.' : `Cannot reach the ERA control plane: ${err.message}` });
    return;
  }
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', () => state.settings && applySettings(state.settings));
  connectEvents(onEvent, (conn) => set({ conn }));
  setInterval(() => get('/api/overview').then((overview) => set({ overview })).catch(() => {}), 15_000);
}

boot();
