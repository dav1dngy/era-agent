// ERA Control Plane: the single, permissioned HTTP surface between ERA Studio (or any client) and ERA.
//   - binds 127.0.0.1 only; bearer token per launch; Host/Origin/Content-Type checks (see auth.js);
//   - routes to services that call ProjectLab, the analysis code and the Improvement Lab, or run the existing CLI as jobs;
//   - streams real backend events (Server-Sent Events, resumable with Last-Event-ID).
// It contains no UI. `apps/studio` is one client; the CLI (`era studio serve`) starts it.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SafetyError } from '../safety/policy.js';
import { createProjectLab } from '../project_lab/lab.js';
import { createCodingAgent } from '../agents/coding-agents.js';
import { nullLogger } from '../core/log.js';
import { AuditLog, EventBus } from './events.js';
import { checkHostAndOrigin, checkMutationContentType, checkToken, newToken } from './auth.js';
import { HttpError, bad, missing } from './errors.js';
import { JobManager } from './jobs.js';
import { PathError } from './paths.js';
import { SettingsStore } from './settings.js';
import { agentsService } from './services/agents.js';
import { analysisService } from './services/analysis.js';
import { improvementService } from './services/improvement.js';
import { projectsService } from './services/projects.js';
import { systemService } from './services/system.js';
import { UPLOAD_MIME, uploadsService } from './services/uploads.js';
import { tasksService } from './services/tasks.js';
import { workbenchService } from './services/workbench.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_ROOT = resolve(HERE, '..', '..', 'apps', 'studio', 'web');
const MAX_BODY = 1_000_000;
const MAX_UPLOAD = 13 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";

// Third-party front-end libraries are served from node_modules, allowlisted by name (nothing else is reachable).
function vendorMap(extraRoots = []) {
  // Locate packages by directory (some packages hide package.json behind their "exports" map).
  const roots = [...extraRoots, join(HERE, '..', '..', 'apps', 'studio', 'node_modules'), join(HERE, '..', '..', 'node_modules')];
  const pkgDir = (name) => roots.map((r) => join(r, name)).find((d) => existsSync(join(d, 'package.json'))) ?? null;
  const preact = pkgDir('preact');
  const htm = pkgDir('htm');
  const monaco = pkgDir('monaco-editor');
  const xterm = pkgDir('@xterm/xterm');
  const inter = pkgDir('@fontsource-variable/inter');
  const files = {};
  if (preact) Object.assign(files, { '/vendor/preact.js': join(preact, 'dist', 'preact.module.js'), '/vendor/preact-hooks.js': join(preact, 'hooks', 'dist', 'hooks.module.js') });
  if (inter) files['/vendor/inter.woff2'] = join(inter, 'files', 'inter-latin-wght-normal.woff2');
  if (htm) files['/vendor/htm.js'] = join(htm, 'dist', 'htm.module.js');
  if (xterm) Object.assign(files, { '/vendor/xterm.mjs': join(xterm, 'lib', 'xterm.mjs'), '/vendor/xterm.css': join(xterm, 'css', 'xterm.css') });
  const fit = pkgDir('@xterm/addon-fit');
  if (fit) files['/vendor/addon-fit.mjs'] = join(fit, 'lib', 'addon-fit.mjs');
  return { files, monacoDir: monaco ? join(monaco, 'min', 'vs') : null };
}

export async function createControlPlane({ config, rea, log = nullLogger, version = 'dev', host = '127.0.0.1', port = 0, token = newToken(), webRoot = DEFAULT_WEB_ROOT, vendorRoots = [], eraBin, env, createAgent = createCodingAgent } = {}) {
  if (host !== '127.0.0.1' && host !== '::1') throw new SafetyError('The control plane only binds the loopback interface.');
  const bus = new EventBus();
  const audit = new AuditLog(config.stateDirAbs);
  const settingsStore = new SettingsStore(config.stateDirAbs, { eraConfig: config });
  const getSettings = () => settingsStore.load();
  // In-process services (status, approval, AI assist, preflight) see the same unmetered-agent policy as the jobs:
  // the config file's value OR Studio's explicit setting.
  const fileAllowsUnmetered = config.projectLab?.budget?.allowUnmeteredAgents === true;
  const applyPolicy = () => {
    const allow = fileAllowsUnmetered || getSettings().execution.allowUnmeteredAgents === true;
    config.projectLab = { ...config.projectLab, budget: { ...config.projectLab.budget, allowUnmeteredAgents: allow } };
  };
  applyPolicy();
  const lab = createProjectLab({ config, rea, log, createAgent });
  const jobs = new JobManager({ config, bus, audit, getSettings, ...(eraBin ? { eraBin } : {}), ...(env ? { env } : {}) });
  const ctx = { config, rea, log, version, bus, audit, jobs, lab, createAgent, settings: getSettings, host, port: 0 };
  ctx.getSettingsStore = () => settingsStore;
  ctx.projects = projectsService(ctx);
  ctx.analysis = analysisService(ctx);
  ctx.agents = agentsService(ctx);
  ctx.improvement = improvementService(ctx);
  ctx.workbench = workbenchService(ctx);
  ctx.system = systemService(ctx);
  ctx.uploads = uploadsService(ctx);
  ctx.tasks = tasksService(ctx);
  const vendor = vendorMap(vendorRoots);

  const rawBody = (req, limit) =>
    new Promise((resolveBody, reject) => {
      const chunks = [];
      let size = 0;
      let tooBig = false;
      req.on('data', (c) => {
        size += c.length;
        if (tooBig) return;
        if (size > limit) { tooBig = true; chunks.length = 0; reject(new HttpError(413, `The upload is larger than ${Math.round(limit / 1048576)} MB.`)); } else chunks.push(c);
      });
      req.on('end', () => { if (!tooBig) resolveBody(Buffer.concat(chunks)); });
      req.on('error', reject);
    });

  const body = (req) =>
    new Promise((resolveBody, reject) => {
      const chunks = [];
      let size = 0;
      let tooBig = false;
      req.on('data', (c) => {
        size += c.length;
        if (tooBig) return; // drain and drop: the client gets a clean 413 instead of a reset connection
        if (size > MAX_BODY) {
          tooBig = true;
          chunks.length = 0;
          reject(new HttpError(413, 'Request body too large'));
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return;
        if (!chunks.length) return resolveBody({});
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolveBody(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          reject(bad('Body must be valid JSON.'));
        }
      });
      req.on('error', reject);
    });

  // [method, regex, handler(match, req, url, body)]
  const routes = [];
  const route = (method, pattern, handler) => routes.push([method, new RegExp(`^${pattern.replace(/:[a-z_]+/g, '([^/]+)')}$`), handler]);
  const q = (url, k, d = null) => url.searchParams.get(k) ?? d;
  const P = ctx.projects;

  route('GET', '/api/overview', async () => ctx.system.overview());
  route('GET', '/api/tools', async () => ctx.system.tools());
  route('POST', '/api/tools/rea-doctor', async () => ({ job: ctx.system.reaDoctor() }));
  route('GET', '/api/diagnostics', async () => ctx.system.diagnostics());
  route('GET', '/api/audit', async () => ({ entries: audit.tail(300) }));
  route('GET', '/api/settings', async () => ({ settings: getSettings() }));
  route('PUT', '/api/settings', async (_m, _r, _u, b) => {
    const r = settingsStore.update(b);
    if (!r.ok) throw bad('Settings were not applied.', { errors: r.errors });
    audit.record('settings.updated', { changed: r.changed });
    if (r.changed.includes('execution.allowUnmeteredAgents')) audit.record('policy.unmetered_agents', { enabled: r.settings.execution.allowUnmeteredAgents, note: 'agents that report no dollar cost may now run without a dollar spending cap' });
    applyPolicy();
    ctx.workbench.enforcePolicy();
    bus.publish('settings.updated', { changed: r.changed });
    return { settings: r.settings, changed: r.changed };
  });

  // projects and Project Lab
  route('GET', '/api/projects', async () => ({ projects: P.list() }));
  route('POST', '/api/projects', async (_m, _r, _u, b) => ({ project: P.create(b) }));
  route('GET', '/api/projects/:id', async (m) => P.status(m[1]));
  route('PATCH', '/api/projects/:id', async (m, _r, _u, b) => ({ project: P.update(m[1], b) }));
  route('DELETE', '/api/projects/:id', async (m) => P.remove(m[1]));
  route('GET', '/api/projects/:id/preflight', async (m, _r, u) => lab.preflight(m[1], q(u, 'op', 'modify'), { studio: true, trust: ctx.settings().permissions.trustedExecution }));
  route('POST', '/api/projects/clone', async (_m, _r, _u, b) => ({ job: P.clone(b) }));
  route('POST', '/api/projects/:id/assist', async (m, _r, _u, b) => ctx.workbench.assist(m[1], b));
  route('POST', '/api/projects/:id/ops/:op', async (m, _r, _u, b) => ({ job: await P.startOp(m[1], m[2], b) }));
  route('POST', '/api/projects/:id/cancel', async (m) => P.cancel(m[1]));
  route('GET', '/api/projects/:id/runs/:run', async (m) => P.runDetail(m[1], m[2] === 'latest' ? null : m[2]));
  route('GET', '/api/projects/:id/runs/:run/patch', async (m) => P.patchText(m[1], m[2] === 'latest' ? null : m[2]));
  route('GET', '/api/projects/:id/runs/:run/diff', async (m, _r, u) => P.fileDiff(m[1], m[2] === 'latest' ? null : m[2], q(u, 'path', '')));
  route('POST', '/api/projects/:id/approve', async (m, _r, _u, b) => P.approve(m[1], b));
  route('POST', '/api/projects/:id/reject', async (m, _r, _u, b) => P.reject(m[1], b));
  route('POST', '/api/projects/:id/rollback', async (m, _r, _u, b) => P.rollback(m[1], b));
  route('GET', '/api/projects/:id/tree', async (m, _r, u) => P.tree(m[1], q(u, 'root', 'source'), q(u, 'path', ''), q(u, 'run')));
  route('GET', '/api/projects/:id/file', async (m, _r, u) => P.readFile(m[1], q(u, 'root', 'source'), q(u, 'path', ''), q(u, 'run')));
  route('PUT', '/api/projects/:id/file', async (m, _r, u, b) => P.writeFile(m[1], q(u, 'root', 'workspace'), String(b.path ?? ''), b.content, q(u, 'run')));
  route('GET', '/api/projects/:id/git', async (m, _r, u) => ctx.workbench.gitStatus(m[1], q(u, 'root', 'source'), q(u, 'run')));
  route('GET', '/api/projects/:id/git/diff', async (m, _r, u) => ctx.workbench.gitFileDiff(m[1], q(u, 'root', 'source'), q(u, 'path', ''), q(u, 'run')));
  route('GET', '/api/projects/:id/search', async (m, _r, u) => ctx.workbench.search(m[1], q(u, 'root', 'source'), q(u, 'q', ''), q(u, 'run')));

  // terminal (permission and sandbox enforced in the service)
  route('GET', '/api/terminals', async () => ({ terminals: ctx.workbench.listTerminals() }));
  route('POST', '/api/terminals', async (_m, _r, _u, b) => ctx.workbench.openTerminal(b));
  route('POST', '/api/terminals/:id/input', async (m, _r, _u, b) => ctx.workbench.input(m[1], b.data));
  route('POST', '/api/terminals/:id/resize', async (m, _r, _u, b) => ctx.workbench.resize(m[1], b.cols, b.rows));
  route('DELETE', '/api/terminals/:id', async (m) => ctx.workbench.closeTerminal(m[1]));

  // screenshot uploads and run artifacts (images only, by exact name pattern)
  route('GET', '/api/uploads/:set/:file', async (m) => {
    const file = ctx.uploads.read(m[1], m[2]);
    return { __raw: file.bytes, type: file.mime };
  });
  route('GET', '/api/projects/:id/runs/:run/artifact', async (m, _r, u) => {
    const a = P.artifact(m[1], m[2] === 'latest' ? null : m[2], q(u, 'path', ''));
    return { __raw: a.bytes, type: a.mime };
  });

  // analysis (REA)
  route('GET', '/api/analyses', async () => ({ analyses: ctx.analysis.list() }));
  route('GET', '/api/analyses/:id', async (m) => ctx.analysis.get(m[1]));
  route('POST', '/api/analysis/detect', async (_m, _r, _u, b) => ctx.analysis.detect(b.target));
  route('POST', '/api/analysis', async (_m, _r, _u, b) => ({ job: await ctx.analysis.start(b) }));

  // agents
  route('GET', '/api/agents', async (_m, _r, u) => ({ providers: await ctx.agents.providers({ fresh: q(u, 'fresh') === '1' }), roles: ctx.agents.roles() }));
  route('GET', '/api/agents/teams', async () => ({ presets: await ctx.agents.presets(), recommended: await ctx.agents.recommend() }));
  route('GET', '/api/agents/activity', async () => ({ activity: ctx.agents.activity(), usage: ctx.agents.usage() }));
  route('GET', '/api/agents/team/:id', async (m) => ctx.agents.team(m[1]));

  // improvement lab
  const I = ctx.improvement;
  route('GET', '/api/improvement', async () => I.overview());
  route('GET', '/api/improvement/cycles/:id', async (m) => I.cycle(m[1]));
  route('POST', '/api/improvement/self-analyze', async () => ({ job: await I.selfAnalyze() }));
  route('POST', '/api/improvement/propose', async (_m, _r, _u, b) => ({ job: await I.propose(b) }));
  route('POST', '/api/improvement/cycles/:id/:action', async (m, _r, _u, b) => {
    const fn = { implement: I.implement, evaluate: I.evaluate, rebase: I.rebase, cancel: I.cancel, decline: I.decline, approve: I.approve }[m[2]];
    if (!fn) throw missing(`Unknown action "${m[2]}".`);
    return { job: await fn(m[1], b) };
  });
  route('POST', '/api/improvement/rollback', async (_m, _r, _u, b) => ({ job: await I.rollback(b) }));

  // tasks (natural language → structured workflow)
  route('POST', '/api/tasks/plan', async (_m, _r, _u, b) => ctx.tasks.plan(b));
  route('POST', '/api/tasks', async (_m, _r, _u, b) => ({ task: await ctx.tasks.start(b) }));
  route('GET', '/api/tasks', async () => ({ tasks: ctx.tasks.list() }));
  route('GET', '/api/tasks/:id', async (m) => ctx.tasks.get(m[1]) ?? Promise.reject(missing('Unknown task.')));

  // jobs
  route('GET', '/api/jobs', async () => ({ jobs: jobs.list() }));
  route('GET', '/api/jobs/:id', async (m) => jobs.get(m[1]) ?? Promise.reject(missing('Unknown job.')));
  route('POST', '/api/jobs/:id/cancel', async (m) => (await jobs.cancel(m[1])) ?? Promise.reject(missing('Unknown job.')));

  const send = (res, status, data, headers = {}) => {
    const text = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(text);
  };

  const sse = (req, res, attach, { lastId = null } = {}) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    res.write('retry: 2000\n\n');
    const write = (event, id = null) => res.write(`${id !== null ? `id: ${id}\n` : ''}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const detach = attach(write, lastId);
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(beat);
      detach();
    });
  };

  async function handleApi(req, res, url) {
    const pre = checkHostAndOrigin(req, ctx.port);
    if (!pre.ok) return send(res, pre.status, { error: pre.error });
    const auth = checkToken(req, token);
    if (!auth.ok) return send(res, auth.status, { error: auth.error });
    // Image uploads are the one mutation that is not JSON; they still need the token, Host and Origin checks above.
    if (req.method === 'POST' && url.pathname === '/api/uploads') {
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!UPLOAD_MIME.includes(type)) return send(res, 415, { error: 'Upload a PNG, JPEG or WebP image.' });
      const buf = await rawBody(req, MAX_UPLOAD);
      const saved = ctx.uploads.save(buf, { set: url.searchParams.get('set'), name: url.searchParams.get('name') ?? '' });
      ctx.audit.record('upload.saved', { set: saved.set, type: saved.type, bytes: saved.bytes });
      return send(res, 200, saved);
    }
    const ct = checkMutationContentType(req);
    if (!ct.ok) return send(res, ct.status, { error: ct.error });

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const header = req.headers['last-event-id'];
      const lastId = header !== undefined ? Number(header) : url.searchParams.has('last_event_id') ? Number(url.searchParams.get('last_event_id')) : null;
      return sse(req, res, (write, last) => {
        write({ type: 'hello', data: { last_event_id: bus.nextId - 1, server_time: new Date().toISOString() } });
        if (last !== null && Number.isFinite(last)) {
          const { events, complete } = bus.since(last);
          if (!complete) write({ type: 'resync', data: { reason: 'Some events were missed; reload state.' } });
          for (const e of events) write(e, e.id);
        }
        return bus.subscribe((e) => write(e, e.id));
      }, { lastId });
    }
    const term = /^\/api\/terminals\/([^/]+)\/stream$/.exec(url.pathname);
    if (req.method === 'GET' && term) {
      try {
        return sse(req, res, (write) => ctx.workbench.attach(term[1], (m) => write(m)));
      } catch (err) {
        return send(res, err.status ?? 500, { error: err.message });
      }
    }

    for (const [method, re, handler] of routes) {
      if (method !== req.method) continue;
      const m = re.exec(url.pathname);
      if (!m) continue;
      const payload = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await body(req) : {};
      const out = await handler(m.map((x, i) => (i ? decodeURIComponent(x) : x)), req, url, payload);
      if (out?.__raw) {
        res.writeHead(200, { 'Content-Type': out.type, 'Content-Length': out.__raw.length, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
        return res.end(out.__raw);
      }
      return send(res, 200, out);
    }
    return send(res, 404, { error: 'Unknown endpoint' });
  }

  // The only inline script is the import map; its exact content is allowed by hash instead of 'unsafe-inline'.
  const cspCache = new Map();
  function cspFor(file) {
    if (extname(file) !== '.html') return CSP;
    const mtime = statSync(file).mtimeMs;
    const hit = cspCache.get(file);
    if (hit?.mtime === mtime) return hit.csp;
    const hashes = [...readFileSync(file, 'utf8').matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    const csp = hashes.length ? CSP.replace("script-src 'self'", `script-src 'self' ${hashes.join(' ')}`) : CSP;
    cspCache.set(file, { mtime, csp });
    return csp;
  }

  function serveFile(res, file, extra = {}) {
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': cspFor(file), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache', ...extra });
    createReadStream(file).pipe(res);
  }

  function handleStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' });
    const hostCheck = checkHostAndOrigin(req, ctx.port);
    if (!hostCheck.ok) return send(res, hostCheck.status, { error: hostCheck.error });
    const p = url.pathname;
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (vendor.files[p]) return serveFile(res, vendor.files[p]);
    if (p.startsWith('/vendor/monaco/') && vendor.monacoDir) {
      const rel = normalize(p.slice('/vendor/monaco/'.length));
      const file = resolve(vendor.monacoDir, rel);
      if (rel.startsWith('..') || (file !== vendor.monacoDir && !file.startsWith(vendor.monacoDir + sep))) return send(res, 403, { error: 'Forbidden' });
      if (existsSync(file) && statSync(file).isFile()) return serveFile(res, file);
      return send(res, 404, { error: 'Not found' });
    }
    const rel = p === '/' ? 'index.html' : normalize(p.slice(1));
    const file = resolve(webRoot, rel);
    if (rel.startsWith('..') || (file !== resolve(webRoot) && !file.startsWith(resolve(webRoot) + sep))) return send(res, 403, { error: 'Forbidden' });
    if (existsSync(file) && statSync(file).isFile()) return serveFile(res, file);
    return send(res, 404, { error: 'Not found' });
  }

  const server = createServer(async (req, res) => {
    // Parsing the request target is part of handling the request: a malformed target from any local process must be answered
    // with 400, never raised out of the callback (an uncaught rejection here would end the whole control plane and its jobs).
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(res, 400, { error: 'Malformed request target.' });
    }
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else handleStatic(req, res, url);
    } catch (err) {
      const status = err instanceof HttpError || err instanceof PathError ? err.status : err instanceof SafetyError ? 403 : 500;
      if (status === 500) log.error('control_plane.error', { path: url.pathname, error: err.message, error_name: err.name });
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Internal error (see the ERA log)' : err.message, ...(err.detail ? { detail: err.detail } : {}) });
      else res.end();
    }
  });

  return {
    ctx,
    token,
    get port() {
      return ctx.port;
    },
    get url() {
      return `http://127.0.0.1:${ctx.port}`;
    },
    async start() {
      await new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => {
          server.off('error', fail);
          ok();
        });
      });
      ctx.port = server.address().port;
      audit.record('control_plane.started', { port: ctx.port, version });
      return this;
    },
    async stop() {
      ctx.workbench.shutdown();
      await jobs.shutdown();
      await new Promise((ok) => {
        server.close(ok);
        server.closeAllConnections?.();
      });
      audit.record('control_plane.stopped', {});
    },
  };
}
