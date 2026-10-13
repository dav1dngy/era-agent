import { html } from './html.js';

// Small original line icons share a consistent stroke and inherit the active theme.
const paths = {
  home: ['M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z'],
  projects: ['M3 7h7l2 2h9v11H3Z', 'M3 7V4h7l2 3h8v2'],
  folder: ['M3 6h7l2 3h9v11H3Z'],
  analysis: ['M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3', 'M8 3h8M7 15h10'],
  lab: ['M7 3v5L3 18a2 2 0 0 0 2 3h9a2 2 0 0 0 2-3L12 8V3', 'M5 3h9M6 14h8M19 5v8M16 9h6'],
  improvement: ['M20 7a9 9 0 0 0-15 0L3 10', 'M3 4v6h6', 'M4 17a9 9 0 0 0 15 0l2-3', 'M15 14h6v6'],
  agents: ['M8 5h8v7H8Z', 'M12 2v3M5 21v-5h14v5M12 12v9M2 21h6M9 21h6M16 21h6'],
  tools: ['m14 4-3 5 4 4 5-3a7 7 0 0 1-9 8l-5 4-4-4 5-5a7 7 0 0 1 7-9Z'],
  settings: ['m10 3-1 3-3 1-3-1-1 4 2 2-1 3 3 3 3-1 2 3 4-1 1-3 3-1 2-4-2-2 1-4-4-2-3 1Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'm15 15 6 6'],
  plus: ['M12 4v16M4 12h16'],
  chevronRight: ['m9 5 7 7-7 7'],
  chevronDown: ['m5 9 7 7 7-7'],
  arrowUpRight: ['M6 18 18 6M6 6h12v12'],
  arrowRight: ['M4 12h16m-6-6 6 6-6 6'],
  code: ['m7 6-5 6 5 6m10-12 5 6-5 6M14 3l-4 18'],
  activity: ['M2 12h5l3-8 4 16 3-8h5'],
  check: ['m5 12 4 4L19 6'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7v5l3 2'],
  command: ['M9 9V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V9Z'],
  terminal: ['M3 4h18v16H3Z', 'm7 8 4 4-4 4m6 0h4'],
  shield: ['m12 2 8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5Z', 'm8 12 3 3 5-6'],
  sidebar: ['M3 4h18v16H3ZM9 4v16'],
  theme: ['M21 12a9 9 0 1 1-9-9 9 9 0 0 0 9 9'],
};

export function Icon({ name, size = 18 }) {
  return html`<svg class="icon-svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${(paths[name] ?? paths.code).map((d) => html`<path d=${d} />`)}</svg>`;
}

export function EraMark() {
  return html`<svg class="era-mark" viewBox="0 0 28 28" width="26" height="26" fill="none" aria-hidden="true"><path d="M7 5h17l-3 5H4ZM6 12h16l-3 5H3ZM5 19h15l-3 5H2Z" fill="currentColor" /></svg>`;
}
