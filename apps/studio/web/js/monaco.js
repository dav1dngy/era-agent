// Lazy loader for the Monaco editor (served locally from node_modules/monaco-editor/min/vs, never from a CDN).
let loading = null;
export function loadMonaco() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/monaco/loader.js';
    s.onerror = () => reject(new Error('The Monaco editor is not installed (run npm install in apps/studio).'));
    s.onload = () => {
      window.MonacoEnvironment = {
        getWorkerUrl() {
          const base = `${location.origin}/vendor/monaco/`;
          return URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:'${base}'};importScripts('${base}base/worker/workerMain.js');`], { type: 'text/javascript' }));
        },
      };
      window.require.config({ paths: { vs: '/vendor/monaco' } });
      window.require(['vs/editor/editor.main'], () => {
        defineThemes(window.monaco);
        resolve(window.monaco);
      }, reject);
    };
    document.head.append(s);
  });
  return loading;
}

function defineThemes(m) {
  m.editor.defineTheme('era-dark', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#0f1012', 'editorGutter.background': '#0f1012', 'editor.lineHighlightBackground': '#1a1c20', 'editorLineNumber.foreground': '#4b5059', 'diffEditor.insertedTextBackground': '#52b78826', 'diffEditor.removedTextBackground': '#dc6b6626' } });
  m.editor.defineTheme('era-light', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f4f5f7' } });
}

export const monacoTheme = () => (document.documentElement.dataset.theme === 'light' ? 'era-light' : 'era-dark');
export const languageFor = (path) => ({ js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown', py: 'python', html: 'html', css: 'css', sh: 'shell', yml: 'yaml', yaml: 'yaml', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', swift: 'swift', rb: 'ruby', toml: 'ini', xml: 'xml', sql: 'sql' })[String(path).split('.').pop().toLowerCase()] ?? 'plaintext';
