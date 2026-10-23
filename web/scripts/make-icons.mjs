// Gera os ícones PNG do PWA (192 e 512) sem dependências externas.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#E4572E'), CHEESE = hex('#FFD166'), CRUST = hex('#FFF4DC'), PEP = hex('#C1272D');

function pixel(x, y) {
  // coordenadas normalizadas 0..512
  const r = 112;
  const inRect = (() => {
    const cx = Math.min(Math.max(x, r), 512 - r), cy = Math.min(Math.max(y, r), 512 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  })();
  if (!inRect) return null;
  // fatia: triângulo (256,104) (404,380) (108,380) + borda arredondada embaixo
  const inTri = (px, py, grow = 0) => {
    const ax = 256, ay = 104 - grow * 1.6, bx = 404 + grow, by = 380 + grow * 0.4, cx2 = 108 - grow, cy2 = 380 + grow * 0.4;
    const s = (p1x, p1y, p2x, p2y) => (px - p2x) * (p1y - p2y) - (p1x - p2x) * (py - p2y);
    const d1 = s(ax, ay, bx, by), d2 = s(bx, by, cx2, cy2), d3 = s(cx2, cy2, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    const tri = !(neg && pos);
    const arc = py > 370 && py < 410 + grow && ((px - 256) / (150 + grow)) ** 2 + ((py - 380) / (40 + grow)) ** 2 <= 1;
    return tri || arc;
  };
  for (const [cx, cy, rr] of [[230, 250, 26], [292, 310, 24], [210, 340, 20], [268, 200, 14]]) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= rr * rr) return PEP;
  }
  if (inTri(x, y)) return CHEESE;
  if (inTri(x, y, 14)) return CRUST;
  return BG;
}

function png(size) {
  const rows = [];
  const ss = 3; // supersampling
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = pixel(((x + (sx + 0.5) / ss) * 512) / size, ((y + (sy + 0.5) / ss) * 512) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      const n = ss * ss, cov = a / 255;
      row.set(cov ? [r / cov, g / cov, b / cov, a / n] : [0, 0, 0, 0], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) writeFileSync(path.join(out, `icon-${size}.png`), png(size));
console.log('Ícones gerados em', out);
