// IDE workbench services: Git status/diff/log (read-only), text search, and a sandboxed terminal.
// Everything is scoped to a project root granted by the control plane (see paths.js).
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { newId } from '../../core/util.js';
import { candidateEnv, candidateProfile, protectedStatePaths } from '../../safety/candidate-sandbox.js';
import { SANDBOX_EXEC, sandboxAvailable } from '../../safety/sandbox.js';
import { redactText } from '../../safety/secrets.js';
import { bad, conflict, denied, missing } from '../errors.js';
import { PathError, readText, resolveInside } from '../paths.js';

const run = promisify(execFile);
const HELPER = join(dirname(fileURLToPath(import.meta.url)), '..', 'pty-helper.py');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.era', 'dist', 'build', 'target', '__pycache__', '.venv']);
const MAX_TERMINALS = 3;
const IDLE_MS = 30 * 60_000;

const git = async (cwd, args) => {
  const { stdout } = await run('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.quotePath=false', ...args], { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 8_000_000, timeout: 20_000 });
  return stdout;
};

export function workbenchService(ctx) {
  const { audit, projects } = ctx;
  const terminals = new Map();

  const rootOf = (id, which, runId) => {
    try {
      return projects.rootFor(id, which, runId);
    } catch (err) {
      throw err.status ? err : missing(err.message);
    }
  };

  // ---- Git (read-only)
  async function gitStatus(id, which = 'source', runId = null) {
    const r = rootOf(id, which, runId);
    if (!existsSync(join(r.root, '.git'))) return { repository: false, note: which === 'workspace' ? 'The isolated working copy is a private repository; its changes are shown in the review.' : 'This directory is not a Git repository.' };
    const [status, log] = await Promise.all([git(r.root, ['status', '--porcelain=v1', '-b']), git(r.root, ['log', '-n', '25', '--format=%h%x09%an%x09%ad%x09%s', '--date=short']).catch(() => '')]);
    const lines = status.split('\n').filter(Boolean);
    const branch = lines[0]?.startsWith('##') ? lines.shift().slice(3) : null;
    const files = lines.map((l) => ({ index: l[0], worktree: l[1], path: l.slice(3) }));
    return { repository: true, branch, clean: files.length === 0, files, commits: log.split('\n').filter(Boolean).map((l) => { const [hash, author, date, subject] = l.split('\t'); return { hash, author, date, subject }; }) };
  }

  async function gitFileDiff(id, which, rel, runId = null) {
    const r = rootOf(id, which, runId);
    const abs = resolveInside(r.root, rel);
    const head = await git(r.root, ['show', `HEAD:${relative(realpathSync(r.root), abs)}`]).catch(() => '');
    let working = '';
    try {
      working = readText(r.root, rel).content ?? '';
    } catch (err) {
      if (!(err instanceof PathError)) throw err;
    }
    return { path: rel, original: head, modified: working };
  }

  // ---- Search (plain substring, case-insensitive)
  function search(id, which, query, runId = null) {
    if (typeof query !== 'string' || query.length < 2 || query.length > 200) throw bad('The search text must be 2 to 200 characters.');
    const r = rootOf(id, which, runId);
    const needle = query.toLowerCase();
    const hits = [];
    const walk = (dir) => {
      if (hits.length >= 200) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name) || e.isSymbolicLink()) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && statSync(full).size < 1_000_000) {
          let text;
          try {
            const buf = readFileSync(full);
            if (buf.subarray(0, 4000).includes(0)) continue;
            text = buf.toString('utf8');
          } catch {
            continue;
          }
          const lines = text.split('\n');
          for (let i = 0; i < lines.length && hits.length < 200; i++) if (lines[i].toLowerCase().includes(needle)) hits.push({ path: relative(r.root, full), line: i + 1, text: lines[i].trim().slice(0, 200) });
        }
      }
    };
    walk(r.root);
    return { query, truncated: hits.length >= 200, hits };
  }

  // ---- Terminal: a shell in a pseudo-terminal, inside ERA's sandbox, scoped to one project directory.
  function openTerminal(body = {}) {
    const settings = ctx.settings();
    if (!settings.permissions.terminal) throw denied('The terminal is off. Enable Settings → Permissions → Terminal.');
    if (terminals.size >= MAX_TERMINALS) throw conflict(`At most ${MAX_TERMINALS} terminals can be open.`);
    const which = body.root ?? 'workspace';
    const r = rootOf(String(body.project_id ?? ''), which, body.run_id ?? null);
    if (which === 'source' && !settings.permissions.directEdit) throw denied('A shell in the ORIGINAL project could modify it. Use the isolated working copy, or enable Settings → Permissions → Direct edit.');
    if (!['workspace', 'source'].includes(which)) throw denied('A terminal can be opened in a working copy or (with permission) the project source.');
    const sandbox = sandboxAvailable();
    if (!sandbox && !settings.permissions.trustedExecution) throw denied('No sandbox exists on this platform; a terminal would run unconfined. Enable Settings → Permissions → Trusted execution to accept that.');
    if (!existsSync(HELPER)) throw conflict('The terminal helper is missing.');
    const tmp = join(ctx.config.stateDirAbs, 'studio', 'terminals', newId('t'));
    mkdirSync(tmp, { recursive: true, mode: 0o700 });
    const shell = existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/sh';
    // The shared candidate profile (no network, writes only to the project and a private temp dir, no reads of ERA state or
    // credential stores) plus exactly what a pseudo-terminal needs: the pty device nodes and their ioctls.
    const cleanEnv = candidateEnv({ ...process.env, TERM: 'xterm-256color', PS1: '%~ %# ' }, { tmp, extra: { HOME: tmp } });
    const profile = `${candidateProfile({ writable: [r.root, tmp], denyRead: [...protectedStatePaths(ctx.config.stateDirAbs), ctx.config.stateDirAbs], network: false })}\n(allow pseudo-tty)\n(allow file-write* (literal "/dev/ptmx") (regex #"^/dev/ttys[0-9]+$"))\n(allow file-ioctl (literal "/dev/ptmx") (regex #"^/dev/ttys[0-9]+$"))`;
    const wrapped = sandbox ? { command: SANDBOX_EXEC, args: ['-p', profile, 'python3', HELPER, shell, '-f', '-i'], env: cleanEnv } : { command: 'python3', args: [HELPER, shell, '-f', '-i'], env: cleanEnv };
    const child = spawn(wrapped.command, wrapped.args, { cwd: r.root, env: wrapped.env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], detached: true });
    const t = { id: newId('term'), project_id: body.project_id, root: which, cwd: r.root, pid: child.pid, started_at: new Date().toISOString(), sandboxed: sandbox, buffer: '', subs: new Set(), closed: false, exit_code: null, last_active: Date.now(), child };
    terminals.set(t.id, t);
    const push = (chunk) => {
      const text = redactText(chunk.toString('utf8'));
      t.buffer = (t.buffer + text).slice(-200_000);
      for (const s of t.subs) s({ type: 'data', data: text });
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (err) => push(`\r\n[terminal could not start: ${err.message}]\r\n`));
    child.on('close', (code) => {
      t.closed = true;
      t.exit_code = code;
      for (const s of t.subs) s({ type: 'exit', code });
      clearInterval(t.idle);
    });
    t.idle = setInterval(() => Date.now() - t.last_active > IDLE_MS && closeTerminal(t.id), 60_000);
    t.idle.unref();
    audit.record('terminal.opened', { terminal_id: t.id, project_id: body.project_id, root: which, sandboxed: sandbox });
    return { id: t.id, project_id: t.project_id, root: which, cwd: t.cwd, sandboxed: sandbox, network: false };
  }

  const term = (id) => {
    const t = terminals.get(id);
    if (!t) throw missing('Unknown terminal.');
    return t;
  };

  function input(id, data) {
    const t = term(id);
    if (t.closed) throw conflict('The terminal has exited.');
    if (typeof data !== 'string' || data.length > 100_000) throw bad('data must be a string up to 100 KB.');
    t.last_active = Date.now();
    t.child.stdin.write(data);
    return { ok: true };
  }

  function resize(id, cols, rows) {
    const t = term(id);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 10 || rows < 3 || cols > 500 || rows > 200) throw bad('cols/rows out of range.');
    try {
      t.child.stdio[3].write(`resize ${cols} ${rows}\n`);
    } catch {
      // closed
    }
    return { ok: true };
  }

  function closeTerminal(id) {
    const t = terminals.get(id);
    if (!t) return { closed: false };
    if (!t.closed) {
      try {
        process.kill(-t.pid, 'SIGHUP');
      } catch {
        // gone
      }
      setTimeout(() => {
        try {
          process.kill(-t.pid, 'SIGKILL');
        } catch {
          // gone
        }
      }, 3000).unref();
    }
    terminals.delete(id);
    audit.record('terminal.closed', { terminal_id: id });
    return { closed: true };
  }

  // Replays the buffer, then streams. Returns an unsubscribe function.
  function attach(id, send) {
    const t = term(id);
    if (t.buffer) send({ type: 'data', data: t.buffer });
    if (t.closed) send({ type: 'exit', code: t.exit_code });
    t.subs.add(send);
    return () => t.subs.delete(send);
  }

  const listTerminals = () => [...terminals.values()].map((t) => ({ id: t.id, project_id: t.project_id, root: t.root, cwd: t.cwd, sandboxed: t.sandboxed, closed: t.closed, started_at: t.started_at }));
  const shutdown = () => [...terminals.keys()].forEach(closeTerminal);

  return { gitStatus, gitFileDiff, search, openTerminal, input, resize, closeTerminal, attach, listTerminals, shutdown, resolve };
}
