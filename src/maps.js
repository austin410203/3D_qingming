// maps.js — rasterises the hand-annotated layout into painting-space masks (shared by 2D + 3D).
// Mask space: MW x MH covering strip u in [0, STRIP_W], v in [0, STRIP_H].
import { STRIP_W, STRIP_H, MPX, WATER, ISLANDS, HILLS, PATHS, LANDMARKS, BLOCKS } from './layout.js';

export const MW = 8192, MH = 256;
const SX = MW / STRIP_W, SY = MH / STRIP_H;

function canvas() {
  const c = document.createElement('canvas'); c.width = MW; c.height = MH;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(SX, 0, 0, SY, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, STRIP_W, STRIP_H);
  return [c, g];
}
const poly = (g, pts) => { g.beginPath(); pts.forEach(([u, v], i) => i ? g.lineTo(u, v) : g.moveTo(u, v)); g.closePath(); g.fill(); };

function boxBlur(src, w, h, r, passes = 2) {
  let a = src, b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {               // horizontal
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    const ry = Math.max(1, Math.round(r * SY / SX / 4));   // mask px are ~4x taller than wide in world units
    for (let x = 0; x < w; x++) {               // vertical
      let acc = 0;
      for (let y = -ry; y <= ry; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * ry + 1);
        acc += b[Math.min(h - 1, y + ry + 1) * w + x] - b[Math.max(0, y - ry) * w + x];
      }
    }
  }
  return a;
}

function toFloat(g) {
  const d = g.getImageData(0, 0, MW, MH).data, f = new Float32Array(MW * MH);
  for (let i = 0; i < f.length; i++) f[i] = d[i * 4] / 255;
  return f;
}

export function buildMaps() {
  // water
  const [cw, gw] = canvas();
  gw.fillStyle = '#fff'; WATER.forEach(p => poly(gw, p));
  gw.fillStyle = '#000'; ISLANDS.forEach(p => poly(gw, p));
  HILLS.forEach(([p]) => poly(gw, p));
  const water = toFloat(gw);
  const waterSoft = boxBlur(water.slice(), MW, MH, 3);

  // roads (stroke width in metres -> strip px along u; v is squashed so use a bit less)
  const [cr, gr] = canvas();
  gr.strokeStyle = '#fff'; gr.lineCap = gr.lineJoin = 'round';
  for (const [pts, wm, , kind] of PATHS) {
    if (kind === 'bridge' || kind === 'corridor') continue;
    gr.lineWidth = wm / MPX * 0.8;
    gr.beginPath(); pts.forEach(([u, v], i) => i ? gr.lineTo(u, v) : gr.moveTo(u, v)); gr.stroke();
  }
  const road = boxBlur(toFloat(gr), MW, MH, 2, 1);

  // fields
  const [cf, gf] = canvas();
  gf.fillStyle = '#fff';
  LANDMARKS.filter(l => l.t === 'fields').forEach(l => poly(gf, l.poly));
  const fields = toFloat(gf);

  // building blocks (used to keep trees out of towns)
  const [cb, gb] = canvas();
  gb.fillStyle = '#fff'; BLOCKS.forEach(([p]) => poly(gb, p));
  const blocks = toFloat(gb);

  // hills: height field (metres)
  const hill = new Float32Array(MW * MH);
  for (const [p, h] of HILLS) {
    const [c, g] = canvas(); g.fillStyle = '#fff'; poly(g, p);
    const m = boxBlur(toFloat(g), MW, MH, 10, 3);
    for (let i = 0; i < m.length; i++) hill[i] = Math.max(hill[i], Math.pow(m[i], 0.8) * h);
  }

  // RGBA texture for shaders: R water (soft), G road, B field, A hill/40
  const tex = new Uint8Array(MW * MH * 4);
  for (let i = 0; i < MW * MH; i++) {
    tex[i * 4] = waterSoft[i] * 255; tex[i * 4 + 1] = road[i] * 255;
    tex[i * 4 + 2] = fields[i] * 255; tex[i * 4 + 3] = Math.min(1, hill[i] / 40) * 255;
  }
  return { water, waterSoft, road, fields, blocks, hill, tex, canvasWater: cw };
}

// bilinear sample of a mask at strip coords
export function sampleMask(m, u, v) {
  const x = u * SX - 0.5, y = v * SY - 0.5;
  const x0 = Math.max(0, Math.min(MW - 2, Math.floor(x))), y0 = Math.max(0, Math.min(MH - 2, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
  const i = y0 * MW + x0;
  return (m[i] * (1 - fx) + m[i + 1] * fx) * (1 - fy) + (m[i + MW] * (1 - fx) + m[i + MW + 1] * fx) * fy;
}
