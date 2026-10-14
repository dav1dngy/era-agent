import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, mkdirSync, renameSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

// Removes a directory tree and NEVER throws. A descendant that outlived its process group (for example a process
// that left the session) can still be creating files while we delete, which makes a recursive remove fail with
// ENOTEMPTY/EBUSY. Node retries those errors; if the directory still cannot be removed the failure is returned
// (and logged by the caller if it cares) instead of replacing the real outcome of the operation being cleaned up.
export function removeTree(dir, { retries = 12, delayMs = 100 } = {}) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: retries, retryDelay: delayMs });
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: `${err.code ?? err.name}: ${err.message}` };
  }
}

export function newId(prefix) {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  return `${prefix}-${ts}-${randomBytes(3).toString('hex')}`;
}

export function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Atomic replacement: readers never observe a partially written file.
function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function writeJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(path, text) {
  atomicWrite(path, text);
}

export function fileInfo(path) {
  try {
    const st = statSync(path);
    return { exists: true, isFile: st.isFile(), isDirectory: st.isDirectory(), bytes: st.size };
  } catch {
    return { exists: false, isFile: false, isDirectory: false, bytes: 0 };
  }
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
