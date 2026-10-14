// Visual verification for screenshot rebuilds. Runs INSIDE an Electron process started by ERA as
//   <electron> <app> --era-visual-compare --html <index.html> --reference <image> --out <dir> [--width N] [--height N] [--assets <dir>]
// It renders the generated site offline in a locked-down page, saves the rendering, and scores it against the reference.
// ERA runs this whole process under its macOS sandbox profile (no network, writes only to --out and a temp dir).
'use strict';
const { app, BrowserWindow, nativeImage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(1);
const arg = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const html = arg('html');
const referencePath = arg('reference');
const out = arg('out');
const assetsDir = arg('assets');
const finish = (code, result) => {
  try { fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`); } catch { /* the exit code still reports failure */ }
  app.exit(code);
};

// ---- comparison metrics (pure functions over RGBA/BGRA bitmaps) -------------------------------------------------
const N = 96;
function toGray(bmp) {
  const g = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) g[i] = 0.114 * bmp[i * 4] + 0.587 * bmp[i * 4 + 1] + 0.299 * bmp[i * 4 + 2]; // BGRA
  return g;
}
function bitmap(img) {
  const r = img.resize({ width: N, height: N, quality: 'best' });
  return r.toBitmap();
}
const pearson = (a, b) => {
  let ma = 0; let mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  if (da === 0 && db === 0) return 1; // two flat images are identical in structure
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function sobel(g) {
  const e = new Float64Array(N * N);
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const p = (dx, dy) => g[(y + dy) * N + x + dx];
    const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
    const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
    e[y * N + x] = Math.hypot(gx, gy);
  }
  return e;
}
function blocks(g, k = 12) {
  const s = N / k;
  const out2 = [];
  for (let by = 0; by < k; by++) for (let bx = 0; bx < k; bx++) {
    let sum = 0;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) sum += g[(by * s + y) * N + bx * s + x];
    out2.push(sum / (s * s));
  }
  return out2;
}
function histogram(bmp) {
  const h = new Float64Array(512);
  for (let i = 0; i < N * N; i++) h[((bmp[i * 4 + 2] >> 5) << 6) | ((bmp[i * 4 + 1] >> 5) << 3) | (bmp[i * 4] >> 5)]++;
  return h.map((v) => v / (N * N));
}
function compare(refImg, renImg) {
  const a = bitmap(refImg);
  const b = bitmap(renImg);
  const ga = toGray(a);
  const gb = toGray(b);
  let mae = 0;
  for (let i = 0; i < ga.length; i++) mae += Math.abs(ga[i] - gb[i]);
  mae /= ga.length;
  const luminance = clamp01(1 - mae / 64);
  const ha = histogram(a); const hb = histogram(b);
  let inter = 0;
  for (let i = 0; i < 512; i++) inter += Math.min(ha[i], hb[i]);
  const edges = clamp01(pearson(sobel(ga), sobel(gb)));
  const layout = clamp01(pearson(blocks(ga), blocks(gb)));
  const score = 0.3 * luminance + 0.2 * inter + 0.3 * edges + 0.2 * layout;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  return { score: r4(score), luminance: r4(luminance), color: r4(inter), edges: r4(edges), layout: r4(layout) };
}

// ---- main ---------------------------------------------------------------------------------------------------------
if (!html || !referencePath || !out) { process.stderr.write('usage: --html <file> --reference <image> --out <dir>\n'); app.exit(2); }
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'electron-data'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const started = Date.now();
  try {
    const reference = nativeImage.createFromPath(referencePath);
    if (reference.isEmpty()) return finish(3, { error: 'The reference image could not be decoded.' });
    const rs = reference.getSize();
    const cssW = Math.max(320, Math.min(1920, Number(arg('width')) || Math.round(rs.width / (rs.width >= 1800 ? 2 : 1))));
    const cssH = Math.max(240, Math.min(6000, Number(arg('height')) || Math.round(rs.height * (cssW / rs.width))));
    const root = fs.realpathSync(path.dirname(html));
    const blocked = [];
    const consoleErrors = [];
    const ses = session.fromPartition(`era-visual-${process.pid}-${Date.now()}`); // in-memory: nothing persists
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest.onBeforeRequest((details, cb) => {
      let ok;
      try {
        const u = new URL(details.url);
        if (u.protocol === 'file:') { const p = fs.realpathSync(decodeURIComponent(u.pathname)); ok = p === root || p.startsWith(root + path.sep); }
        else ok = u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:';
      } catch { ok = false; }
      if (!ok && blocked.length < 25) blocked.push(details.url.slice(0, 200));
      cb({ cancel: !ok });
    });
    const win = new BrowserWindow({ show: false, width: cssW, height: cssH, useContentSize: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    // Electron 44 passes one event object; older versions pass (event, level, message).
    win.webContents.on('console-message', (e, level, message) => { const lvl = e.level ?? level; const msg = e.message ?? message; if ((lvl === 'error' || lvl >= 3) && consoleErrors.length < 15) consoleErrors.push(String(msg).slice(0, 200)); });
    await Promise.race([win.loadFile(html), new Promise((_r, rej) => setTimeout(() => rej(new Error('the page did not finish loading in 20 s')), 20_000))]);
    await new Promise((r) => setTimeout(r, 700)); // fonts, layout, CSS transitions
    const page = await Promise.race([win.webContents.executeJavaScript(`(() => {
      const vw = innerWidth, vh = innerHeight; let img = 0, bg = 0;
      for (const el of document.querySelectorAll('img,picture,canvas,video')) { const r = el.getBoundingClientRect(); img = Math.max(img, r.width * r.height); }
      for (const el of document.querySelectorAll('*')) { const b = getComputedStyle(el).backgroundImage; if (b && b !== 'none' && /url\\(/.test(b)) { const r = el.getBoundingClientRect(); bg = Math.max(bg, r.width * r.height); } }
      return { title: document.title, text_length: (document.body ? document.body.innerText : '').trim().length, elements: document.querySelectorAll('*').length, scroll_height: document.documentElement.scrollHeight, scroll_width: document.documentElement.scrollWidth, max_image_coverage: +(img / (vw * vh)).toFixed(3), max_background_image_coverage: +(bg / (vw * vh)).toFixed(3), viewport: [vw, vh] };
    })()`), new Promise((_r, rej) => setTimeout(() => rej(new Error('the page did not answer')), 10_000))]);
    const rendered = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, 'rendered.png'), rendered.toPNG());
    const metrics = compare(reference, rendered);
    // A page that merely shows a copy of the screenshot must not pass: score every raster asset against the reference.
    const copies = [];
    if (assetsDir && fs.existsSync(assetsDir)) {
      const stack = [assetsDir];
      while (stack.length && copies.length < 40) {
        const d = stack.pop();
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.isSymbolicLink()) continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) { if (!['.git', 'node_modules'].includes(e.name)) stack.push(p); } else if (/\.(png|jpe?g|webp)$/i.test(e.name) && fs.statSync(p).size < 12_000_000) {
            const im = nativeImage.createFromPath(p);
            if (!im.isEmpty()) copies.push({ file: path.relative(assetsDir, p), similarity: compare(reference, im).score });
          }
        }
      }
    }
    finish(0, { ok: true, ...metrics, metrics, page, reference: rs, rendered: rendered.getSize(), css_viewport: [cssW, cssH], blocked_requests: blocked, console_errors: consoleErrors, assets: copies, max_asset_similarity: copies.reduce((m, c) => Math.max(m, c.similarity), 0), duration_ms: Date.now() - started });
  } catch (err) {
    finish(1, { ok: false, error: err.message });
  }
});
setTimeout(() => finish(4, { ok: false, error: 'the renderer timed out' }), Number(arg('timeout')) || 90_000).unref();
