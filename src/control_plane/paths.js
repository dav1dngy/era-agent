// Filesystem boundary for the workbench: every path the UI names is resolved through the real filesystem
// and must stay inside a root the control plane granted (a project's source/reference/destination or an
// isolated working copy). Symlinks that leave the root are refused.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export class PathError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = 'PathError';
    this.status = status;
  }
}

const HIDDEN = new Set(['.git', 'node_modules', '.era', '.DS_Store']);
const MAX_READ = 2_000_000;

// Resolves rel (a path inside root); rejects absolute paths, "..", NULs and symlink escapes.
export function resolveInside(root, rel = '') {
  if (typeof rel !== 'string' || rel.includes('\0') || rel.startsWith('/') || rel.split(/[\\/]/).includes('..')) throw new PathError('Path is outside the allowed root');
  const realRoot = realpathSync(root);
  const target = resolve(realRoot, rel);
  if (target !== realRoot && !target.startsWith(realRoot + sep)) throw new PathError('Path is outside the allowed root');
  // For existing paths, the real location must stay inside the root as well.
  if (existsSync(target)) {
    const real = realpathSync(target);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new PathError('Path resolves outside the allowed root (symlink)');
  } else {
    let head = target;
    while (!existsSync(head)) head = resolve(head, '..');
    const real = realpathSync(head);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new PathError('Path resolves outside the allowed root');
  }
  return target;
}

export function listDir(root, rel = '') {
  const dir = resolveInside(root, rel);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new PathError('Not a directory', 404);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !HIDDEN.has(e.name))
    .map((e) => {
      const full = join(dir, e.name);
      const link = lstatSync(full).isSymbolicLink();
      let kind = e.isDirectory() ? 'dir' : 'file';
      let size = null;
      if (link) {
        try {
          resolveInside(root, join(rel, e.name));
          kind = statSync(full).isDirectory() ? 'dir' : 'file';
        } catch {
          kind = 'blocked-symlink';
        }
      }
      if (kind === 'file') size = statSync(full).size;
      return { name: e.name, kind, size };
    })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
}

export function readText(root, rel) {
  const file = resolveInside(root, rel);
  if (!existsSync(file) || !statSync(file).isFile()) throw new PathError('Not a file', 404);
  const size = statSync(file).size;
  if (size > MAX_READ) throw new PathError(`File is larger than ${MAX_READ} bytes`, 413);
  const buf = readFileSync(file);
  if (buf.subarray(0, 8000).includes(0)) return { binary: true, size, content: null };
  return { binary: false, size, content: buf.toString('utf8') };
}
