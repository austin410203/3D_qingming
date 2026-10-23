// world.js — the 3D city reconstructed from the annotated scroll: terrain + river, painted-silk ground,
// procedural architecture, bridges, walls, boats and painted trees.
import * as THREE from 'three';
import { STRIP_W, STRIP_H, PAINT_U0, PAINT_U1, MPX, U2X, X2U, V2Z, Z2V, P, WORLD_X1, Z_NEAR, Z_FAR,
  BLOCKS, LANDMARKS, CITY_WALL, PALACE_WALL, BOATS, BOAT_ROUTES, PATHS } from './layout.js';
import { sampleMask, MW, MH } from './maps.js';
import { Batch, PAL, house, hall, pavilion, roofHip, roofGable, boat } from './arch.js';
import { SpriteLayer } from './sprites.js';

export const SILK = new THREE.Color('#e3d3a9');
const WATER_Y = -0.35;

function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 4294967296); }
function inPoly(pts, u, v) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ui, vi] = pts[i], [uj, vj] = pts[j];
    if ((vi > v) !== (vj > v) && u < (uj - ui) * (v - vi) / (vj - vi) + ui) c = !c;
  }
  return c;
}
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

// shared GLSL: world (x,z) -> strip (u,v) using the same mapping as layout.js
const MAP_GLSL = `
  const float MPX = ${MPX.toFixed(6)}, U0 = ${PAINT_U0.toFixed(1)}, SW = ${STRIP_W.toFixed(1)}, SH = ${STRIP_H.toFixed(1)};
  vec2 worldToStrip(vec2 xz){ float u = xz.x / MPX + U0; float v = (1.0 - log(max(0.05, 1.0 + 2.4 * (28.0 - xz.y) / 72.0)) / 2.4) * SH; return vec2(u, v); }
  vec2 stripUV(vec2 uv){ return vec2(uv.x / SW, uv.y / SH); }
  float hashp(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noisep(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 w = f*f*(3.0-2.0*f);
    return mix(mix(hashp(i), hashp(i+vec2(1,0)), w.x), mix(hashp(i+vec2(0,1)), hashp(i+vec2(1,1)), w.x), w.y); }
`;

export class World {
  constructor(maps, maskTex, trees, figures) {
    this.maps = maps; this.maskTex = maskTex;
    this.scene = new THREE.Scene();
    this.scene.background = SILK.clone();
    this.scene.fog = new THREE.Fog(SILK.clone(), 160, 900);
    this.decks = [];             // { fn(x,z) -> y | null }
    this.extraTrees = [];        // courtyard / farmyard trees [x, z]
    this.colliders = [];         // building footprints for free walking: [x, z, hx, hz, c, s]
    this.r = rng(1736);
    this.groundTex = null;
    this.uTime = { value: 0 };
    this.trees = trees; this.figures = figures;
  }

  async build(onProgress = () => {}) {
    const hemi = new THREE.HemisphereLight(0xfff6e2, 0xa8956c, 1.35);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.0); sun.position.set(-0.6, 1, 0.8);
    this.scene.add(hemi, sun);
    this.sun = sun;
    await this.loadGround();
    this.buildTerrain(); onProgress(0.15);
    this.buildWater(); this.buildSky();
    this.bmat = this.buildingMaterial();
    this.chunks = new Map();
    this.buildLandmarks(); onProgress(0.35);
    this.buildWalls(); onProgress(0.4);
    this.buildBlocks(); onProgress(0.6);
    this.buildStalls();
    this.flushChunks();
    this.buildBoats(); onProgress(0.7);
    this.buildTrees(); onProgress(0.85);
  }

  // ---------------- ground: the painting itself, blurred, under procedural silk ----------------
  async loadGround() {
    const tex = await new THREE.TextureLoader().loadAsync('assets/scroll/overview.webp');
    tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 8;
    this.groundTex = tex;
  }

  heightRaw(u, v) {
    const w = sampleMask(this.maps.waterSoft, u, v), hill = sampleMask(this.maps.hill, u, v);
    const x = U2X(u), z = V2Z(v);
    let h = 0.55 + (1 - w) * (vnoise(x * 0.03, z * 0.03) - 0.5) * 1.2 * (1 - sampleMask(this.maps.road, u, v));
    h = h * (1 - smooth(0.2, 0.62, w)) + (-2.6) * smooth(0.2, 0.62, w);
    return h + hill * (0.85 + 0.3 * vnoise(x * 0.08, z * 0.08));
  }

  buildTerrain() {
    // grid in painting space so detail follows the painting (fine near, coarse far)
    const du = 36, dv = 5;
    const u0 = 0, u1 = STRIP_W, v0 = -60, v1 = STRIP_H + 60;
    const nu = Math.ceil((u1 - u0) / du) + 1, nv = Math.ceil((v1 - v0) / dv) + 1;
    this.tgrid = { u0, v0, du, dv, nu, nv, h: new Float32Array(nu * nv) };
    const pos = new Float32Array(nu * nv * 3), uvs = new Float32Array(nu * nv * 2);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = u0 + i * du, v = v0 + j * dv, k = j * nu + i;
      let h = this.heightRaw(Math.min(PAINT_U1, Math.max(PAINT_U0, u)), Math.max(0, Math.min(STRIP_H, v)));
      if (u < PAINT_U0 || u > PAINT_U1) h = Math.max(h, 0.5);
      this.tgrid.h[k] = h;
      pos[k * 3] = U2X(u); pos[k * 3 + 1] = h; pos[k * 3 + 2] = V2Z(v);
      uvs[k * 2] = u; uvs[k * 2 + 1] = v;
    }
    const idx = [];
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aStrip', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uPaint = { value: this.groundTex }; sh.uniforms.uMask = { value: this.maskTex };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aStrip; varying vec2 vStrip; varying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStrip = aStrip; vWP = (modelMatrix * vec4(position,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D uPaint, uMask; varying vec2 vStrip; varying vec3 vWP;\n${MAP_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 st = stripUV(vStrip);
          vec4 m = texture2D(uMask, st);
          vec3 paint = texture2D(uPaint, vec2(st.x, 1.0 - st.y), 1.5).rgb;
          vec3 earth = vec3(0.80, 0.70, 0.50), grass = vec3(0.60, 0.62, 0.40), road = vec3(0.86, 0.77, 0.58);
          float n = noisep(vWP.xz * 0.15) * 0.6 + noisep(vWP.xz * 0.6) * 0.4;
          vec3 base = mix(earth, grass, smoothstep(0.35, 0.75, noisep(vWP.xz * 0.02)) * 0.7);
          base = mix(base, road, m.g);
          vec3 fieldC = mix(vec3(0.55, 0.62, 0.40), vec3(0.47, 0.56, 0.42), step(0.5, fract(vWP.x * 0.12)));
          base = mix(base, fieldC, m.b * (0.7 + 0.3 * step(0.06, fract(vWP.z * 0.08))));
          // painting colour carries the scroll's palette & layout; keep it soft
          float pl = dot(paint, vec3(0.333));
          vec3 col = mix(base, paint * 1.3, 0.45 * (1.0 - m.g * 0.6));
          col *= 0.93 + n * 0.14;
          col = mix(col, vec3(0.62, 0.66, 0.60), smoothstep(0.35, 0.7, m.r) * 0.7);  // wet bank / river bed
          col = mix(col, vec3(0.55, 0.62, 0.55), m.a * 0.5);                       // hills greener
          diffuseColor.rgb = col;
        }`);
    };
    this.terrain = new THREE.Mesh(g, mat);
    this.terrain.receiveShadow = false;
    this.scene.add(this.terrain);
    // far ground beyond the scroll (mist plain)
    const far = new THREE.Mesh(new THREE.PlaneGeometry(8000, 5000), new THREE.MeshLambertMaterial({ color: 0xcdb98c }));
    far.rotation.x = -Math.PI / 2; far.position.set(WORLD_X1 / 2, -0.9, -500); this.scene.add(far);
  }

  terrainAt(x, z) {
    const g = this.tgrid; if (!g) return 0;
    const u = X2U(x), v = Z2V(z);
    const fi = (u - g.u0) / g.du, fj = (v - g.v0) / g.dv;
    const i = Math.max(0, Math.min(g.nu - 2, Math.floor(fi))), j = Math.max(0, Math.min(g.nv - 2, Math.floor(fj)));
    const a = Math.min(1, Math.max(0, fi - i)), b = Math.min(1, Math.max(0, fj - j)), k = j * g.nu + i;
    // triangle-consistent bilinear is close enough at this resolution
    return (g.h[k] * (1 - a) + g.h[k + 1] * a) * (1 - b) + (g.h[k + g.nu] * (1 - a) + g.h[k + g.nu + 1] * a) * b;
  }
  heightAt(x, z) {
    let h = this.terrainAt(x, z);
    for (const d of this.decks) { const y = d(x, z); if (y != null && y > h) h = y; }
    return h;
  }
  isWater(x, z) { return sampleMask(this.maps.water, X2U(x), Z2V(z)) > 0.5; }

  // ---------------- water ----------------
  buildWater() {
    const g = new THREE.PlaneGeometry(WORLD_X1 + 400, Z_NEAR - Z_FAR + 200, 1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, uTime: this.uTime, uMask: { value: this.maskTex }, uPaint: { value: this.groundTex } },
      vertexShader: `varying vec3 vWP; #include <fog_pars_vertex>
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWP = wp.xyz; vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(/#include <(\w+)>/g, '\n#include <$1>\n'),
      fragmentShader: `uniform float uTime; uniform sampler2D uMask, uPaint; varying vec3 vWP;
        #include <fog_pars_fragment>
        ${MAP_GLSL}
        void main(){
          vec2 st = stripUV(worldToStrip(vWP.xz));
          float w = texture2D(uMask, st).r;
          vec3 base = vec3(0.40, 0.40, 0.31);
          // fine ink ripple strokes like the scroll's water: long thin wavy lines
          float y = vWP.z * 2.2 + sin(vWP.x * 0.21 + uTime * 0.6) * 0.9 + sin(vWP.x * 0.047 - uTime * 0.25) * 2.0;
          float line = smoothstep(0.86, 1.0, sin(y) * 0.5 + 0.5) * (0.55 + 0.45 * noisep(vWP.xz * vec2(0.05, 0.4) + uTime * 0.05));
          float glint = smoothstep(0.92, 1.0, noisep(vWP.xz * vec2(0.08, 0.9) + vec2(uTime * 0.3, 0.0)));
          vec3 col = base * (1.0 - line * 0.22) + glint * 0.05;
          col *= 0.96 + 0.08 * noisep(vWP.xz * 0.03);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      fog: true,
    });
    this.water = new THREE.Mesh(g, mat);
    this.water.position.set(WORLD_X1 / 2, WATER_Y, (Z_NEAR + Z_FAR) / 2 - 100);
    this.water.layers.set(2);            // excluded from the outline normal pass
    this.scene.add(this.water);
  }

  buildSky() {
    // silk sky dome: warm haze at the horizon, paler above
    const g = new THREE.SphereGeometry(2400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; void main(){ float h = clamp(vD.y, 0.0, 1.0);
        vec3 c = mix(vec3(0.89,0.83,0.66), vec3(0.93,0.89,0.77), smoothstep(0.0, 0.5, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(g, mat);
    this.sky.layers.set(2);
    this.scene.add(this.sky);
    // distant hills: layered ink silhouettes
    const hb = new Batch();
    const r = rng(7);
    for (let k = 0; k < 3; k++) {
      const z = Z_FAR - 220 - k * 160, col = [[0.70, 0.71, 0.62], [0.74, 0.74, 0.64], [0.79, 0.77, 0.66]][k];
      let prev = null;
      for (let x = -500; x <= WORLD_X1 + 500; x += 40) {
        const h = 25 + 55 * Math.pow(vnoise(x * 0.004 + k * 10, k), 2) + 20 * vnoise(x * 0.02, k * 3) + r() * 4;
        if (prev) hb.quad([prev[0], -1, z], [x, -1, z], [x, h, z], [prev[0], prev[1], z], col);
        prev = [x, h];
      }
    }
    this.hills = new THREE.Mesh(hb.toGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    this.hills.layers.set(2);
    this.scene.add(this.hills);
  }

  // ---------------- building material: lambert + tile stripes ----------------
  buildingMaterial() {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aTex; varying vec2 vTex;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTex = aTex;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTex;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vTex.y > 0.5 && vTex.y < 1.5) {           // roof tiles: grooves running down the slope
            float g = abs(fract(vTex.x / 0.42) - 0.5);
            diffuseColor.rgb *= 0.80 + 0.22 * smoothstep(0.08, 0.22, g);
          }`);
    };
    return m;
  }

  chunk(x) {
    const k = Math.floor(x / 120);
    if (!this.chunks.has(k)) this.chunks.set(k, new Batch());
    return this.chunks.get(k);
  }
  flushChunks() {
    this.buildingMeshes = [];
    for (const [k, b] of this.chunks) {
      if (!b.pos.length) continue;
      const mesh = new THREE.Mesh(b.toGeometry(), this.bmat);
      this.scene.add(mesh); this.buildingMeshes.push(mesh);
    }
    this.chunks.clear();
  }

  // ---------------- blocks of houses / shops ----------------
  buildBlocks() {
    const r = this.r, occ = new Set();
    const cell = (x, z) => `${Math.round(x)},${Math.round(z)}`;
    const free = (x, z, hx, hz) => {
      for (let a = -hx; a <= hx; a += 1) for (let c = -hz; c <= hz; c += 1) if (occ.has(cell(x + a, z + c))) return false;
      return true;
    };
    const mark = (x, z, hx, hz) => { for (let a = -hx; a <= hx; a += 1) for (let c = -hz; c <= hz; c += 1) occ.add(cell(x + a, z + c)); };
    // keep landmarks clear
    for (const l of LANDMARKS) if (l.at) { const [x, z] = P(...l.at); mark(x, z, (l.w || 14) / 2 + 4, (l.d || 14) / 2 + 4); }
    let count = 0;
    for (const [poly, style, dens, facing] of BLOCKS) {
      const us = poly.map(p => p[0]), vs = poly.map(p => p[1]);
      const xmin = U2X(Math.min(...us)), xmax = U2X(Math.max(...us));
      const zmin = V2Z(Math.min(...vs)), zmax = V2Z(Math.max(...vs));   // note: smaller v = farther = smaller z
      const front = facing === 'n' ? -1 : 1;
      // rows from the front edge inward
      let zc = front > 0 ? zmax : zmin;
      const zEnd = front > 0 ? zmin : zmax;
      let row = 0;
      while (front > 0 ? zc > zEnd : zc < zEnd) {
        const deep = row > 0;
        const kind = style === 'village' ? 'farm' : style === 'shop' && !deep ? 'shop' : 'compound';
        const D = kind === 'shop' ? 7 + r() * 3 : kind === 'farm' ? 14 + r() * 8 : 15 + r() * 9;
        const rowZ = zc - front * (D / 2 + 0.8);
        let x = xmin + r() * 3;
        while (x < xmax) {
          const L = kind === 'shop' ? 6.5 + r() * 5 : kind === 'farm' ? 14 + r() * 10 : 14 + r() * 12;
          const gap = kind === 'farm' ? 6 + r() * 16 : kind === 'shop' ? 0.4 + r() * 1.2 : 0.4 + r() * 2.2;
          const cx = x + L / 2, cz = rowZ + (r() - 0.5) * (kind === 'farm' ? 6 : 0.8);
          x += L + gap;
          if (r() > Math.min(1, dens * 1.15)) continue;
          const u = X2U(cx), v = Z2V(cz);
          if (!inPoly(poly, u, v)) continue;
          // footprint corners must be dry and off the main roads
          let ok = true;
          for (const [ax, az] of [[-L / 2, -D / 2], [L / 2, -D / 2], [-L / 2, D / 2], [L / 2, D / 2], [0, 0]]) {
            const uu = X2U(cx + ax), vv = Z2V(cz + az);
            if (sampleMask(this.maps.water, uu, vv) > 0.3 || sampleMask(this.maps.road, uu, vv) > 0.35) { ok = false; break; }
          }
          if (!ok || !free(cx, cz, L / 2 + 0.3, D / 2 + 0.3)) continue;
          mark(cx, cz, L / 2 + 0.3, D / 2 + 0.3);
          const ry = (front > 0 ? 0 : Math.PI) + (r() - 0.5) * (style === 'village' ? 0.4 : 0.04);
          if (kind === 'compound') this.compound(cx, cz, ry, L, D, r);
          else if (kind === 'farm') this.farmstead(cx, cz, ry, L, D, r);
          else {
            const y = this.terrainAt(cx, cz), b = this.chunk(cx);
            b.setFrame(cx, y, cz, ry);
            const stories = r() < 0.3 ? 2 : 1;
            house(b, { L, D, stories, style: 'shop', rnd: r });
            if (stories === 2 && r() < 0.45) this.caiLou(b, L, D, r);
            this.colliders.push([cx, cz, L / 2 + 0.4, D / 2 + 0.4, Math.cos(ry), Math.sin(ry)]);
          }
          count++;
        }
        zc -= front * (D + (kind === 'farm' ? 8 + r() * 10 : 0.8 + r() * 2));
        row++;
      }
    }
    this.buildingCount = count;
  }

  // street stalls under big cloth parasols (傘攤), tables of goods, laid along both kerbs of busy streets
  buildStalls() {
    const r = rng(5);
    const cloths = [PAL.cloth, PAL.awning, PAL.awning2, PAL.mat];
    const goods = [PAL.clothRed, PAL.clothBlue, PAL.green, PAL.yellow, PAL.wood, PAL.cloth];
    for (const [pts, wm, dens, kind] of PATHS) {
      if (kind !== 'street' && kind !== 'road' && kind !== 'quay') continue;
      const P3 = pts.map(([u, v]) => P(u, v));
      for (let i = 1; i < P3.length; i++) {
        const [ax, az] = P3[i - 1], [bx, bz] = P3[i], L = Math.hypot(bx - ax, bz - az);
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        for (let d = 4; d < L - 4; d += 5 + r() * 6) {
          if (r() > (kind === 'street' ? 0.8 : 0.2)) continue;
          const side = r() < 0.5 ? -1 : 1, off = side * (wm / 2 - 1.2 + r() * (kind === 'street' ? 6 : 1));
          const x = ax + tx * d - tz * off, z = az + tz * d + tx * off;
          if (this.isWater(x, z) || this.nearCollider(x, z, 1.2)) continue;
          const y = this.terrainAt(x, z), b = this.chunk(x);
          b.setFrame(x, y, z, Math.atan2(-tz, tx));
          // table with goods
          b.box(0, 0, 0, 2.2, 0.85, 1.1, PAL.wood);
          for (let k = 0; k < 4; k++) b.box(-0.8 + k * 0.53, 0.85, (r() - 0.5) * 0.4, 0.4, 0.15 + r() * 0.3, 0.35, goods[Math.floor(r() * goods.length)]);
          if (r() < 0.8) {   // parasol: pole + 12-gore cone
            const R = 1.9 + r() * 0.6, H = 3.0 + r() * 0.5, col = cloths[Math.floor(r() * cloths.length)];
            b.box(0.5, 0, 0.6, 0.08, H, 0.08, PAL.woodDark);
            for (let k = 0; k < 12; k++) {
              const a0 = k / 12 * Math.PI * 2, a1 = (k + 1) / 12 * Math.PI * 2;
              b.tri([0.5 + Math.cos(a0) * R, H - 0.55, 0.6 + Math.sin(a0) * R], [0.5, H + 0.25, 0.6], [0.5 + Math.cos(a1) * R, H - 0.55, 0.6 + Math.sin(a1) * R], k % 2 ? col : col.map(c => c * 0.9));
            }
          }
          this.colliders.push([x, z, 1.3, 0.8, Math.cos(Math.atan2(-tz, tx)), Math.sin(Math.atan2(-tz, tx))]);
        }
      }
    }
  }

  // 四合院-style compound: perimeter wall + gatehouse, main hall at the back, wings facing the yard, a yard tree
  compound(cx, cz, ry, W, D, r) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const put = (lx, lz, lry, fn) => {
      const [x, z] = at(lx, lz), b = this.chunk(x);
      b.setFrame(x, this.terrainAt(x, z), z, ry + lry); fn(b);
    };
    const wallC = r() < 0.75 ? PAL.plaster : PAL.plasterGrey, H = 2.3;
    const seg = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.5) return;
      const a = Math.atan2(-(z1 - z0), x1 - x0);
      put((x0 + x1) / 2, (z0 + z1) / 2, a, b => {
        b.box(0, -0.2, 0, L, H + 0.2, 0.5, wallC);
        b.box(0, H, 0, L + 0.1, 0.25, 0.9, PAL.roof2);
      });
      const [wx, wz] = at((x0 + x1) / 2, (z0 + z1) / 2);
      this.colliders.push([wx, wz, L / 2, 0.45, Math.cos(ry + a), Math.sin(ry + a)]);
    };
    const hw = W / 2, hd = D / 2, g = 1.6;
    seg(-hw, hd, -g, hd); seg(g, hd, hw, hd); seg(-hw, -hd, hw, -hd); seg(-hw, -hd, -hw, hd); seg(hw, -hd, hw, hd);
    put(0, hd, 0, b => {
      for (const x of [-g, g]) b.box(x, -0.2, 0, 0.5, 3.0, 1.2, PAL.timberRed);
      b.quad([-g, 0, -0.3], [g, 0, -0.3], [g, 2.6, -0.3], [-g, 2.6, -0.3], PAL.interior);
      roofGable(b, { L: 2 * g + 0.6, D: 2.2, o: 0.5, ox: 0.3, y0: 2.9, rise: 1.0, col: PAL.roof2, wallCol: wallC });
    });
    const mL = Math.min(W - 3, 9 + r() * 6), mD = Math.min(7.5, D * 0.35);
    put(0, -hd + mD / 2 + 0.6, 0, b => house(b, { L: mL, D: mD, stories: r() < 0.15 ? 2 : 1, style: 'urban', rnd: r }));
    const wL = Math.min(D - mD - 5, 6 + r() * 5), wD = Math.min(5.5, W * 0.22);
    if (wL > 3 && W > 14) {
      put(-hw + wD / 2 + 0.5, 0.8, Math.PI / 2, b => house(b, { L: wL, D: wD, style: 'urban', rnd: r }));
      if (r() < 0.8) put(hw - wD / 2 - 0.5, 0.8, -Math.PI / 2, b => house(b, { L: wL, D: wD, style: 'urban', rnd: r }));
    }
    const [mx, mz] = at(0, -hd + mD / 2 + 0.6);
    this.colliders.push([mx, mz, mL / 2 + 0.4, mD / 2 + 0.4, c, s]);
    if (r() < 0.7) { const [tx, tz] = at((r() - 0.5) * W * 0.3, hd * 0.35); this.extraTrees.push([tx, tz]); }
  }

  // farmstead: bamboo fence, a house (thatch or tile), a haystack
  farmstead(cx, cz, ry, W, D, r) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const b = this.chunk(cx);
    b.setFrame(cx, this.terrainAt(cx, cz), cz, ry);
    const hw = W / 2, hd = D / 2;
    const fence = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.6));
      for (let i = 0; i <= n; i++) b.box(ax + (bx - ax) * i / n, -0.1, az + (bz - az) * i / n, 0.12, 1.3, 0.12, PAL.woodDark);
      for (const y of [0.45, 1.0]) b.beam([ax, y, az], [bx, y, bz], 0.07, 0.07, PAL.wood);
    };
    fence(-hw, hd, -1.5, hd); fence(1.5, hd, hw, hd); fence(-hw, -hd, hw, -hd); fence(-hw, -hd, -hw, hd); fence(hw, -hd, hw, hd);
    const hL = Math.min(W - 3, 7 + r() * 4), hD = 5.5 + r() * 1.5;
    const [hx, hz] = at(0, -hd + hD / 2 + 0.8);
    b.setFrame(hx, this.terrainAt(hx, hz), hz, ry);
    house(b, { L: hL, D: hD, style: r() < 0.55 ? 'thatch' : 'village', rnd: r });
    this.colliders.push([hx, hz, hL / 2 + 0.4, hD / 2 + 0.4, c, s]);
    if (r() < 0.6) {
      const [sx, sz] = at(hw * 0.5, hd * 0.3);
      b.setFrame(sx, this.terrainAt(sx, sz), sz, 0);
      for (let i = 0; i < 8; i++) {
        const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2, R = 1.6;
        b.tri([Math.cos(a0) * R, 0, Math.sin(a0) * R], [0, 3.2, 0], [Math.cos(a1) * R, 0, Math.sin(a1) * R], PAL.thatch);
      }
    }
    if (r() < 0.8) { const [tx, tz] = at(-hw * 0.6, hd * 0.2); this.extraTrees.push([tx, tz]); }
  }

  // 彩樓歡門: festive pole scaffold with ribbons in front of a tavern (as in the scroll)
  caiLou(b, L, D, r) {
    const z = D / 2 + 3.4, H = 9.5, cols = [PAL.clothRed, PAL.clothBlue, PAL.cloth, PAL.green];
    for (const x of [-L / 2, -L / 6, L / 6, L / 2]) b.box(x, 0, z, 0.16, H, 0.16, PAL.woodDark);
    b.beam([-L / 2, H, z], [0, H + 2.2, z], 0.14, 0.14, PAL.woodDark); b.beam([0, H + 2.2, z], [L / 2, H, z], 0.14, 0.14, PAL.woodDark);
    for (const y of [4.2, 6.6, 8.6]) b.box(0, y, z, L, 0.14, 0.14, PAL.woodDark);
    for (let i = 0; i < 6; i++) {
      const x = -L / 2 + (i + 0.5) * L / 6, y = 6.6, cl = cols[i % 4];
      b.quad([x - 0.4, y, z + 0.05], [x + 0.4, y, z + 0.05], [x + 0.25, y - 1.6, z + 0.05], [x - 0.25, y - 1.6, z + 0.05], cl);
    }
  }

  // ---------------- walls ----------------
  buildWalls() {
    const wall = (W, palace) => {
      const pts = W.pts.map(([u, v]) => P(u, v));
      const [gx, gz] = P(...W.gate);
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 6);
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n;
          const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
          const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
          const gateD = Math.hypot(mx - gx, mz - gz);
          if (gateD < (palace ? 5 : 7)) continue;                   // gate opening
          if (this.isWater(mx, mz) && !palace) continue;
          const b = this.chunk(mx), seg = L / n, ry = Math.atan2(-(z1 - z0), x1 - x0);
          const y = Math.min(this.terrainAt(mx, mz), 0.5) - 1;
          b.setFrame(mx, y, mz, ry);
          if (palace) {
            b.box(0, 0, 0, seg + 0.05, W.h + 1, W.w, PAL.redWall);
            roofGable(b, { L: seg, D: W.w, o: 0.5, ox: 0.02, y0: W.h + 1, rise: 0.8, col: PAL.yellow, wallCol: PAL.redWall });
          } else {
            b.box(0, 0, 0, seg + 0.05, W.h + 1, W.w, PAL.brick, { ty: 2 });
            for (const s of [-1, 1]) for (let m = 0; m < 3; m++) {        // crenellations
              b.box(-seg / 2 + (m + 0.5) * seg / 3, W.h + 1, s * (W.w / 2 - 0.3), seg / 3 * 0.55, 1.1, 0.6, PAL.brickDark);
            }
          }
          this.colliders.push([mx, mz, seg / 2 + 0.2, W.w / 2 + 0.3, Math.cos(ry), Math.sin(ry)]);
        }
      }
      return pts;
    };
    wall(CITY_WALL, false);
    wall(PALACE_WALL, true);
    // walkway on top of the city wall is not modelled; gate passage gets a tower (see landmarks)
  }

  // ---------------- landmarks ----------------
  buildLandmarks() {
    const r = this.r;
    for (const l of [...LANDMARKS].sort((a, b) => (b.t === 'terrace') - (a.t === 'terrace'))) {
      switch (l.t) {
        case 'archBridge': this.archBridge(l); break;
        case 'humpBridge': this.humpBridge(l); break;
        case 'woodBridge': this.woodBridge(l); break;
        case 'corridor': this.corridorBridge(l); break;
        case 'gateTower': this.gateTower(l); break;
        case 'pailou': this.pailou(l); break;
        case 'stage': this.stage(l); break;
        case 'temple': this.temple(l); break;
        case 'pavilion': {
          const [x, z] = P(...l.at), b = this.chunk(x);
          const y = l.water ? WATER_Y : this.terrainAt(x, z);
          b.setFrame(x, y, z, 0);
          pavilion(b, { s: l.s, water: l.water, roofCol: l.palace ? (r() < 0.5 ? PAL.yellow : PAL.green) : PAL.roof, colCol: PAL.red });
          if (l.water) this.decks.push((px, pz) => Math.abs(px - x) < 3.6 * l.s && Math.abs(pz - z) < 3.6 * l.s ? y + 0.6 : null);
          break;
        }
        case 'palaceHall': {
          const [x, z] = P(...l.at), b = this.chunk(x);
          b.setFrame(x, this.terrainAt(x, z) + (this.terraceAt(x, z) || 0), z, 0);
          hall(b, { L: l.w, D: l.d, tiers: l.tiers, roofCol: r() < 0.65 ? PAL.yellow : PAL.green, rnd: r });
          this.colliders.push([x, z, l.w / 2 + 2, l.d / 2 + 2, 1, 0]);
          break;
        }
        case 'tower': {
          const [x, z] = P(...l.at), b = this.chunk(x);
          let y = this.terrainAt(x, z);
          b.setFrame(x, y, z, 0);
          b.box(0, -1, 0, l.w + 2, 7, l.w + 2, PAL.marble);
          let w = l.w, yy = 6;
          for (let f = 0; f < l.floors; f++) {
            b.box(0, yy, 0, w, 4.2, w, f % 2 ? PAL.red : PAL.plaster);
            roofHip(b, { L: w, D: w, o: 1.6, y0: yy + 4.2, rise: f === l.floors - 1 ? w * 0.6 : 1.8, fMax: f === l.floors - 1 ? 1 : 0.45, up: 0.8, col: PAL.yellow, finial: f === l.floors - 1 });
            yy += 5.2; w *= 0.8;
          }
          break;
        }
        case 'terrace': {
          const [x, z] = P(...l.at), b = this.chunk(x);
          b.setFrame(x, this.terrainAt(x, z) - 1, z, 0);
          b.box(0, 0, 0, l.w, l.h + 1, l.d, PAL.marble);
          for (let i = 0; i < l.w / 2.5; i++) for (const s of [-1, 1]) b.box(-l.w / 2 + i * 2.5, l.h + 1, s * l.d / 2, 0.25, 0.9, 0.25, PAL.marble);
          this.terraces = this.terraces || [];
          this.terraces.push([x, z, l.w / 2, l.d / 2, l.h]);
          const th = this.terrainAt(x, z) + l.h;
          this.decks.push((px, pz) => Math.abs(px - x) < l.w / 2 && Math.abs(pz - z) < l.d / 2 ? th : null);
          break;
        }
        case 'dock': {
          const [ax, az] = P(...l.a), [bx, bz] = P(...l.b), b = this.chunk((ax + bx) / 2);
          b.setFrame((ax + bx) / 2, 0, (az + bz) / 2, 0);
          const L = Math.abs(bx - ax), D = Math.abs(bz - az);
          b.box(0, -2.5, 0, L, 3.0, D, l.stone ? PAL.stone : PAL.wood);
          if (!l.stone) for (let i = 0; i < 8; i++) b.box(-L / 2 + i * L / 7, -2.5, D / 2, 0.3, 3.5, 0.3, PAL.woodDark);
          const top = 0.5;
          this.decks.push((px, pz) => Math.abs(px - (ax + bx) / 2) < L / 2 && Math.abs(pz - (az + bz) / 2) < D / 2 ? top : null);
          break;
        }
        case 'rafts': {
          const [ax, az] = P(...l.a), [bx, bz] = P(...l.b);
          for (let k = 0; k < 4; k++) {
            const x = ax + (bx - ax) * (k + 0.5) / 4 + (r() - 0.5) * 6, z = az + (bz - az) * (k + 0.5) / 4, b = this.chunk(x);
            b.setFrame(x, WATER_Y, z, (r() - 0.5) * 0.3);
            for (let i = 0; i < 14; i++) b.box(-6 + i * 0.9, -0.3, 0, 0.8, 0.45, 8, PAL.wood);
            if (r() < 0.6) { b.box(0, 0.15, 0, 3, 1.2, 2.5, PAL.mat); }
          }
          break;
        }
      }
    }
  }
  terraceAt(x, z) {
    for (const t of this.terraces || []) if (Math.abs(x - t[0]) < t[2] && Math.abs(z - t[1]) < t[3]) return t[4];
    return 0;
  }

  // the Qing court rainbow bridge: a great stone arch with shop stalls lining the deck
  archBridge(l) {
    const [ax, az] = P(...l.a), [bx, bz] = P(...l.b);
    const L = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, W = l.w, rise = l.rise;
    const b = this.chunk(cx);
    b.setFrame(cx, 0, cz, ry);
    const deck = t => 0.5 + rise * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.75);
    const N = 40;
    // side walls with the arch opening (span = middle 45%)
    const span = 0.45, archR = L * span / 2;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N, x0 = (t0 - 0.5) * L, x1 = (t1 - 0.5) * L;
      const y0 = deck(t0), y1 = deck(t1);
      const bot = x => { const d = Math.abs(x); return d < archR ? -2.6 + Math.sqrt(Math.max(0, archR * archR - d * d)) * (rise * 0.75 / archR) : -2.6; };
      for (const s of [-1, 1]) {
        const z = s * W / 2;
        const q = [[x0, bot(x0), z], [x1, bot(x1), z], [x1, y1, z], [x0, y0, z]];
        if (s > 0) b.quad(...q, PAL.stone, 0, 2); else b.quad(q[1], q[0], q[3], q[2], PAL.stone, 0, 2);
        // parapet
        b.beam([x0, y0 + 0.55, z], [x1, y1 + 0.55, z], 0.35, 1.1, PAL.stoneDark);
      }
      // deck and arch soffit
      b.quad([x0, y0, W / 2], [x1, y1, W / 2], [x1, y1, -W / 2], [x0, y0, -W / 2], PAL.stone);
      const s0 = bot(x0), s1 = bot(x1);
      if (s0 > -2.5 || s1 > -2.5) b.quad([x0, s0, -W / 2], [x1, s1, -W / 2], [x1, s1, W / 2], [x0, s0, W / 2], PAL.stoneDark);
    }
    // shop sheds lining both sides of the deck, as painted: continuous roofs on posts following the climb
    for (const s of [-1, 1]) {
      const M = 30;
      for (let k = 0; k < M; k++) {
        const t0 = 0.06 + 0.88 * k / M, t1 = 0.06 + 0.88 * (k + 1) / M;
        if (t0 > 0.44 && t1 < 0.56) continue;                       // open crown of the arch
        const x0 = (t0 - 0.5) * L, x1 = (t1 - 0.5) * L, y0 = deck(t0), y1 = deck(t1);
        const zi = s * (W / 2 - 2.4), zo = s * (W / 2 + 0.3);
        const col = k % 5 === 0 ? PAL.mat : PAL.roof;
        const A = [x0, y0 + 2.9, zo], B = [x1, y1 + 2.9, zo], Cc = [x1, y1 + 2.3, zi], D = [x0, y0 + 2.3, zi];
        if (s > 0) b.quad(D, Cc, B, A, col, 0, 1); else b.quad(A, B, Cc, D, col, 0, 1);
        b.box((x0 + x1) / 2, (y0 + y1) / 2, s * (W / 2 - 0.25), x1 - x0, 2.4, 0.3, k % 2 ? PAL.wood : PAL.plaster2);   // back wall of the shed
        b.box(x0, y0, zi, 0.18, 2.3, 0.18, PAL.woodDark);                                                         // post
        if (k % 2 === 0) b.box((x0 + x1) / 2, y0 + 0.1 * (y1 - y0), s * (W / 2 - 1.2), (x1 - x0) * 0.7, 0.85, 1.0, PAL.wood);  // stall counter
      }
    }
    // walkable deck: project onto the axis
    const ux = Math.cos(ry), uz = -Math.sin(ry);
    this.decks.push((px, pz) => {
      const dx = px - cx, dz = pz - cz, along = dx * ux + dz * uz, across = -dx * uz + dz * ux;
      if (Math.abs(along) > L / 2 || Math.abs(across) > W / 2) return null;
      return deck(along / L + 0.5);
    });
    this.colliders.push(null);
  }

  humpBridge(l) {
    const [ax, az] = P(...l.a), [bx, bz] = P(...l.b);
    const L = Math.hypot(bx - ax, bz - az) + 4, ry = Math.atan2(-(bz - az), bx - ax), cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const b = this.chunk(cx); b.setFrame(cx, 0, cz, ry);
    const deck = t => 0.5 + l.rise * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.8);
    const N = 20, W = l.w, R = L * 0.28;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N, x0 = (t0 - 0.5) * L, x1 = (t1 - 0.5) * L;
      const bot = x => Math.abs(x) < R ? -2.6 + Math.sqrt(R * R - x * x) * 1.1 : -2.6;
      for (const s of [-1, 1]) {
        const q = [[x0, bot(x0), s * W / 2], [x1, bot(x1), s * W / 2], [x1, deck(t1), s * W / 2], [x0, deck(t0), s * W / 2]];
        if (s > 0) b.quad(...q, PAL.stone); else b.quad(q[1], q[0], q[3], q[2], PAL.stone);
        b.beam([x0, deck(t0) + 0.45, s * W / 2], [x1, deck(t1) + 0.45, s * W / 2], 0.25, 0.9, PAL.stoneDark);
      }
      b.quad([x0, deck(t0), W / 2], [x1, deck(t1), W / 2], [x1, deck(t1), -W / 2], [x0, deck(t0), -W / 2], PAL.stone);
      b.quad([x0, bot(x0), -W / 2], [x1, bot(x1), -W / 2], [x1, bot(x1), W / 2], [x0, bot(x0), W / 2], PAL.stoneDark);
    }
    const ux = Math.cos(ry), uz = -Math.sin(ry);
    this.decks.push((px, pz) => {
      const dx = px - cx, dz = pz - cz, a = dx * ux + dz * uz, c = -dx * uz + dz * ux;
      return Math.abs(a) > L / 2 || Math.abs(c) > W / 2 ? null : deck(a / L + 0.5);
    });
  }

  woodBridge(l) {
    const [ax, az] = P(...l.a), [bx, bz] = P(...l.b);
    const L = Math.hypot(bx - ax, bz - az) + 6, ry = Math.atan2(-(bz - az), bx - ax), cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const b = this.chunk(cx); b.setFrame(cx, 0, cz, ry);
    const W = l.w, top = 0.9, col = l.stone ? PAL.marble : PAL.wood;
    b.box(0, top - 0.3, 0, L, 0.3, W, col);
    for (let x = -L / 2; x <= L / 2; x += 4) for (const s of [-1, 1]) {
      b.box(x, -2.8, s * (W / 2 - 0.2), 0.3, top + 2.5, 0.3, PAL.woodDark);
      b.box(x, top, s * W / 2, 0.15, 1.0, 0.15, l.stone ? PAL.marble : PAL.woodDark);
    }
    for (const s of [-1, 1]) b.box(0, top + 0.9, s * W / 2, L, 0.12, 0.12, l.stone ? PAL.marble : PAL.woodDark);
    const ux = Math.cos(ry), uz = -Math.sin(ry);
    this.decks.push((px, pz) => {
      const dx = px - cx, dz = pz - cz, a = dx * ux + dz * uz, c = -dx * uz + dz * ux;
      return Math.abs(a) > L / 2 || Math.abs(c) > W / 2 ? null : top;
    });
  }

  corridorBridge(l) {
    // zig-zag marble causeway on piers, red railings, a gate pavilion at the far end
    const [ax, az] = P(...l.a), [bx, bz] = P(...l.b);
    const L = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax), cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const b = this.chunk(cx); b.setFrame(cx, 0, cz, ry);
    const W = l.w, top = 1.4;
    b.box(0, top - 0.4, 0, L, 0.4, W, PAL.marble);
    for (let x = -L / 2; x <= L / 2; x += 6) b.box(x, -2.8, 0, 1.2, top + 2.4, W, PAL.stone);
    for (const s of [-1, 1]) {
      b.box(0, top + 0.85, s * W / 2, L, 0.15, 0.15, PAL.red);
      for (let x = -L / 2; x <= L / 2; x += 1.5) b.box(x, top, s * W / 2, 0.12, 0.9, 0.12, PAL.red);
    }
    const ux = Math.cos(ry), uz = -Math.sin(ry);
    this.decks.push((px, pz) => {
      const dx = px - cx, dz = pz - cz, a = dx * ux + dz * uz, c = -dx * uz + dz * ux;
      return Math.abs(a) > L / 2 + 1 || Math.abs(c) > W / 2 ? null : top;
    });
  }

  gateTower(l) {
    // city gate: massive brick block over the road with an arched passage, two-storey tower above
    const [x, z] = P(...l.at);
    const W = CITY_WALL, pts = W.pts.map(p => P(...p));
    const ry = Math.atan2(-(pts[2][1] - pts[0][1]), pts[2][0] - pts[0][0]);
    const b = this.chunk(x); b.setFrame(x, -1, z, ry);
    const L = 24, D = W.w + 6, H = W.h + 1;
    b.box(-L / 2 + 5, 0, 0, 10, H, D, PAL.brick, { ty: 2 });
    b.box(L / 2 - 5, 0, 0, 10, H, D, PAL.brick, { ty: 2 });
    b.box(0, 6.2, 0, 4.4, H - 6.2, D, PAL.brick, { ty: 2 });
    // arch head
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI * i / 8, a1 = Math.PI * (i + 1) / 8;
      for (const s of [1, -1]) b.quad([Math.cos(a0) * 2.2, 5.2 + Math.sin(a0) * 1.0 + 1, s * D / 2], [Math.cos(a1) * 2.2, 5.2 + Math.sin(a1) * 1.0 + 1, s * D / 2], [Math.cos(a1) * 2.2, H, s * D / 2], [Math.cos(a0) * 2.2, H, s * D / 2], PAL.brick);
    }
    b.quad([-2.2, 1, D / 2 - 0.4], [2.2, 1, D / 2 - 0.4], [2.2, 6.2, -D / 2 + 0.4], [-2.2, 6.2, -D / 2 + 0.4], PAL.interior);
    b.setFrame(x, H - 1, z, ry);
    b.box(0, 0, 0, L - 2, 0.6, D - 2, PAL.stone);
    b.box(0, 0.6, 0, L - 6, 5, D - 6, PAL.red);
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) b.box(-(L - 6) / 2 + i * (L - 6) / 6, 0.6, s * (D - 6) / 2, 0.5, 5, 0.5, PAL.timberRed);
    roofHip(b, { L: L - 6, D: D - 6, o: 2.2, y0: 5.6, rise: 3, fMax: 0.45, up: 0.8, col: PAL.roof2 });
    b.box(0, 6.6, 0, L - 9, 4, D - 9, PAL.plaster);
    for (let i = 0; i < 7; i++) b.quad([-(L - 9) / 2 + i * (L - 9) / 7 + 0.4, 7.4, (D - 9) / 2 + 0.02], [-(L - 9) / 2 + (i + 1) * (L - 9) / 7 - 0.4, 7.4, (D - 9) / 2 + 0.02], [-(L - 9) / 2 + (i + 1) * (L - 9) / 7 - 0.4, 10, (D - 9) / 2 + 0.02], [-(L - 9) / 2 + i * (L - 9) / 7 + 0.4, 10, (D - 9) / 2 + 0.02], PAL.lattice);
    roofHip(b, { L: L - 9, D: D - 9, o: 2.4, y0: 10.6, rise: 5.5, ridgeK: 0.7, up: 1.0, col: PAL.roof2 });
  }

  pailou(l) {
    const [x, z] = P(...l.at), b = this.chunk(x);
    b.setFrame(x, this.terrainAt(x, z), z, l.rot || 0);
    const col = l.palace ? PAL.red : PAL.timberRed, roof = l.palace ? PAL.yellow : PAL.roof2;
    const pos = [-6, -2.2, 2.2, 6];
    for (const px of pos) { b.box(px, -0.2, 0, 0.6, 7.5, 0.6, col); b.box(px, -0.2, 0, 1.2, 1.2, 1.2, PAL.stone); }
    b.box(0, 5.2, 0, 13, 1.2, 0.5, PAL.green);
    b.box(0, 4.3, 0, 3.8, 0.9, 0.3, PAL.gold);
    roofHip(b, { L: 4.6, D: 1.2, o: 0.8, y0: 7.5, rise: 1.4, col: roof, up: 0.6 });
    for (const s of [-1, 1]) roofHip(b, { L: 3.6, D: 1.0, o: 0.7, y0: 6.6, rise: 1.2, col: roof, up: 0.5, cx: s * 4.1 });
  }

  stage(l) {
    const [x, z] = P(...l.at), b = this.chunk(x);
    b.setFrame(x, this.terrainAt(x, z), z, 0);
    b.box(0, -0.3, 0, 12, 2.3, 9, PAL.wood);
    for (const [px, pz] of [[-5.6, 4.2], [5.6, 4.2], [-5.6, -4.2], [5.6, -4.2]]) b.box(px, 2, pz, 0.4, 4.2, 0.4, PAL.red);
    b.box(0, 2, -4.3, 11.6, 4.2, 0.3, PAL.clothRed);
    roofHip(b, { L: 12, D: 9, o: 1.4, y0: 6.2, rise: 3.6, col: PAL.roof, up: 0.9, ridgeK: 0.7 });
    b.box(0, 5.4, 4.4, 11.5, 0.6, 0.2, PAL.gold);
    this.colliders.push([x, z, 6.5, 5, 1, 0]);
  }

  temple(l) {
    const [x, z] = P(...l.at), b = this.chunk(x), r = this.r;
    b.setFrame(x, this.terrainAt(x, z), z, 0);
    for (const s of [-1, 1]) b.box(0, 0, s * 13, 30, 3, 0.8, PAL.redWall);
    for (const s of [-1, 1]) b.box(s * 15, 0, 0, 0.8, 3, 26, PAL.redWall);
    b.setFrame(x, this.terrainAt(x, z), z - 4, 0);
    hall(b, { L: 16, D: 10, tiers: 1, roofCol: PAL.roof2, base: 0.8, rnd: r });
    b.setFrame(x, this.terrainAt(x, z), z + 11, 0);
    house(b, { L: 7, D: 5, style: 'urban', rnd: r });
    this.colliders.push([x, z, 15.5, 13.5, 1, 0]);
  }

  // ---------------- boats ----------------
  buildBoats() {
    const r = rng(99), mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const geos = {};
    const geo = type => {
      if (!geos[type]) { const b = new Batch(); boat(b, type, r); geos[type] = b.toGeometry(); }
      return geos[type];
    };
    this.boats = [];
    for (const [u, v, type, hd] of BOATS) {
      const [x, z] = P(u, v), m = new THREE.Mesh(geo(type), mat);
      m.position.set(x, WATER_Y, z); m.rotation.y = hd + (r() - 0.5) * 0.3;
      this.scene.add(m); this.boats.push({ m, moving: false, ph: r() * 6 });
    }
    for (const [pts, types, count, speed] of BOAT_ROUTES) {
      const P3 = pts.map(([u, v]) => P(u, v));
      const cum = [0]; for (let i = 1; i < P3.length; i++) cum.push(cum[i - 1] + Math.hypot(P3[i][0] - P3[i - 1][0], P3[i][1] - P3[i - 1][1]));
      for (let k = 0; k < count; k++) {
        const type = types[k % types.length], m = new THREE.Mesh(geo(type), mat);
        this.scene.add(m);
        this.boats.push({ m, moving: true, pts: P3, cum, len: cum[cum.length - 1], s: r() * cum[cum.length - 1], dir: r() < 0.5 ? 1 : -1, sp: speed * (0.7 + r() * 0.6), ph: r() * 6, lat: (r() - 0.5) * 10 });
      }
    }
  }
  updateBoats(dt, t) {
    for (const bt of this.boats) {
      const m = bt.m;
      if (bt.moving) {
        bt.s += bt.dir * bt.sp * dt;
        if (bt.s > bt.len) { bt.s = bt.len; bt.dir = -1; } else if (bt.s < 0) { bt.s = 0; bt.dir = 1; }
        let i = 1; while (i < bt.cum.length - 1 && bt.cum[i] < bt.s) i++;
        const a = bt.pts[i - 1], b = bt.pts[i], L = bt.cum[i] - bt.cum[i - 1], f = (bt.s - bt.cum[i - 1]) / L;
        const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
        m.position.x = a[0] + (b[0] - a[0]) * f - tz * bt.lat; m.position.z = a[1] + (b[1] - a[1]) * f + tx * bt.lat;
        const target = Math.atan2(-tz * bt.dir, tx * bt.dir);
        let d = target - m.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        m.rotation.y += d * Math.min(1, dt * 0.8);
      }
      m.position.y = WATER_Y + Math.sin(t * 1.1 + bt.ph) * 0.06;
      m.rotation.z = Math.sin(t * 0.9 + bt.ph) * 0.015;
    }
  }

  // ---------------- trees (painted billboards) ----------------
  buildTrees() {
    const r = rng(42), list = [];
    const zone = u => {   // tree mix + density by scroll section
      if (u > 25000) return [[['willowA', 3], ['willowB', 3], ['elmA', 3], ['elmB', 2], ['huaiB', 1], ['peach', 0.6], ['apricot', 0.6], ['treerow', 0.4], ['shrub', 1]], 0.5];
      if (u > 19500) return [[['willowA', 4], ['willowB', 3], ['elmA', 2], ['elmB', 2], ['huaiA', 1], ['peach', 0.4]], 0.32];
      if (u > 11000) return [[['huaiA', 2], ['huaiB', 2], ['elmA', 2], ['willowA', 2], ['peach2', 0.5], ['pine', 0.6]], 0.14];
      if (u > 7300) return [[['willowA', 3], ['willowB', 3], ['elmB', 2], ['peach', 0.6], ['bambooA', 0.6]], 0.25];
      return [[['pine', 3], ['huaiC', 2], ['peach', 2], ['peach2', 2], ['apricot', 1.5], ['willowA', 1.5], ['bambooA', 1], ['bambooB', 1], ['shrub', 1]], 0.3];
    };
    const pickW = pool => { let t = 0; for (const [, w] of pool) t += w; let x = r() * t; for (const [n, w] of pool) if ((x -= w) <= 0) return n; return pool[0][0]; };
    const step = 6.5;
    for (let x = 0; x < WORLD_X1; x += step) for (let z = Z_FAR + 30; z < Z_NEAR; z += step) {
      const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
      const u = X2U(px), v = Z2V(pz);
      if (v < 0 || v > STRIP_H) continue;
      const w = sampleMask(this.maps.waterSoft, u, v);
      if (w > 0.45) continue;
      if (sampleMask(this.maps.road, u, v) > 0.15) continue;
      if (sampleMask(this.maps.fields, u, v) > 0.5) continue;
      const blk = sampleMask(this.maps.blocks, u, v);
      const [pool, dens] = zone(u);
      let p = dens * (1 - blk * 0.85);
      if (w > 0.12 && w < 0.45) p += 0.35;                // river banks: willows
      const far = Math.max(0, -pz - 120) / 160;
      if (r() > p * (1 - Math.min(0.6, far * 0.3))) continue;
      if (this.nearCollider(px, pz, 2)) continue;
      let name = w > 0.12 && r() < 0.7 ? (r() < 0.5 ? 'willowA' : 'willowB') : pickW(pool);
      if (far > 0.8 && r() < 0.5) name = 'treerow';
      list.push([name, px, this.terrainAt(px, pz), pz, 0.75 + r() * 0.5]);
    }
    for (const [x, z] of this.extraTrees) {
      const [pool] = zone(X2U(x));
      list.push([pickW(pool.filter(([n]) => n !== 'treerow' && n !== 'shrub')), x, this.terrainAt(x, z), z, 0.8 + r() * 0.4]);
    }
    const layer = new SpriteLayer(this.trees, list.length, { sway: 1, alphaCut: 0.42, tint: [0.66, 0.76, 0.6] });
    list.forEach(([n, x, y, z, s], i) => {
      const it = this.trees.meta.items[n], h = it.hm * s, w2 = h * it.px / it.py;
      layer.set(i, n, x, y - 0.2, z, w2, h, r() < 0.5 ? 1 : -1, 0, 0);
    });
    layer.commit(list.length);
    layer.mesh.layers.set(1);
    this.treeLayer = layer;
    this.treeList = list;
    this.scene.add(layer.mesh);
  }

  nearCollider(x, z, pad = 0) {
    for (const c of this.colliders) {
      if (!c) continue;
      const [cx, cz, hx, hz, co, si] = c, dx = x - cx, dz = z - cz;
      if (Math.abs(dx) > hx + hz + pad + 2 || Math.abs(dz) > hx + hz + pad + 2) continue;
      const a = dx * co - dz * si, b = dx * si + dz * co;
      if (Math.abs(a) < hx + pad && Math.abs(b) < hz + pad) return true;
    }
    return false;
  }

  update(dt, t) {
    this.uTime.value = t;
    if (this.treeLayer) this.treeLayer.mat.uniforms.uTime.value = t;
    this.updateBoats(dt, t);
  }
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
