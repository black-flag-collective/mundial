/**
 * Generates raster favicons from the same globe motif as public/favicon.svg.
 *
 * Pure Node (zlib only) — no native image deps — so it runs anywhere. Renders
 * at 4x supersampling and box-downsamples for clean antialiasing, then writes:
 *   public/favicon-32.png        (PNG fallback)
 *   public/apple-touch-icon.png  (180x180 for iOS home screen)
 *   public/favicon.ico           (16+32 PNG-compressed entries; Safari/legacy)
 *
 * Regenerate with: node scripts/gen-favicon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLIC = path.join(__dirname, '..', 'public');

// ---- drawing -------------------------------------------------------------

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

// Render the icon as an RGBA Buffer at the given output size (supersampled
// internally for smooth edges).
function renderRGBA(size) {
  const S = 4;
  const W = size * S;
  const hi = new Float32Array(W * W * 4); // straight-alpha RGBA, 0..1

  const cx = W / 2;
  const cy = W / 2;
  const corner = W * 0.22; // matches favicon.svg rx
  const R = W * 0.345; // globe radius

  const bg = [4 / 255, 16 / 255, 28 / 255]; // #04101c
  const lit = [58 / 255, 130 / 255, 192 / 255]; // #3a82c0
  const dark = [6 / 255, 36 / 255, 61 / 255]; // #06243d
  const grid = [127 / 255, 178 / 255, 221 / 255]; // #7fb2dd
  const accent = [232 / 255, 112 / 255, 42 / 255]; // #e8702a

  const L = (() => {
    const v = [-0.42, -0.5, 0.76];
    const m = Math.hypot(...v);
    return [v[0] / m, v[1] / m, v[2] / m];
  })();

  const lineHalf = 0.055; // grid line half-thickness in sphere space

  function blend(i, c, a) {
    const dr = hi[i], dg = hi[i + 1], db = hi[i + 2], da = hi[i + 3];
    hi[i] = c[0] * a + dr * (1 - a);
    hi[i + 1] = c[1] * a + dg * (1 - a);
    hi[i + 2] = c[2] * a + db * (1 - a);
    hi[i + 3] = a + da * (1 - a);
  }

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;

      // rounded-rect background mask (transparent outside the corners)
      const rx = Math.max(0, Math.abs(x - cx) - (W / 2 - corner));
      const ry = Math.max(0, Math.abs(y - cy) - (W / 2 - corner));
      const cornerDist = Math.hypot(rx, ry);
      const bgA = 1 - smooth(corner - 1, corner + 1, cornerDist);
      if (bgA <= 0) continue;
      blend(i, bg, bgA);

      // globe sphere
      const nx = (x - cx) / R;
      const ny = (y - cy) / R;
      const r2 = nx * nx + ny * ny;
      if (r2 <= 1.04) {
        const edge = 1 - smooth(R - 1.2, R + 1.2, Math.hypot(x - cx, y - cy));
        const nz = Math.sqrt(Math.max(0, 1 - r2));
        const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        let col = mix(dark, lit, Math.pow(diff, 0.9));

        // grid: equator + prime meridian, fading toward the limb
        const limbFade = Math.min(1, nz * 1.6);
        if (Math.abs(ny) < lineHalf) {
          col = mix(col, grid, 0.5 * limbFade * (1 - Math.abs(ny) / lineHalf));
        }
        if (Math.abs(nx) < lineHalf) {
          col = mix(col, grid, 0.45 * limbFade * (1 - Math.abs(nx) / lineHalf));
        }
        blend(i, col, edge);

        // host marker dot, upper-left
        const md = Math.hypot(nx + 0.34, ny + 0.26);
        const mA = 1 - smooth(0.1, 0.16, md);
        if (mA > 0) blend(i, accent, mA * edge);
      }
    }
  }

  // box-downsample S x S -> output
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const i = ((y * S + sy) * W + (x * S + sx)) * 4;
          r += hi[i]; g += hi[i + 1]; b += hi[i + 2]; a += hi[i + 3];
        }
      }
      const n = S * S;
      const o = (y * size + x) * 4;
      out[o] = Math.round((r / n) * 255);
      out[o + 1] = Math.round((g / n) * 255);
      out[o + 2] = Math.round((b / n) * 255);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

function smooth(e0, e1, v) {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---- PNG encoding --------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines, each prefixed with filter byte 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- ICO encoding (PNG-compressed entries) -------------------------------

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const images = [];
  entries.forEach((e, idx) => {
    const o = idx * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0; // palette
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
    images.push(e.png);
  });
  return Buffer.concat([header, dir, ...images]);
}

// ---- write outputs -------------------------------------------------------

const png16 = encodePNG(renderRGBA(16), 16);
const png32 = encodePNG(renderRGBA(32), 32);
const png180 = encodePNG(renderRGBA(180), 180);

fs.writeFileSync(path.join(PUBLIC, 'favicon-32.png'), png32);
fs.writeFileSync(path.join(PUBLIC, 'apple-touch-icon.png'), png180);
fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), encodeICO([
  { size: 16, png: png16 },
  { size: 32, png: png32 }
]));

console.log('Wrote favicon-32.png, apple-touch-icon.png, favicon.ico');
