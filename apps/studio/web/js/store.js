// Tiny reactive store. State mirrors the control plane (settings, overview, projects, jobs); the UI adds only view state.
import { useEffect, useState } from './html.js';

const listeners = new Set();
export const state = {
  ready: false,
  conn: 'connecting',
  error: null,
  settings: null,
  overview: null,
  projects: [],
  jobs: {},
  progress: {},
  tasks: [],
  agents: null,
  teams: null,
  route: { path: [], query: {} },
  toasts: [],
  modal: null,
  palette: false,
  sidebarCollapsed: false,
  bottomOpen: false,
  bottomTab: 'logs',
  contextOpen: true,
  currentProject: null,
};

export function set(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  for (const l of listeners) l();
}

export function useStore(selector = (s) => s) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return selector(state);
}

let toastId = 1;
export function toast(message, kind = 'info', ms = 5000) {
  const id = toastId++;
  set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function openModal(modal) {
  set({ modal });
}
export const closeModal = () => set({ modal: null });

// ---- routing: #/home, #/projects/:id, #/settings/:section ...
export function parseHash(hash = location.hash) {
  const [p, q = ''] = hash.replace(/^#/, '').split('?');
  const path = p.split('/').filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return part; } });
  return { path: path.length ? path : ['home'], query: Object.fromEntries(new URLSearchParams(q)) };
}
export const navigate = (path, query) => {
  const q = query ? `?${new URLSearchParams(query)}` : '';
  location.hash = `#/${[].concat(path).map(encodeURIComponent).join('/')}${q}`;
};
export function startRouter() {
  let previous = location.hash;
  const sync = () => {
    if (state.editorDirty && location.hash !== previous && !window.confirm('Discard unsaved editor changes and leave this workspace?')) {
      history.replaceState(null, '', previous);
      return;
    }
    previous = location.hash;
    set({ route: parseHash() });
    if (['projects', 'workbench'].includes(state.route.path[0]) && state.route.path[1]) {
      try { localStorage.setItem('era.lastProject', state.route.path[1]); } catch { /* storage unavailable */ }
    }
  };
  window.addEventListener('beforeunload', (e) => { if (state.editorDirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', sync);
  sync();
}
