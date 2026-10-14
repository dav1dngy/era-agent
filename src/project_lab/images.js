// Reference images for screenshot-to-website rebuilds. Images are untrusted input: they are identified by their
// bytes (never by file name), size-limited, measured, and stripped of metadata (EXIF GPS/camera data, XMP, text chunks)
// BEFORE a copy is handed to a coding agent that may be a remote service. No third-party decoder is used.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export const IMAGE_LIMITS = Object.freeze({ maxFiles: 6, maxBytes: 12 * 1024 * 1024, maxPixels: 50_000_000, minSide: 64 });
export const IMAGE_TYPES = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });
const EXT = { png: '.png', jpeg: '.jpg', webp: '.webp' };

const u32 = (b, o) => b.readUInt32BE(o);

// Identify and measure an image from its bytes. Returns null for anything that is not a well-formed PNG/JPEG/WebP header.
export function sniffImage(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { type: 'png', width: u32(buf, 16), height: u32(buf, 20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 4 < buf.length) {
      if (buf[o] !== 0xff) return null;
      const marker = buf[o + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { o += marker === 0xff ? 1 : 2; continue; }
      const len = buf.readUInt16BE(o + 2);
      if (len < 2) return null;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return o + 9 <= buf.length ? { type: 'jpeg', height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) } : null;
      }
      o += 2 + len;
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('latin1', 12, 16);
    if (fourcc === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (fourcc === 'VP8L' && buf[20] === 0x2f) { const b = buf.readUInt32LE(21); return { type: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
    if (fourcc === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

// ---- metadata removal. Each returns { buffer, removed: [labels], removed_bytes }.
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function stripPng(buf) {
  const out = [buf.subarray(0, 8)];
  const removed = [];
  let o = 8;
  while (o + 12 <= buf.length) {
    const len = u32(buf, o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const end = o + 12 + len;
    if (end > buf.length) throw new Error('truncated PNG chunk');
    if (PNG_DROP.has(type)) removed.push(type);
    else out.push(buf.subarray(o, end));
    o = end;
    if (type === 'IEND') break;
  }
  return { buffer: Buffer.concat(out), removed };
}

function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  const removed = [];
  let o = 2;
  while (o < buf.length) {
    if (buf[o] !== 0xff) throw new Error('malformed JPEG');
    const marker = buf[o + 1];
    if (marker === 0xda) { out.push(buf.subarray(o)); break; } // start of scan: the rest is entropy-coded data
    if (marker === 0xd9) { out.push(buf.subarray(o)); break; }
    const len = buf.readUInt16BE(o + 2);
    const end = o + 2 + len;
    if (end > buf.length) throw new Error('truncated JPEG segment');
    // APP1 = EXIF/XMP, APP13 = Photoshop/IPTC, COM = comments. APP0 (JFIF), APP2 (ICC profile) and APP14 (Adobe color) are kept.
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) removed.push(marker === 0xe1 ? 'APP1(EXIF/XMP)' : marker === 0xed ? 'APP13(IPTC)' : 'COM');
    else out.push(buf.subarray(o, end));
    o = end;
  }
  return { buffer: Buffer.concat(out), removed };
}

function stripWebp(buf) {
  const chunks = [];
  const removed = [];
  let o = 12;
  while (o + 8 <= buf.length) {
    const type = buf.toString('latin1', o, o + 4);
    const len = buf.readUInt32LE(o + 4);
    const end = o + 8 + len + (len % 2);
    if (o + 8 + len > buf.length) throw new Error('truncated WebP chunk');
    if (type === 'EXIF' || type === 'XMP ') removed.push(type.trim());
    else {
      const chunk = Buffer.from(buf.subarray(o, Math.min(end, buf.length)));
      if (type === 'VP8X') chunk[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
      chunks.push(chunk);
    }
    o = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return { buffer: Buffer.concat([header, body]), removed };
}

export function stripMetadata(buf, type) {
  const r = type === 'png' ? stripPng(buf) : type === 'jpeg' ? stripJpeg(buf) : type === 'webp' ? stripWebp(buf) : null;
  if (!r) throw new Error(`unsupported image type ${type}`);
  return { ...r, removed_bytes: buf.length - r.buffer.length };
}

// Validates ONE image file (path or Buffer) and returns its facts. Throws a readable Error when it must not be used.
export function inspectImage(source, label = 'image') {
  const buf = Buffer.isBuffer(source) ? source : readFileSync(source);
  if (buf.length === 0) throw new Error(`${label} is empty.`);
  if (buf.length > IMAGE_LIMITS.maxBytes) throw new Error(`${label} is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${IMAGE_LIMITS.maxBytes / 1048576} MB.`);
  const info = sniffImage(buf);
  if (!info) throw new Error(`${label} is not a PNG, JPEG or WebP image (file contents were checked, not the file name).`);
  if (!info.width || !info.height) throw new Error(`${label} has no readable dimensions.`);
  if (Math.min(info.width, info.height) < IMAGE_LIMITS.minSide) throw new Error(`${label} is only ${info.width}×${info.height}px; a usable screenshot needs at least ${IMAGE_LIMITS.minSide}px on each side.`);
  if (info.width * info.height > IMAGE_LIMITS.maxPixels) throw new Error(`${label} has ${info.width}×${info.height} pixels; the limit is ${IMAGE_LIMITS.maxPixels / 1e6} megapixels.`);
  return { ...info, mime: IMAGE_TYPES[info.type], bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), buffer: buf };
}

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

// A reference is a screenshot reference when it is an image file, or a directory whose top level contains only images.
export function imageReferencePaths(reference) {
  if (!reference || !existsSync(reference)) return null;
  const st = statSync(reference);
  if (st.isFile()) return IMAGE_EXT.test(extname(reference)) || sniffImage(readFileSync(reference).subarray(0, 64 * 1024)) ? [reference] : null;
  if (st.isDirectory()) {
    const files = readdirSync(reference).filter((n) => !n.startsWith('.')).sort();
    const images = files.filter((n) => IMAGE_EXT.test(n)).map((n) => join(reference, n));
    return images.length && images.length === files.length ? images : null;
  }
  return null;
}

// Copies validated, metadata-stripped images into destDir under neutral names. Returns facts for the report.
export function prepareReferenceImages(paths, destDir) {
  if (!paths.length) throw new Error('No reference images were given.');
  if (paths.length > IMAGE_LIMITS.maxFiles) throw new Error(`${paths.length} reference images were given; the limit is ${IMAGE_LIMITS.maxFiles}.`);
  mkdirSync(destDir, { recursive: true });
  return paths.map((p, i) => {
    const label = `Reference image ${i + 1} (${p.split('/').pop()})`;
    const info = inspectImage(p, label);
    const stripped = stripMetadata(info.buffer, info.type);
    const again = sniffImage(stripped.buffer);
    if (!again || again.width !== info.width || again.height !== info.height) throw new Error(`${label}: removing metadata would have damaged the image; refusing to use it.`);
    const name = `reference-${i + 1}${EXT[info.type]}`;
    const path = join(destDir, name);
    writeFileSync(path, stripped.buffer, { mode: 0o600 });
    return { name, path, original_name: p.split('/').pop(), type: info.type, mime: info.mime, width: info.width, height: info.height, bytes: stripped.buffer.length, original_bytes: info.bytes, sha256: createHash('sha256').update(stripped.buffer).digest('hex'), original_sha256: info.sha256, metadata_removed: stripped.removed, metadata_removed_bytes: stripped.removed_bytes };
  });
}
