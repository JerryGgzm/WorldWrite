// Generates simple solid-color rounded-square PNG icons for the extension.
// Run with: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../src/assets");
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePng(size) {
  const [r, g, b] = [37, 99, 235]; // brand blue
  const radius = Math.floor(size * 0.22);
  const inside = (x, y) => {
    const corners = [
      [radius, radius],
      [size - radius, radius],
      [radius, size - radius],
      [size - radius, size - radius],
    ];
    if (x >= radius && x < size - radius) return true;
    if (y >= radius && y < size - radius) return true;
    for (const [cx, cy] of corners) {
      if (
        ((x < radius && cx === radius) || (x >= size - radius && cx !== radius)) &&
        ((y < radius && cy === radius) || (y >= size - radius && cy !== radius))
      ) {
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
      }
    }
    return true;
  };

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const on = inside(x, y);
      raw[p++] = on ? r : 0;
      raw[p++] = on ? g : 0;
      raw[p++] = on ? b : 0;
      raw[p++] = on ? 255 : 0;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), makePng(size));
  console.log(`wrote icon-${size}.png`);
}
