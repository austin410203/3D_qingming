// scroll2d.js — the flat, animated handscroll: painting tiles with rippling water,
// walkers / carts / boats drawn over it, birds crossing the sky.
import * as THREE from 'three';
import { STRIP_W, STRIP_H, BOAT_ROUTES } from './layout.js';
import { SpriteLayer } from './sprites.js';

const TILE_VERT = `varying vec2 vUv; varying vec2 vStrip; uniform float uU0, uTW;
  void main(){ vUv = uv; vStrip = vec2(uU0 + uv.x * uTW, (1.0 - uv.y) * ${STRIP_H.toFixed(1)});
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TILE_FRAG = `
  uniform sampler2D map, uMask; uniform float uTime, uTW, uLoaded, uReveal; uniform vec2 uTexel;
  varying vec2 vUv; varying vec2 vStrip;
  float lum(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
  void main(){
    vec2 m = vStrip / vec2(${STRIP_W.toFixed(1)}, ${STRIP_H.toFixed(1)});
    float w = texture2D(uMask, m).r;                // DataTexture row 0 = top of the scroll
    // only ripple flat silk: fade out where the painting has strong detail (boats, trees over water)
    vec3 c0 = texture2D(map, vUv).rgb;
    float det = abs(lum(texture2D(map, vUv + vec2(uTexel.x*2.0,0.)).rgb) - lum(c0)) + abs(lum(texture2D(map, vUv + vec2(0.,uTexel.y*2.0)).rgb) - lum(c0));
    float k = smoothstep(0.35, 0.8, w) * (1.0 - smoothstep(0.035, 0.09, det));
    float t = uTime;
    vec2 off = vec2(sin(vStrip.y * 0.55 + t * 1.7 + sin(vStrip.x * 0.013 + t * 0.4) * 2.0) * 1.3,
                    sin(vStrip.x * 0.05 + t * 1.1) * 0.5) * k;
    vec3 c = texture2D(map, vUv + off * uTexel).rgb;
    // drifting glints along the ripple lines
    float g = sin(vStrip.x * 0.021 - t * 0.9 + sin(vStrip.y * 0.3) * 1.5) * sin(vStrip.y * 0.9 + t * 0.7);
    c += k * smoothstep(0.75, 1.0, g) * 0.05;
    c = mix(vec3(0.89,0.83,0.68), c, uLoaded);
    // still-rolled part of the scroll (unrolls right -> left): wooden roller, then nothing
    float d = vStrip.x - uReveal;
    if (d < -34.0) discard;
    if (d < 0.0) { float k = -d / 34.0; float sh = sqrt(max(0.0, 1.0 - (2.0*k-1.0)*(2.0*k-1.0)));
      c = mix(vec3(0.36, 0.20, 0.12), vec3(0.78, 0.6, 0.38), sh * 0.8) * (0.55 + 0.45 * sh); }
    else c *= 1.0 - 0.25 * exp(-d / 18.0);           // shadow cast by the roller
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export class Scroll2D {
  constructor(renderer, maskTex, figures, boats) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x3b2a1c);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.cu = STRIP_W - 900;          // view centre (strip px)
    this.uReveal = { value: -1e9 };    // strip u left of which the scroll is still rolled up
    this.zoom = 1; this.zoomU = null; this.zoomV = 0.5;
    this.meta = null;
    this.tiles = [];
    this.maskTex = maskTex;
    this.time = 0;
    // mounting: brocade bands above & below
    const band = new THREE.MeshBasicMaterial({ color: 0x6e3326 });
    for (const y of [40, -STRIP_H - 40]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(STRIP_W + 400, 80), band); m.position.set(STRIP_W / 2, y, -1); this.scene.add(m);
    }
    const edge = new THREE.MeshBasicMaterial({ color: 0xc8a861 });
    for (const y of [3, -STRIP_H - 3]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(STRIP_W + 400, 6), edge); m.position.set(STRIP_W / 2, y, -0.5); this.scene.add(m);
    }
    this.walkers = new SpriteLayer(figures, 2600, { is2D: true });
    this.walkers.mesh.renderOrder = 5; this.scene.add(this.walkers.mesh);
    this.boatLayer = boats ? new SpriteLayer(boats, 64, { is2D: true }) : null;
    if (this.boatLayer) { this.boatLayer.mesh.renderOrder = 4; this.scene.add(this.boatLayer.mesh); }
    this.birds = this.makeBirds(); this.scene.add(this.birds.mesh);
    if (boats) this.makeBoats(boats);
  }

  // boats gliding along the river routes (the painted ones stay moored)
  makeBoats(atlas) {
    const kinds = { junk: ['junk', 'bigjunk', 'cargo'], sampan: ['sampan', 'fishing'], ferry: ['ferry', 'passenger', 'tea'], sail: ['sail'], dragon: ['dragon', 'barge'] };
    this.boatAgents = [];
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [pts, types, count, speed] of BOAT_ROUTES) {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      for (let k = 0; k < count + 2; k++) {
        const pool = kinds[types[k % types.length]] || ['sampan'];
        this.boatAgents.push({ pts, cum, len: cum[cum.length - 1], s: r() * cum[cum.length - 1], dir: r() < 0.5 ? 1 : -1,
          sp: speed * (0.7 + r() * 0.6), name: pool[Math.floor(r() * pool.length)], ph: r() * 6, lat: (r() - 0.5) * 60 });
      }
    }
  }
  updateBoats(dt, u0, u1) {
    if (!this.boatAgents) return;
    let n = 0; const L = this.boatLayer, items = this.boatLayer.atlas.meta.items;
    const list = [];
    for (const b of this.boatAgents) {
      const v0 = this.boatPos(b, 0)[1], pxm = (7 + 24 * v0 / STRIP_H) / 1.75;
      b.s += b.dir * b.sp * pxm * dt;
      if (b.s > b.len) { b.s = b.len; b.dir = -1; } else if (b.s < 0) { b.s = 0; b.dir = 1; }
      const [u, v, tu] = this.boatPos(b, b.lat);
      if (u < u0 - 400 || u > u1 + 400) continue;
      list.push([v, u, b, tu]);
    }
    list.sort((a, c) => a[0] - c[0]);
    for (const [v, u, b, tu] of list) {
      const it = items[b.name], pxm = (7 + 24 * v / STRIP_H) / 1.75;
      const h = it.hm * pxm, w = h * it.px / it.py;
      const hide = Math.min(1, Math.max(0, Math.min(u - 21250, 22550 - u) / 120));     // under the painted bridge
      if (hide >= 1) continue;
      L.set(n++, b.name, u, -v - h * 0.12 + Math.sin(this.time * 1.3 + b.ph) * 0.6, 0.2, w, h, Math.sign(tu * b.dir || 1) * it.face, 0, 0, 1 - hide);
    }
    L.commit(n);
  }
  boatPos(b, lat) {
    const { pts, cum } = b; let i = 1;
    while (i < cum.length - 1 && cum[i] < b.s) i++;
    const a = pts[i - 1], c = pts[i], L = cum[i] - cum[i - 1] || 1, f = (b.s - cum[i - 1]) / L;
    const tu = (c[0] - a[0]) / L, tv = (c[1] - a[1]) / L;
    return [a[0] + (c[0] - a[0]) * f - tv * lat * 0.2, a[1] + (c[1] - a[1]) * f + tu * lat * 0.2, tu];
  }

  async init() {
    this.meta = await fetch('assets/scroll/meta.json').then(r => r.json());
    const { tw, n, w } = this.meta;
    for (let i = 0; i < n; i++) {
      const wpx = Math.min(tw, w - i * tw);
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, uMask: { value: this.maskTex }, uTime: { value: 0 }, uU0: { value: i * tw },
          uTW: { value: wpx }, uTexel: { value: new THREE.Vector2(1 / wpx, 1 / STRIP_H) }, uLoaded: { value: 0 }, uReveal: this.uReveal },
        vertexShader: TILE_VERT, fragmentShader: TILE_FRAG });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wpx, STRIP_H), mat);
      m.position.set(i * tw + wpx / 2, -STRIP_H / 2, 0);
      this.scene.add(m);
      this.tiles.push({ mesh: m, mat, state: 0, i });
    }
  }

  loadTile(t) {
    if (t.state) return t.promise;
    t.state = 1;
    t.promise = new THREE.TextureLoader().loadAsync(`assets/scroll/t_${String(t.i).padStart(2, '0')}.webp`).then(tex => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter;
      t.mat.uniforms.map.value = tex; t.state = 2; this.fadeIn(t);
    });
    return t.promise;
  }
  fadeIn(t) { t.fade = 0; }

  // visible strip-px half extents for the current viewport
  extents() {
    const s = { x: Math.max(1, innerWidth), y: Math.max(1, innerHeight) };
    // fit the silk between the title bar and the minimap strip
    const top = s.y < 500 ? 36 : 50, bot = s.y < 500 ? 66 : 86;
    const avail = Math.max(120, s.y - top - bot);
    const visH = STRIP_H * s.y / avail / this.zoom;
    const shift = (bot - top) / 2 * (visH / s.y);                 // move the silk up so it clears the minimap
    return { halfW: visH * s.x / s.y / 2, halfH: visH / 2, aspect: s.x / s.y, shift };
  }
  clampCenter() {
    const { halfW } = this.extents();
    const lo = halfW - 200, hi = STRIP_W - halfW + 200;
    this.cu = lo > hi ? STRIP_W / 2 : Math.max(lo, Math.min(hi, this.cu));
  }

  update(dt, crowd) {
    this.time += dt;
    const { halfW, halfH, shift } = this.extents();
    this.clampCenter();
    let cx = this.cu, cy = -STRIP_H / 2 - shift;
    if (!Number.isFinite(this.zoomU)) this.zoomU = null;
    if (this.zoom > 1 && this.zoomU != null) {          // zoom toward the pointer
      const f = 1 - 1 / this.zoom;
      cx = this.cu + (this.zoomU - this.cu) * f;
      cy = -STRIP_H / 2 - shift + (-this.zoomV * STRIP_H + STRIP_H / 2 + shift) * f;
    }
    Object.assign(this.cam, { left: cx - halfW, right: cx + halfW, top: cy + halfH, bottom: cy - halfH });
    this.cam.updateProjectionMatrix();
    const u0 = cx - halfW - 300, u1 = cx + halfW + 300;
    for (const t of this.tiles) {
      const tu0 = t.i * this.meta.tw, tu1 = tu0 + this.meta.tw;
      const near = tu1 > u0 - 2500 && tu0 < u1 + 2500;
      if (near) this.loadTile(t);
      t.mat.uniforms.uTime.value = this.time;
      if (t.state === 2 && t.fade < 1) { t.fade = Math.min(1, t.fade + dt * 2.5); t.mat.uniforms.uLoaded.value = t.fade; }
    }
    const ur = Math.max(u0, this.uReveal.value + 20);           // nothing walks on the still-rolled part
    if (crowd) crowd.write2D(this.walkers, ur, u1);
    this.walkers.mat.uniforms.uTime.value = this.time;
    this.updateBirds(dt, ur, u1);
    if (this.boatLayer) this.updateBoats(dt, ur + 300, u1);
    this.view = { u0: cx - halfW, u1: cx + halfW };
  }

  // ink birds: tiny two-frame flapping strokes in flocks
  makeBirds() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 32;
    const g = c.getContext('2d'); g.strokeStyle = '#2f2a22'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(3, 10); g.quadraticCurveTo(10, 4, 16, 14); g.quadraticCurveTo(22, 4, 29, 10); g.stroke();   // wings up
    g.beginPath(); g.moveTo(35, 12); g.quadraticCurveTo(42, 18, 48, 14); g.quadraticCurveTo(54, 18, 61, 12); g.stroke(); // wings down
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const atlas = { tex, meta: { items: { up: { u: 0, v: 0, w: .5, h: 1, px: 32, py: 32 }, down: { u: .5, v: 0, w: .5, h: 1, px: 32, py: 32 } } } };
    const layer = new SpriteLayer(atlas, 80, { is2D: true });
    layer.mesh.renderOrder = 6;
    const r = Math.random;
    this.flocks = [];
    for (let f = 0; f < 9; f++) {
      const n = 3 + Math.floor(r() * 6), u = r() * STRIP_W, v = 40 + r() * 260, dir = r() < 0.5 ? -1 : 1;
      this.flocks.push({ u, v, dir, sp: 25 + r() * 25, birds: Array.from({ length: n }, () => [r() * 70 - 35, r() * 30 - 15, r() * 6]) });
    }
    return layer;
  }
  updateBirds(dt, u0, u1) {
    let n = 0; const L = this.birds;
    for (const f of this.flocks) {
      f.u += f.dir * f.sp * dt; f.v += Math.sin(this.time * 0.3 + f.sp) * dt * 3;
      if (f.u < -200) f.u = STRIP_W + 100; if (f.u > STRIP_W + 200) f.u = -100;
      if (f.u < u0 - 100 || f.u > u1 + 100) continue;
      for (const [du, dv, ph] of f.birds) {
        const flap = Math.sin(this.time * 9 + ph) > 0 ? 'up' : 'down';
        L.set(n++, flap, f.u + du, -(f.v + dv + Math.sin(this.time * 2 + ph) * 2), 0.5, 9, 9, f.dir, 0, 0, 0.9);
      }
    }
    L.commit(n);
  }

  // strip coords under a screen pixel
  screenToStrip(sx, sy) {
    const s = { x: innerWidth, y: innerHeight };
    if (!s.x || !s.y || !Number.isFinite(this.cam.left)) return [this.cu, STRIP_H * 0.62];
    const u = this.cam.left + (sx / s.x) * (this.cam.right - this.cam.left);
    const v = -(this.cam.top + (sy / s.y) * (this.cam.bottom - this.cam.top));
    return [u, v];
  }

  render(target = null) {
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }
}
