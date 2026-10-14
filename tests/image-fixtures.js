// Builders for tiny structurally valid PNG/JPEG/WebP files (used by image and screenshot-rebuild tests).
import { deflateSync } from 'node:zlib';

const crc32 = (buf) => { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
export const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
export function makePng(w, h, extra = []) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const seg = (marker, data) => { const len = Buffer.alloc(2); len.writeUInt16BE(data.length + 2); return Buffer.concat([Buffer.from([0xff, marker]), len, data]); };
export function makeJpeg(w, h) {
  const sof = Buffer.alloc(15); sof[0] = 8; sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3); sof[5] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xe1, Buffer.from('Exif\0\0GPSLatitude=52.5200 SECRET-CAMERA')), seg(0xfe, Buffer.from('comment with secret')), seg(0xc0, sof), Buffer.from([0xff, 0xda, 0x00, 0x02, 1, 2, 3, 4, 0xff, 0xd9])]);
}
export function makeWebp(w, h) {
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x04; vp8x.writeUIntLE(w - 1, 4, 3); vp8x.writeUIntLE(h - 1, 7, 3);
  const c = (t, d) => { const hd = Buffer.alloc(8); hd.write(t, 0, 'latin1'); hd.writeUInt32LE(d.length, 4); return Buffer.concat([hd, d, d.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const body = Buffer.concat([c('VP8X', vp8x), c('EXIF', Buffer.from('GPS secret location')), c('XMP ', Buffer.from('<x:xmpmeta>secret</x:xmpmeta>')), c('VP8L', Buffer.from([0x2f, 0, 0, 0, 0, 0]))]);
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + body.length, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

