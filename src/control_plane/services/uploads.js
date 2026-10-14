// Screenshot uploads for browser mode (a web page cannot give ERA a file PATH, only bytes). Each upload is validated by
// its content (PNG/JPEG/WebP; size and dimensions limited), stored privately, and returned as a path the project can use
// as its reference. Metadata is stripped later, when a run starts, before any agent sees the file.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_LIMITS, inspectImage } from '../../project_lab/images.js';
import { bad, conflict, missing } from '../errors.js';

const ERA_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const SET = /^[a-f0-9]{8}$/;
const MAX_FILES_TOTAL = 300;

export const UPLOAD_MIME = ['image/png', 'image/jpeg', 'image/webp'];

export function uploadsService(ctx) {
  // Projects may not point into ERA's own installation (a development checkout keeps its state there), so uploads then go to a private folder in the home directory.
  const dir = () => {
    const inState = join(ctx.config.stateDirAbs, 'studio', 'uploads');
    const inside = resolve(inState) === ERA_ROOT || resolve(inState).startsWith(ERA_ROOT + sep);
    const d = inside ? join(homedir(), '.era-studio', 'uploads') : inState;
    mkdirSync(d, { recursive: true, mode: 0o700 });
    return realpathSync(d);
  };
  const count = (d) => readdirSync(d, { recursive: true }).length;

  function save(buffer, { set = null, name = '' } = {}) {
    if (set !== null && !SET.test(set)) throw bad('Invalid upload set.');
    const root = dir();
    if (count(root) >= MAX_FILES_TOTAL) throw conflict('Too many stored uploads. Remove old ones from the uploads folder.');
    let info;
    try {
      info = inspectImage(buffer, 'The uploaded file');
    } catch (err) {
      throw bad(err.message);
    }
    const id = set ?? randomBytes(4).toString('hex');
    const target = join(root, `set-${id}`);
    mkdirSync(target, { recursive: true, mode: 0o700 });
    const existing = readdirSync(target).filter((f) => /\.(png|jpg|webp)$/.test(f));
    if (existing.length >= IMAGE_LIMITS.maxFiles) throw conflict(`At most ${IMAGE_LIMITS.maxFiles} screenshots per rebuild.`);
    const file = `shot-${String(existing.length + 1).padStart(2, '0')}.${EXT[info.type]}`;
    writeFileSync(join(target, file), buffer, { mode: 0o600 });
    return { set: id, reference_path: target, file, original_name: String(name).replace(/[^\w. -]/g, '').slice(0, 80), type: info.type, mime: info.mime, width: info.width, height: info.height, bytes: info.bytes, sha256: info.sha256, count: existing.length + 1 };
  }

  // Serve one stored upload back to the UI (exact name patterns only; nothing else under the uploads folder is reachable).
  function read(set, file) {
    if (!SET.test(set) || !/^shot-\d{2}\.(png|jpg|webp)$/.test(file)) throw bad('Invalid upload.');
    const p = join(dir(), `set-${set}`, file);
    if (!existsSync(p)) throw missing('No such upload.');
    const bytes = readFileSync(p);
    return { bytes, mime: file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg' };
  }

  return { save, dir, read };
}
