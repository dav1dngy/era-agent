// ERA Studio desktop shell. A thin, locked-down host: it starts the ERA control plane (loopback only, token-protected),
// opens ONE window onto it, and exposes a native picker. All behavior lives in the control plane and the web UI.
'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const { execFile } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { trustedSender, sameOrigin } = require('./security.cjs');

const packaged = existsSync(path.join(__dirname, '..', 'era', 'src', 'control_plane', 'server.js'));
// Layout: dev  = <repo>/apps/studio/electron ; packaged = <app>/electron with the ERA sources under <app>/era
const ERA_ROOT = packaged ? path.join(__dirname, '..', 'era') : path.resolve(__dirname, '..', '..', '..');
const WEB_ROOT = path.join(__dirname, '..', 'web');
const VENDOR_ROOTS = [path.join(__dirname, '..', 'node_modules')];
const args = new Set(process.argv.slice(1));
const TEST_UI = !packaged && args.has('--test-ui');
const SMOKE = args.has('--smoke') || TEST_UI;

if (SMOKE && process.env.ERA_STATE_DIR) app.setPath('userData', path.join(process.env.ERA_STATE_DIR, 'chromium'));

let controlPlane = null;
let origin = null;
let win = null;

// Finder-launched apps get a minimal PATH; ERA, REA and project commands need the user's (node, git, python3...).
async function fixPath() {
  if (!['darwin', 'linux'].includes(process.platform)) return;
  const inherited = (process.env.PATH || '').split(':');
  const fromShell = await new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf %s "$PATH"'], { timeout: 4000 }, (err, out) => resolve(!err && out ? String(out).trim().split(':') : []));
  });
  const dirs = [...new Set([...inherited, ...fromShell, '/opt/homebrew/bin', '/usr/local/bin'])].filter((d) => path.isAbsolute(d) && !d.includes('\n'));
  // Finder and login shells can select an old Node even when the developer shell uses a supported one.
  // Prefer a verified runtime, not simply the first executable called node.
  let nodeDir = null;
  for (const dir of dirs) {
    if (!existsSync(path.join(dir, 'node'))) continue;
    const version = await new Promise((resolve) => execFile(path.join(dir, 'node'), ['--version'], { timeout: 2000 }, (err, out) => resolve(err ? '' : String(out).trim())));
    const match = /^v(\d+)\.(\d+)\./.exec(version);
    if (!match) continue;
    const major = Number(match[1]), minor = Number(match[2]);
    if ((major === 22 && minor >= 19) || (major === 24 && minor >= 11) || major >= 26) { nodeDir = dir; break; }
  }
  process.env.PATH = [...new Set([...(nodeDir ? [nodeDir] : []), ...dirs])].join(':');
}

async function startControlPlane() {
  const userData = app.getPath('userData');
  // Dev (`era studio app`) shares the CLI's directory and state; a packaged app keeps its own under Application Support.
  const cwd = process.env.ERA_STUDIO_CWD || (packaged ? userData : ERA_ROOT);
  const stateDir = process.env.ERA_STATE_DIR || path.join(cwd, packaged ? 'state' : '.era');
  mkdirSync(cwd, { recursive: true });
  process.env.ERA_STATE_DIR = stateDir;
  const { loadConfig } = await import(pathToFileURL(path.join(ERA_ROOT, 'src', 'core', 'config.js')).href);
  const { ReaClient } = await import(pathToFileURL(path.join(ERA_ROOT, 'src', 'rea_integration', 'rea-client.js')).href);
  const { createLogger } = await import(pathToFileURL(path.join(ERA_ROOT, 'src', 'core', 'log.js')).href);
  const { createControlPlane } = await import(pathToFileURL(path.join(ERA_ROOT, 'src', 'control_plane', 'server.js')).href);
  const config = loadConfig(cwd);
  mkdirSync(config.stateDirAbs, { recursive: true, mode: 0o700 });
  const log = createLogger({ stateDir: config.stateDirAbs, base: { era_version: app.getVersion(), surface: 'studio' } });
  const rea = ReaClient.fromConfig(config, log);
  controlPlane = await createControlPlane({ config, rea, log, version: app.getVersion(), webRoot: WEB_ROOT, vendorRoots: VENDOR_ROOTS, eraBin: path.join(ERA_ROOT, 'bin', 'era.mjs') });
  await controlPlane.start();
  origin = controlPlane.url;
}

function lockDownSession() {
  const ses = session.defaultSession;
  // Attach the token to requests for OUR control plane only, in the main process.
  ses.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, cb) => {
    const headers = { ...details.requestHeaders };
    if (win && details.webContentsId === win.webContents.id) headers.Authorization = `Bearer ${controlPlane.token}`;
    cb({ requestHeaders: headers });
  });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
}

const fromOurPage = (event) => trustedSender(event, win?.webContents, origin);

function registerIpc() {
  ipcMain.handle('era:pick-path', async (event) => {
    if (!fromOurPage(event)) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('era:version', (event) => (fromOurPage(event) ? { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome } : null));
}

function createWindow(devTools) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: !SMOKE,
    title: 'ERA Studio',
    backgroundColor: '#0f1012',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, webSecurity: true, allowRunningInsecureContent: false, devTools },
  });
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0, message: 'Discard unsaved editor changes?' });
    if (choice === 1) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only plain https links leave the app, in the user's browser; never a new Electron window.
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') shell.openExternal(u.toString());
    } catch {
      // ignore malformed URLs
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!sameOrigin(url, origin)) e.preventDefault();
  });
  win.webContents.on('will-redirect', (e, url) => { if (!sameOrigin(url, origin)) e.preventDefault(); });
  win.loadURL(`${origin}/`);
  return win;
}

function buildMenu() {
  const nav = (hash) => win?.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'ERA Studio', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => nav('#/settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Go', submenu: [{ label: 'New Task', click: () => nav('#/home') }, { label: 'Projects', click: () => nav('#/projects') }, { label: 'Agent Command Center', click: () => nav('#/agents') }] },
    { label: 'View', submenu: [...(win.webContents.getLastWebPreferences().devTools ? [{ role: 'toggleDevTools' }] : []), { role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]));
}

async function smoke() {
  // Real launch check used by the tests: start the control plane, load the UI in a hidden window, report facts, exit.
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'timed out waiting for the UI' }), 45_000);
    win.webContents.on('did-finish-load', async () => {
      try {
        const info = await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 120 && !document.querySelector('.shell'); i++) await new Promise((r) => setTimeout(r, 250));
          const o = await (await fetch('/api/overview')).json();
          return { shell: !!document.querySelector('.shell'), title: document.title, desktop: !!window.eraDesktop, injectedAuth: window.eraDesktop?.injectedAuth === true, node: typeof require !== 'undefined' || typeof process !== 'undefined', overview: { app: o.app, rea: o.rea.available, loopback: o.listener.loopback_only } };
        })()`);
        clearTimeout(timer);
        resolve({ ok: info.shell && info.desktop && info.injectedAuth && !info.node && info.overview.loopback, ...info });
      } catch (err) {
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      }
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => { clearTimeout(timer); resolve({ ok: false, error: `load failed: ${desc} (${code})` }); });
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.whenReady().then(async () => {
  try {
    if (process.env.ERA_STUDIO_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.ERA_STUDIO_DEBUG_PORT);
    await fixPath();
    await startControlPlane();
    lockDownSession();
    registerIpc();
    const devTools = args.has('--dev') || process.env.ERA_STUDIO_DEVTOOLS === '1' || controlPlane.ctx.settings().advanced.devTools;
    createWindow(devTools);
    buildMenu();
    if (SMOKE) {
      let code = await smoke();
      if (code === 0 && TEST_UI) code = await require('../scripts/test-ui.cjs')({ win, controlPlane, repo: ERA_ROOT });
      if (code === 0) app.quit(); // Exercise the normal window/worker shutdown path in smoke tests too.
      else { await controlPlane.stop(); app.exit(code); }
    }
  } catch (err) {
    process.stderr.write(`ERA Studio could not start: ${err.stack || err.message}\n`);
    dialog.showErrorBox('ERA Studio could not start', err.message);
    app.exit(1);
  }
});

let quitting = false;
app.on('window-all-closed', () => app.quit());
app.on('will-quit', (event) => {
  if (quitting || !controlPlane) return;
  event.preventDefault();
  quitting = true;
  controlPlane.stop().catch((e) => process.stderr.write(`Shutdown: ${e.message}\n`)).finally(() => app.exit(0));
});
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length && origin) createWindow(false);
});
