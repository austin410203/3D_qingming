// arch.js — procedural Song/Qing-style architecture into merged, vertex-coloured batches.
// Local frame: x along the building front, z = depth (+z = front), y up. Batch.frame places it in the world.
import * as THREE from 'three';

const C = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
export const PAL = {
  plaster: C('#e8dfc8'), plaster2: C('#d8cbb0'), plasterGrey: C('#c9c4b4'), timber: C('#6e4c33'), timberRed: C('#9c4c36'),
  roof: C('#7b8183'), roof2: C('#6c7274'), roofDark: C('#4f5456'), thatch: C('#a8956c'), stone: C('#bdb6a4'), stoneDark: C('#9b9484'),
  interior: C('#3a2f26'), awning: C('#d9cdab'), awning2: C('#c9b98f'), cloth: C('#efe8d6'), clothBlue: C('#55718a'), clothRed: C('#b55a43'),
  yellow: C('#cf9f42'), green: C('#4f8063'), blue: C('#46708a'), red: C('#a83a2c'), redWall: C('#b8553f'), marble: C('#e6e0d2'),
  brick: C('#93918a'), brickDark: C('#7b7972'), wood: C('#8a6a48'), woodDark: C('#5b4430'), lattice: C('#5a4636'), gold: C('#d8b45a'),
  hull: C('#8c6a45'), hullDark: C('#5f4630'), mat: C('#b9a274'), sail: C('#c7b08a'),
};

export class Batch {
  constructor() { this.pos = []; this.col = []; this.tex = []; this.setFrame(0, 0, 0, 0); }
  setFrame(ox, oy, oz, ry) { this.f = { ox, oy, oz, c: Math.cos(ry), s: Math.sin(ry) }; }
  T(x, y, z) { const f = this.f; return [f.ox + x * f.c + z * f.s, f.oy + y, f.oz - x * f.s + z * f.c]; }
  tri(a, b, c, col, tx = 0, ty = 0) {
    for (const p of [a, b, c]) { this.pos.push(...this.T(p[0], p[1], p[2])); this.col.push(...col); this.tex.push(p[3] ?? tx, ty); }
  }
  quad(a, b, c, d, col, tx, ty) { this.tri(a, b, c, col, tx, ty); this.tri(a, c, d, col, tx, ty); }
  // axis-aligned (in local frame) box, y0 = bottom
  box(cx, y0, cz, sx, sy, sz, col, { top = true, bottom = false, ty = 0, colTop } = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + sy;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, 0, ty);   // front
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, 0, ty);   // back
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, 0, ty);   // left
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, 0, ty);   // right
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], colTop || col, 0, ty);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, 0, ty);
  }
  // box between two local points (beams, poles, rails); w = width, h = height
  beam(a, b, w, h, col) {
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
    const save = this.f, ry = Math.atan2(-dz, dx);
    const mid = this.T((a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2);
    const c = Math.cos(ry), s = Math.sin(ry);
    this.f = { ox: mid[0], oy: save.oy, oz: mid[2], c: save.c * c - save.s * s, s: save.s * c + save.c * s };
    if (Math.abs(b[1] - a[1]) < 1e-3) this.box(0, a[1] - h / 2, 0, L, h, w, col);
    else {  // sloped: build as a skewed box
      const y0 = a[1], y1 = b[1], hw = w / 2, hh = h / 2;
      const P = (x, y, z) => [x, y, z];
      const A0 = P(-L / 2, y0 - hh, -hw), A1 = P(-L / 2, y0 - hh, hw), A2 = P(-L / 2, y0 + hh, hw), A3 = P(-L / 2, y0 + hh, -hw);
      const B0 = P(L / 2, y1 - hh, -hw), B1 = P(L / 2, y1 - hh, hw), B2 = P(L / 2, y1 + hh, hw), B3 = P(L / 2, y1 + hh, -hw);
      this.quad(A1, B1, B2, A2, col); this.quad(B0, A0, A3, B3, col); this.quad(A3, A2, B2, B3, col); this.quad(A0, B0, B1, A1, col);
    }
    this.f = save;
  }
  pole(x, z, y0, h, r, col) { this.box(x, y0, z, r, h, r, col); }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aTex', new THREE.Float32BufferAttribute(this.tex, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  get tris() { return this.pos.length / 9; }
}

// ---------------- roofs ----------------
// Hip / pyramid / skirt roof. L (x), D (z) are the wall footprint; o = overhang; y0 eave height; rise to ridge.
// ridge length = max(0, L - D * k); fMax < 1 makes a skirt (腰簷 / lower tier of a double-eaved roof).
export function roofHip(b, { L, D, o = 1, y0, rise, col = PAL.roof, ridgeK = 1, up = 0.6, fMax = 1, cx = 0, cz = 0, finial = false, ridgeCol = PAL.roofDark }) {
  const hx = L / 2 + o, hz = D / 2 + o, R = Math.max(0, L - D * ridgeK) / 2;
  const N = 4, M = 6;
  const eaveY = s => y0 + up * Math.pow(Math.abs(s), 5);           // upturned corners
  const surf = (E0, E1, R0, R1) => {   // E*, R* = [x, z] eave and ridge end points
    const pt = (i, j) => {
      const s = i / M, f = (j / N) * fMax;
      const ex = E0[0] + (E1[0] - E0[0]) * s, ez = E0[1] + (E1[1] - E0[1]) * s;
      const rx = R0[0] + (R1[0] - R0[0]) * s, rz = R0[1] + (R1[1] - R0[1]) * s;
      const sx = 2 * s - 1;
      const y = eaveY(sx) * (1 - f) + (y0 + rise) * f - (1 - f) * f * rise * 0.35;   // concave sag
      const t = ex + (rx - ex) * f;
      return [cx + t, y + 0, cz + ez + (rz - ez) * f, (E1[0] - E0[0]) * s + (E1[1] - E0[1]) * s];
    };
    for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
      const a = pt(i, j), b2 = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      b.quad(a, b2, c, d, col, 0, 1);
    }
  };
  surf([-hx, hz], [hx, hz], [-R, 0], [R, 0]);       // front
  surf([hx, -hz], [-hx, -hz], [R, 0], [-R, 0]);     // back
  surf([hx, hz], [hx, -hz], [R, 0], [R, 0]);        // right
  surf([-hx, -hz], [-hx, hz], [-R, 0], [-R, 0]);    // left
  if (fMax >= 1) {
    if (R > 0.1) b.box(cx, y0 + rise - 0.05, cz, 2 * R + 0.5, 0.35, 0.35, ridgeCol);
    if (finial) { b.box(cx, y0 + rise, cz, 0.35, 0.9, 0.35, PAL.gold); b.box(cx, y0 + rise + 0.9, cz, 0.6, 0.25, 0.6, PAL.gold); }
    if (R > 0.1) for (const sx of [-1, 1]) b.box(cx + sx * (R + 0.15), y0 + rise - 0.05, cz, 0.45, 0.75, 0.4, ridgeCol);   // ridge-end owls
  }
  // fascia under the eave edge
  b.quad([cx - hx, y0 - 0.25, cz + hz], [cx + hx, y0 - 0.25, cz + hz], [cx + hx, y0 + 0.02, cz + hz], [cx - hx, y0 + 0.02, cz + hz], PAL.timber);
}

// Gable roof (硬山 / 懸山): ridge along x. Optional gable overhang ox.
export function roofGable(b, { L, D, o = 0.9, ox = 0.4, y0, rise, col = PAL.roof, wallCol = PAL.plaster, cx = 0, cz = 0, ridgeCol = PAL.roofDark }) {
  const hx = L / 2 + ox, hz = D / 2 + o, N = 4;
  const Y = f => y0 + rise * f - (1 - f) * f * rise * 0.3;
  for (const side of [1, -1]) for (let j = 0; j < N; j++) {
    const f0 = j / N, f1 = (j + 1) / N;
    const z0 = side * hz * (1 - f0), z1 = side * hz * (1 - f1);
    const a = [cx - hx, Y(f0), cz + z0, -hx], b2 = [cx + hx, Y(f0), cz + z0, hx], c = [cx + hx, Y(f1), cz + z1, hx], d = [cx - hx, Y(f1), cz + z1, -hx];
    if (side > 0) b.quad(a, b2, c, d, col, 0, 1); else b.quad(b2, a, d, c, col, 0, 1);
  }
  // gable walls
  for (const sx of [-1, 1]) {
    const x = cx + sx * L / 2;
    b.tri([x, y0 - 0.3, cz - D / 2], [x, y0 - 0.3, cz + D / 2], [x, Y(1) - 0.15, cz], wallCol);
  }
  b.box(cx, Y(1) - 0.1, cz, 2 * hx + 0.2, 0.32, 0.32, ridgeCol);
  for (const sx of [-1, 1]) b.box(cx + sx * (hx + 0.05), Y(1) - 0.1, cz, 0.3, 0.6, 0.34, ridgeCol);
  b.quad([cx - hx, y0 - 0.2, cz + hz], [cx + hx, y0 - 0.2, cz + hz], [cx + hx, y0 + 0.02, cz + hz], [cx - hx, y0 + 0.02, cz + hz], PAL.timber);
}

// ---------------- building parts ----------------
function facade(b, { L, H, z, y0 = 0, open = false, col = PAL.plaster, timber = PAL.timber, rnd }) {
  // posts across the front, either open shop front (dark interior, counter) or wall with lattice windows + door
  const bays = Math.max(2, Math.round(L / 3.2)), bw = L / bays;
  if (open) {
    b.quad([-L / 2, y0, z - 0.6], [L / 2, y0, z - 0.6], [L / 2, y0 + H, z - 0.6], [-L / 2, y0 + H, z - 0.6], PAL.interior);
    b.box(0, y0, z - 0.2, L * 0.92, 0.9, 0.5, PAL.wood);                         // counter
    // goods on the counter
    for (let i = 0; i < bays * 2; i++) if (rnd() < 0.6) b.box(-L / 2 + (i + 0.5) * bw / 2, y0 + 0.9, z - 0.2, 0.5, 0.3 + rnd() * 0.3, 0.35, [PAL.cloth, PAL.clothBlue, PAL.clothRed, PAL.awning2][i % 4]);
  } else {
    for (let i = 0; i < bays; i++) {
      const x = -L / 2 + (i + 0.5) * bw;
      if (i === Math.floor(bays / 2)) b.quad([x - 0.65, y0, z + 0.03], [x + 0.65, y0, z + 0.03], [x + 0.65, y0 + 2.3, z + 0.03], [x - 0.65, y0 + 2.3, z + 0.03], PAL.interior);
      else b.quad([x - bw * 0.3, y0 + 1.0, z + 0.03], [x + bw * 0.3, y0 + 1.0, z + 0.03], [x + bw * 0.3, y0 + H - 0.5, z + 0.03], [x - bw * 0.3, y0 + H - 0.5, z + 0.03], PAL.lattice);
    }
  }
  for (let i = 0; i <= bays; i++) b.box(-L / 2 + i * bw, y0, z, 0.28, H, 0.28, timber);
  b.box(0, y0 + H - 0.3, z, L + 0.3, 0.3, 0.3, timber);                              // lintel
}

// common house / shop. opts: L, D, stories, style ('village'|'shop'|'urban'|'thatch'), rnd
export function house(b, { L, D, stories = 1, style = 'urban', rnd }) {
  const H1 = 3.2 + rnd() * 0.6;
  const shop = style === 'shop';
  const wallC = rnd() < 0.7 ? PAL.plaster : rnd() < 0.5 ? PAL.plaster2 : PAL.plasterGrey;
  b.box(0, -0.3, 0, L + 0.6, 0.6, D + 0.6, PAL.stone);                                 // plinth
  b.box(0, 0.3, -0.3, L, H1, D - 0.6, wallC);
  facade(b, { L, H: H1, z: D / 2 - 0.3, y0: 0.3, open: shop, rnd, timber: rnd() < 0.3 ? PAL.timberRed : PAL.timber });
  // timber frame stripes on the sides
  for (const sx of [-1, 1]) b.box(sx * L / 2, 0.3, -0.3, 0.12, H1, D - 0.4, PAL.timber, { top: false });
  let top = 0.3 + H1;
  if (stories > 1) {
    // skirt roof + balcony + upper floor
    roofHip(b, { L: L, D: D - 0.6, cz: -0.3, o: 0.9, y0: top - 0.1, rise: 1.6, fMax: 0.45, up: 0.35, col: PAL.roof2 });
    const L2 = L - 0.4, H2 = 2.8;
    b.box(0, top + 0.6, -0.5, L2, H2, D - 1.6, wallC);
    facade(b, { L: L2, H: H2, z: D / 2 - 0.9, y0: top + 0.6, rnd, open: false });
    for (let i = 0; i <= 8; i++) b.box(-L2 / 2 + i * L2 / 8, top + 0.6, D / 2 - 0.2, 0.1, 0.9, 0.1, PAL.timberRed);
    b.box(0, top + 1.45, D / 2 - 0.2, L2, 0.12, 0.12, PAL.timberRed);
    top += 0.6 + H2;
  }
  const roofCol = style === 'thatch' ? PAL.thatch : rnd() < 0.5 ? PAL.roof : PAL.roof2;
  const rise = D * (0.32 + rnd() * 0.06);
  if (style === 'thatch' || (style === 'village' && rnd() < 0.5) || rnd() < 0.55) roofGable(b, { L, D, y0: top, rise, col: roofCol, wallCol: wallC, cz: -0.3 });
  else roofHip(b, { L, D, y0: top, rise: rise * 0.9, col: roofCol, ridgeK: 0.8, up: 0.45, cz: -0.3 });
  if (shop) {
    // cloth awning on poles + sign board, sometimes a wine banner (酒旗)
    const aw = rnd() < 0.5 ? PAL.awning : PAL.awning2, ad = 2.2 + rnd() * 1.2, ah = 2.7;
    const x0 = -L / 2 + 0.2, x1 = L / 2 - 0.2, z0 = D / 2, z1 = D / 2 + ad;
    b.quad([x0, ah + 0.4, z0], [x1, ah + 0.4, z0], [x1, ah - 0.3, z1], [x0, ah - 0.3, z1], aw);
    b.quad([x1, ah + 0.4, z0], [x0, ah + 0.4, z0], [x0, ah - 0.3, z1], [x1, ah - 0.3, z1], aw);
    b.pole(x0 + 0.1, z1, 0, ah - 0.3, 0.12, PAL.woodDark); b.pole(x1 - 0.1, z1, 0, ah - 0.3, 0.12, PAL.woodDark);
    if (rnd() < 0.6) b.box(rnd() * L * 0.6 - L * 0.3, 0.3, z1 - 0.2, 0.5, 2.0, 0.1, [PAL.cloth, PAL.red, PAL.blue][Math.floor(rnd() * 3)]);
    if (rnd() < 0.25) {   // tall banner pole
      const px = (rnd() < 0.5 ? -1 : 1) * (L / 2 + 0.6);
      b.pole(px, D / 2 + 0.5, 0, 8, 0.14, PAL.woodDark);
      b.quad([px, 7.6, D / 2 + 0.5], [px + 0.02, 7.6, D / 2 + 1.6], [px + 0.02, 4.4, D / 2 + 1.6], [px, 4.4, D / 2 + 0.5], rnd() < 0.5 ? PAL.cloth : PAL.clothBlue);
    }
  }
  return top;
}

// grand hall: marble terrace, red columns, double-eaved glazed hip roof
export function hall(b, { L, D, tiers = 1, roofCol = PAL.yellow, base = 1.4, rnd }) {
  b.box(0, -0.2, 0, L + 5, base + 0.2, D + 5, PAL.marble);
  for (let i = 0; i < 3; i++) b.box(0, -0.2 + i * base / 3, D / 2 + 2.5 + (3 - i) * 0.6, L * 0.3, base / 3, 1.2, PAL.marble); // steps
  const H = 5.2, y = base;
  b.box(0, y, 0, L - 1.6, H, D - 1.6, PAL.redWall);
  const bays = Math.max(3, Math.round(L / 4)), bw = L / bays;
  for (let i = 0; i <= bays; i++) for (const zz of [D / 2, -D / 2]) b.box(-L / 2 + i * bw, y, zz, 0.55, H, 0.55, PAL.red);
  for (let i = 0; i < bays; i++) b.quad([-L / 2 + i * bw + 0.5, y + 0.2, D / 2 - 0.78], [-L / 2 + (i + 1) * bw - 0.5, y + 0.2, D / 2 - 0.78],
    [-L / 2 + (i + 1) * bw - 0.5, y + H - 0.6, D / 2 - 0.78], [-L / 2 + i * bw + 0.5, y + H - 0.6, D / 2 - 0.78], PAL.lattice);
  b.box(0, y + H - 0.7, 0, L + 0.4, 0.7, D + 0.4, PAL.green, { top: false });   // painted bracket band
  let top = y + H;
  if (tiers > 1) {
    roofHip(b, { L, D, o: 2.0, y0: top, rise: D * 0.5, fMax: 0.42, up: 0.9, col: roofCol });
    const L2 = L * 0.78, D2 = D * 0.7;
    b.box(0, top + 0.8, 0, L2, 3.2, D2, PAL.red);
    b.box(0, top + 3.3, 0, L2 + 0.3, 0.7, D2 + 0.3, PAL.green, { top: false });
    top += 4.0;
    roofHip(b, { L: L2, D: D2, o: 2.0, y0: top, rise: D2 * 0.55, col: roofCol, ridgeK: 0.9, up: 1.0 });
  } else roofHip(b, { L, D, o: 2.0, y0: top, rise: D * 0.5, col: roofCol, ridgeK: 0.85, up: 1.0 });
}

export function pavilion(b, { s = 1, roofCol = PAL.roof, colCol = PAL.red, base = 0.6, sides = 4, water = false }) {
  const W = 5 * s, H = 3.4 * s;
  if (water) for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x * W * 0.45, -2.5, z * W * 0.45, 0.6, 2.5 + base, 0.6, PAL.stone);
  b.box(0, water ? base - 0.4 : -0.2, 0, W + 1.2, water ? 0.4 : base + 0.2, W + 1.2, PAL.marble);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x * W / 2, base, z * W / 2, 0.35 * s, H, 0.35 * s, colCol);
  // railing
  for (const [ax, az, bx, bz] of [[-1, 1, 1, 1], [1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1]])
    b.beam([ax * W / 2, base + 0.7, az * W / 2], [bx * W / 2, base + 0.7, bz * W / 2], 0.12, 0.12, PAL.timberRed);
  b.box(0, base + H - 0.4, 0, W + 0.4, 0.4, W + 0.4, PAL.green, { top: false });
  roofHip(b, { L: W, D: W, o: 1.4 * s, y0: base + H, rise: W * 0.65, col: roofCol, ridgeK: 1, up: 0.9 * s, finial: true });
}

// ---------------- boats ----------------
export function boat(b, type, rnd) {
  const spec = {
    junk: { L: 22, B: 5.2, H: 2.0 }, barge: { L: 18, B: 5, H: 1.8 }, sail: { L: 16, B: 4.2, H: 1.8 },
    ferry: { L: 10, B: 3, H: 1.1 }, sampan: { L: 7, B: 1.9, H: 0.8 }, dragon: { L: 20, B: 3.6, H: 1.4 },
  }[type] || { L: 10, B: 3, H: 1 };
  const { L, B, H } = spec, N = 10;
  const hullC = type === 'dragon' ? PAL.red : PAL.hull;
  const sec = t => {           // half-beam & sheer at station t in [0,1] (0 = stern, 1 = bow)
    const w = B / 2 * Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * t)), 0.55);
    const sheer = H + 0.9 * Math.pow(Math.abs(2 * t - 1), 2.2) * H;
    return [w, sheer];
  };
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, x0 = (t0 - 0.5) * L, x1 = (t1 - 0.5) * L;
    const [w0, s0] = sec(t0), [w1, s1] = sec(t1), k = -0.6;
    for (const sd of [1, -1]) {
      const A = [x0, k, sd * w0 * 0.55], Bp = [x1, k, sd * w1 * 0.55], Cp = [x1, s1 - 0.2, sd * w1], D = [x0, s0 - 0.2, sd * w0];
      if (sd > 0) b.quad(A, Bp, Cp, D, hullC); else b.quad(Bp, A, D, Cp, hullC);
      // gunwale
      b.beam([x0, s0 - 0.1, sd * w0], [x1, s1 - 0.1, sd * w1], 0.18, 0.22, PAL.hullDark);
    }
    b.quad([x0, k, -w0 * 0.55], [x1, k, -w1 * 0.55], [x1, k, w1 * 0.55], [x0, k, w0 * 0.55], PAL.hullDark);
    b.quad([x0, H * 0.75, -w0 * 0.92], [x0, H * 0.75, w0 * 0.92], [x1, H * 0.75, w1 * 0.92], [x1, H * 0.75, -w1 * 0.92], PAL.wood); // deck
  }
  if (type === 'junk' || type === 'barge' || type === 'sail') {
    // deck houses with arched mat roofs
    const n = type === 'junk' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const cx = (k - (n - 1) / 2) * L * 0.32 - L * 0.06, cl = L * 0.26, cw = B * 0.82;
      b.box(cx, H * 0.75, 0, cl, 1.7, cw, type === 'barge' ? PAL.redWall : PAL.wood);
      for (let j = 0; j < 6; j++) {
        const a0 = Math.PI * j / 6, a1 = Math.PI * (j + 1) / 6, r = cw / 2 + 0.15;
        const P = (x, a) => [x, H * 0.75 + 1.7 + Math.sin(a) * 0.8, Math.cos(a) * r];
        b.quad(P(cx - cl / 2 - 0.2, a0), P(cx + cl / 2 + 0.2, a0), P(cx + cl / 2 + 0.2, a1), P(cx - cl / 2 - 0.2, a1), type === 'barge' ? PAL.roof : PAL.mat);
      }
    }
    if (type !== 'barge') {
      const mx = L * 0.12, mh = type === 'sail' ? 13 : 15;
      b.box(mx, H * 0.75, 0, 0.35, mh, 0.35, PAL.woodDark);
      b.beam([mx, mh - 1, 0], [-L * 0.4, H + 1.2, 0], 0.06, 0.06, PAL.woodDark);          // stays
      b.beam([mx, mh - 1, 0], [L * 0.48, H + 1.4, 0], 0.06, 0.06, PAL.woodDark);
      if (type === 'sail') {   // battened mat sail
        for (let j = 0; j < 7; j++) {
          const y0 = 3 + j * 1.3, y1 = y0 + 1.3, xa = mx - 3.8 - j * 0.1, xb = mx + 1.2;
          b.quad([xa, y0, 0.1], [xb, y0, 0.1], [xb, y1, 0.1], [xa, y1, 0.1], PAL.sail);
          b.quad([xb, y0, -0.1], [xa, y0, -0.1], [xa, y1, -0.1], [xb, y1, -0.1], PAL.sail);
          b.box((xa + xb) / 2, y0, 0, xb - xa, 0.08, 0.25, PAL.woodDark);
        }
      }
    }
    b.beam([-L * 0.5, H * 1.3, 0], [-L * 0.62, -0.4, 0], 0.25, 0.25, PAL.woodDark);   // steering oar
  } else if (type === 'ferry') {
    for (let j = 0; j < 5; j++) {
      const a0 = Math.PI * j / 5, a1 = Math.PI * (j + 1) / 5, r = B / 2;
      const P = (x, a) => [x, H * 0.75 + 1.3 + Math.sin(a) * 0.7, Math.cos(a) * r];
      b.quad(P(-L * 0.25, a0), P(L * 0.15, a0), P(L * 0.15, a1), P(-L * 0.25, a1), PAL.mat);
    }
    for (const x of [-L * 0.25, L * 0.15]) for (const z of [-1, 1]) b.box(x, H * 0.75, z * B / 2 * 0.9, 0.12, 1.4, 0.12, PAL.woodDark);
  } else if (type === 'dragon') {
    pavilionOnBoat(b, L, B, H);
    b.box(L * 0.5, H, 0, 1.2, 2.2, 0.8, PAL.gold);                                  // dragon head
    b.box(L * 0.56, H + 1.5, 0, 1.4, 0.6, 0.6, PAL.gold);
  }
  return spec;
}
function pavilionOnBoat(b, L, B, H) {
  const y = H * 0.75, w = B * 0.8, l = L * 0.35;
  for (const x of [-l / 2, l / 2]) for (const z of [-w / 2, w / 2]) b.box(x, y, z, 0.25, 2.6, 0.25, PAL.red);
  roofHip(b, { L: l, D: w, o: 0.8, y0: y + 2.6, rise: 1.6, col: PAL.yellow, up: 0.5 });
}
