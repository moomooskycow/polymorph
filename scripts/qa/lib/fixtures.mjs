/**
 * Tiny deterministic media fixtures for the QA suite. Generated at run time
 * from code + one embedded GIF, so the repo carries no binaries and the QA
 * suite has no ImageMagick dependency.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Minimal RGB PNG encoder (no ancillary chunks, filter 0). */
export function encodePng(width, height, [r, g, b]) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 12x12 two-frame blue/orange GIF, generated once with ImageMagick. */
const ANIMATED_GIF_BASE64 =
  'R0lGODlhDAAMAPAAADuC9gAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAADAAMAAACCoSPqcvtD6OclBUAIfkEABQAAAAsAAAAAAwADACA+XMWAAAAAgqEj6nL7Q+jnJQVADs=';

export function ensureFixtures(dir) {
  mkdirSync(dir, { recursive: true });
  const paths = {
    png: join(dir, 'fixture-tiny.png'),
    png2: join(dir, 'fixture-photo.png'),
    png3: join(dir, 'fixture-extra.png'),
    gif: join(dir, 'fixture-anim.gif'),
    corruptPng: join(dir, 'fixture-corrupt.png'),
    svg: join(dir, 'fixture-blocked.svg'),
  };
  writeFileSync(paths.png, encodePng(16, 16, [47, 111, 79]));
  writeFileSync(paths.png2, encodePng(24, 16, [232, 162, 92]));
  writeFileSync(paths.png3, encodePng(16, 24, [63, 95, 138]));
  writeFileSync(paths.gif, Buffer.from(ANIMATED_GIF_BASE64, 'base64'));
  // Valid PNG signature, undecodable payload: must be rejected as corrupt.
  writeFileSync(
    paths.corruptPng,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('this is not a decodable png payload', 'ascii'),
    ]),
  );
  writeFileSync(
    paths.svg,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="red"/></svg>\n',
  );
  return paths;
}