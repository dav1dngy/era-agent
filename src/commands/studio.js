// `era studio …`: start ERA Studio's control plane and its clients. The CLI works without any of this.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sandboxAvailable } from '../safety/sandbox.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO_DIR = resolve(HERE, '..', '..', 'apps', 'studio');
const print = (value, asJson) => process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${value}\n`);

export function electronBinary() {
  try {
    const req = createRequire(join(STUDIO_DIR, 'package.json'));
    const bin = req('electron');
    return typeof bin === 'string' && existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

async function serve(ctx, { flags }) {
  const { createControlPlane } = await import('../control_plane/server.js');
  const port = flags.port ? Number(flags.port) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be 0-65535 (0 picks a free port).');
  const cp = await createControlPlane({ config: ctx.config, rea: ctx.rea, log: ctx.log, version: ctx.version, port });
  await cp.start();
  const url = `${cp.url}/#token=${cp.token}`;
  if (flags.json) print({ url: cp.url, token: cp.token, port: cp.port, open: url }, true);
  else print(`ERA Studio control plane listening on ${cp.url} (loopback only)\nOpen in a browser: ${url}\nThe token changes every launch; keep this URL private. Press Ctrl+C to stop.`);
  if (flags.open) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  await new Promise((done) => {
    const stop = async () => {
      await cp.stop();
      done();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

async function app(ctx, { flags }) {
  const bin = electronBinary();
  if (!bin) {
    print('The desktop shell is not installed. Run `npm install --prefix apps/studio` (downloads Electron), or use `era studio serve --open` for a browser window.');
    return 1;
  }
  const child = spawn(bin, [STUDIO_DIR, ...(flags.dev ? ['--dev'] : [])], { stdio: 'inherit', env: { ...process.env, ERA_STUDIO_CWD: ctx.config.cwd, ERA_STATE_DIR: ctx.config.stateDirAbs } });
  return new Promise((done) => child.on('close', (code) => done(code ?? 0)));
}

async function doctor(ctx, { flags }) {
  const rea = await ctx.rea.status();
  const py = await new Promise((done) => {
    const c = spawn('python3', ['--version']);
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('error', () => done(null));
    c.on('close', (code) => done(code === 0 ? out.trim() : null));
  });
  const vendorOk = (name) => existsSync(join(STUDIO_DIR, 'node_modules', name)) || existsSync(join(resolve(HERE, '..', '..'), 'node_modules', name));
  const checks = [
    { name: 'REA engine', ok: !!rea.available, detail: rea.available ? rea.version : rea.error },
    { name: 'Web UI files', ok: existsSync(join(STUDIO_DIR, 'web', 'index.html')), detail: join(STUDIO_DIR, 'web') },
    { name: 'Preact + htm', ok: vendorOk('preact') && vendorOk('htm'), detail: 'npm install --prefix apps/studio' },
    { name: 'Monaco editor', ok: vendorOk('monaco-editor'), detail: 'needed for the code editor and diffs' },
    { name: 'xterm.js', ok: vendorOk('@xterm/xterm'), detail: 'needed for the terminal view' },
    { name: 'Electron desktop shell', ok: !!electronBinary(), detail: electronBinary() ?? 'optional: browser mode works without it' },
    { name: 'Execution sandbox', ok: sandboxAvailable(), detail: sandboxAvailable() ? 'macOS sandbox-exec' : 'none: project commands need --trust-project' },
    { name: 'python3 (terminal)', ok: !!py, detail: py ?? 'terminal unavailable without python3' },
    { name: 'State directory', ok: true, detail: ctx.config.stateDirAbs },
  ];
  if (flags.json) print({ checks }, true);
  else for (const c of checks) print(`${c.ok ? 'ok   ' : 'MISSING'} ${c.name.padEnd(24)} ${c.detail ?? ''}`);
  return checks.slice(0, 2).every((c) => c.ok) ? 0 : 1;
}

export async function run(command, ctx, { positional, flags }) {
  const sub = positional[0] ?? 'serve';
  if (sub === 'serve') return serve(ctx, { flags });
  if (sub === 'app') return app(ctx, { flags });
  if (sub === 'doctor') return doctor(ctx, { flags });
  throw new Error(`Unknown studio command "${sub}". Use: serve | app | doctor.`);
}
