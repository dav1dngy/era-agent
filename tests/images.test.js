// Reference-image validation and metadata removal (structure-level: crafted PNG/JPEG/WebP files; real decoding is
// exercised in tests/screenshot-rebuild.test.js with the real renderer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMAGE_LIMITS, imageReferencePaths, inspectImage, prepareReferenceImages, sniffImage, stripMetadata } from '../src/project_lab/images.js';
import { chunk, makeJpeg, makePng, makeWebp } from './image-fixtures.js';
import { tempDir } from './helpers.js';

test('images are identified by their bytes and measured, not trusted by name', () => {
  assert.deepEqual(sniffImage(makePng(320, 200)), { type: 'png', width: 320, height: 200 });
  assert.deepEqual(sniffImage(makeJpeg(640, 480)), { type: 'jpeg', width: 640, height: 480 });
  assert.equal(sniffImage(makeWebp(300, 150)).type, 'webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null, 'SVG can carry scripts and is not accepted');
  assert.equal(sniffImage(Buffer.from('GIF89a....')), null);
  assert.equal(sniffImage(Buffer.from('#!/bin/sh\necho hi\n')), null);
});

test('inspectImage rejects empty, tiny, huge, oversized and non-image files with readable reasons', () => {
  assert.throws(() => inspectImage(Buffer.alloc(0), 'shot'), /empty/);
  assert.throws(() => inspectImage(Buffer.from('not an image at all, just text'), 'shot'), /not a PNG, JPEG or WebP/);
  assert.throws(() => inspectImage(makePng(20, 20), 'shot'), /at least 64px/);
  assert.throws(() => inspectImage(makePng(9000, 9000), 'shot'), /megapixels/);
  assert.throws(() => inspectImage(Buffer.concat([makePng(100, 100), Buffer.alloc(IMAGE_LIMITS.maxBytes)]), 'shot'), /MB; the limit/);
  assert.equal(inspectImage(makePng(100, 100), 'shot').mime, 'image/png');
});

test('metadata is removed from PNG, JPEG and WebP while the image stays valid', () => {
  const png = makePng(100, 100, [chunk('tEXt', Buffer.from('GPS\0secret-location')), chunk('eXIf', Buffer.from('exifsecret')), chunk('tIME', Buffer.alloc(7))]);
  const p = stripMetadata(png, 'png');
  assert.deepEqual(p.removed.sort(), ['eXIf', 'tEXt', 'tIME']);
  assert.ok(!p.buffer.includes('secret-location') && !p.buffer.includes('exifsecret'));
  assert.deepEqual(sniffImage(p.buffer), { type: 'png', width: 100, height: 100 });
  assert.ok(p.buffer.includes('IDAT') && p.buffer.includes('IEND'));

  const j = stripMetadata(makeJpeg(200, 100), 'jpeg');
  assert.deepEqual(j.removed.sort(), ['APP1(EXIF/XMP)', 'COM']);
  assert.ok(!j.buffer.includes('SECRET-CAMERA') && !j.buffer.includes('comment with secret'));
  assert.ok(j.buffer.includes('JFIF'), 'the JFIF header is kept');
  assert.deepEqual(sniffImage(j.buffer), { type: 'jpeg', width: 200, height: 100 });

  const w = stripMetadata(makeWebp(300, 150), 'webp');
  assert.deepEqual(w.removed.sort(), ['EXIF', 'XMP']);
  assert.ok(!w.buffer.includes('GPS secret') && !w.buffer.includes('xmpmeta'));
  assert.equal(w.buffer.readUInt32LE(4), w.buffer.length - 8, 'the RIFF size was fixed');
  assert.equal(w.buffer[12 + 8] & 0x0c, 0, 'the EXIF/XMP flags were cleared');
  assert.deepEqual(sniffImage(w.buffer), { type: 'webp', width: 300, height: 150 });
  assert.throws(() => stripMetadata(Buffer.from('x'), 'gif'), /unsupported/);
});

test('prepareReferenceImages writes neutral, stripped copies and reports what was removed', () => {
  const src = tempDir();
  writeFileSync(join(src, 'My Private Screenshot (Berlin).png'), makePng(200, 120, [chunk('tEXt', Buffer.from('GPS\0secret'))]));
  writeFileSync(join(src, 'b.jpg'), makeJpeg(300, 200));
  const refs = imageReferencePaths(src);
  assert.equal(refs.length, 2);
  const out = join(tempDir(), 'ref');
  const facts = prepareReferenceImages(refs, out);
  assert.deepEqual(facts.map((f) => f.name), ['reference-1.png', 'reference-2.jpg'], 'input order is by file name');
  assert.deepEqual(readdirSync(out).sort(), facts.map((f) => f.name).sort(), 'files get neutral names: the original name (which may be personal) is not used');
  assert.ok(facts.every((f) => f.sha256 !== f.original_sha256 && f.metadata_removed.length > 0));
  for (const f of readdirSync(out)) assert.ok(!readFileSync(join(out, f)).includes('secret') && !readFileSync(join(out, f)).includes('SECRET'));
  assert.throws(() => prepareReferenceImages([], out), /No reference images/);
  assert.throws(() => prepareReferenceImages(Array(IMAGE_LIMITS.maxFiles + 1).fill(refs[0]), out), /limit is/);
});

test('a directory counts as a screenshot reference only if it holds nothing but images', () => {
  const d = tempDir();
  writeFileSync(join(d, 'a.png'), makePng(100, 100));
  assert.equal(imageReferencePaths(d).length, 1);
  writeFileSync(join(d, 'README.md'), 'x');
  assert.equal(imageReferencePaths(d), null);
  assert.equal(imageReferencePaths(join(d, 'missing')), null);
  const f = join(d, 'weird.dat');
  writeFileSync(f, makePng(100, 100));
  assert.equal(imageReferencePaths(f)?.length, 1, 'an image is recognized by content even with an odd extension');
  mkdirSync(join(d, 'sub'));
});
