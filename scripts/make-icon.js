'use strict';
// Draws icon.png (128 x 128): statement card with emerald header bar and credit/debit transaction bars on a dark tile.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 128, H = 128;
const px = Buffer.alloc(W * H * 4);
const set = (x, y, [r, g, b], a = 255) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const k = a / 255;
  px[i] = Math.round(px[i] * (1 - k) + r * k);
  px[i + 1] = Math.round(px[i + 1] * (1 - k) + g * k);
  px[i + 2] = Math.round(px[i + 2] * (1 - k) + b * k);
  px[i + 3] = Math.max(px[i + 3], a);
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const R = 22;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = Math.max(R - x, 0, x - (W - 1 - R)), dy = Math.max(R - y, 0, y - (H - 1 - R));
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= R) set(x, y, mix(hex('#1D2B38'), hex('#111820'), y / H), d > R - 1 ? Math.round(255 * (R - d)) : 255);
}

function rect(x0, y0, w, h, col, r = 3, a = 255) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const dx = Math.max(x0 + r - x, 0, x - (x0 + w - 1 - r)), dy = Math.max(y0 + r - y, 0, y - (y0 + h - 1 - r));
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= r) set(x, y, col, d > r - 1 ? Math.round(a * (r - d)) : a);
  }
}

// Bank statement header bar (teal/emerald)
rect(16, 16, 96, 18, hex('#10B981'), 5);
// Account balance pill
rect(16, 42, 46, 11, hex('#38BDF8'), 3);
rect(68, 42, 44, 11, hex('#334155'), 3);
// Transaction rows
rect(16, 60, 60, 10, hex('#64748B'), 3);
rect(82, 60, 30, 10, hex('#34D399'), 3);
rect(16, 76, 60, 10, hex('#64748B'), 3);
rect(82, 76, 30, 10, hex('#F87171'), 3);
rect(16, 92, 60, 10, hex('#64748B'), 3);
rect(82, 92, 30, 10, hex('#F87171'), 3);
// Footer line
rect(16, 109, 96, 3, hex('#475569'), 1);

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const crcT = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(
  path.join(__dirname, '..', 'icon.png'),
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
);
