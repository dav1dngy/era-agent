// Target classification by magic bytes and layout. Only kinds with a verified
// REA workflow are marked supported; everything else is reported honestly.
import { openSync, readSync, closeSync, readdirSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const JS_EXT = new Set(['.js', '.mjs', '.cjs']);
const ARCHIVE_EXT = new Set(['.zip', '.apk', '.ipa', '.jar', '.msix', '.appx', '.dmg']);

function readMagic(path, n = 8) {
  const buf = Buffer.alloc(n);
  const fd = openSync(path, 'r');
  try {
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

function dirLooksLikeJsApp(dir) {
  if (existsSync(join(dir, 'package.json'))) return true;
  try {
    return readdirSync(dir).some((f) => JS_EXT.has(extname(f)));
  } catch {
    return false;
  }
}

export function detectTarget(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    if (path.endsWith('.app')) return { kind: 'macos-app-bundle', supported: false, reason: 'macOS .app bundles: use `era rea open-binary`/`era rea inspect-macho` on the inner executable' };
    return dirLooksLikeJsApp(path)
      ? { kind: 'javascript-app', supported: true, reason: 'directory with package.json or JavaScript sources' }
      : { kind: 'directory', supported: false, reason: 'directory has no package.json or JavaScript sources' };
  }
  const ext = extname(path).toLowerCase();
  if (ext === '.asar') return { kind: 'asar', supported: true, reason: '.asar extension' };
  const m = readMagic(path);
  const hex = m.toString('hex');
  if (hex.startsWith('cffaedfe') || hex.startsWith('cefaedfe') || hex.startsWith('feedfacf') || hex.startsWith('feedface')) {
    return { kind: 'mach-o', supported: true, reason: `Mach-O magic ${hex.slice(0, 8)}` };
  }
  if (hex.startsWith('cafebabe') && ext !== '.class') {
    // FAT Mach-O: nfat_arch is a small big-endian count (Java class files use the same magic).
    const nfat = m.length >= 8 ? m.readUInt32BE(4) : 0;
    if (nfat > 0 && nfat < 32) return { kind: 'mach-o', supported: true, reason: `universal Mach-O with ${nfat} slices` };
  }
  if (hex.startsWith('7f454c46')) return { kind: 'elf', supported: false, reason: 'ELF: requires providers not configured in this ERA release; use `era rea` directly' };
  if (hex.startsWith('4d5a')) return { kind: 'pe', supported: false, reason: 'PE: not verified in this ERA release; use `era rea inspect-pe-resources`' };
  if (hex.startsWith('504b0304') || ARCHIVE_EXT.has(ext)) return { kind: 'archive', supported: true, reason: `archive (${ext || 'zip magic'})` };
  if (JS_EXT.has(ext)) return { kind: 'javascript-file', supported: true, reason: `${ext} source file` };
  return { kind: 'unknown', supported: false, reason: `unrecognized format (magic ${hex.slice(0, 8) || 'empty'})` };
}
