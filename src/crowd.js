// crowd.js — the people, animals and carts of the scroll. One simulation in world metres;
// drawn as 3D billboards and, mapped back through the painting projection, as 2D sprites over the scroll.
import { PATHS, P, X2U, Z2V } from './layout.js';

// sprite pools per path kind: [name, weight]
const POOLS = {
  street: [['merchant', 6], ['porter', 6], ['scholar', 4], ['mother', 3], ['monk', 1.5], ['peddler', 4], ['servant', 4], ['child', 3],
    ['elder', 2.5], ['official', 2], ['umbrella', 3], ['water', 2.5], ['lady', 3], ['barrow', 2], ['farmer', 2], ['guard', 1],
    ['rider', 2.2], ['donkeyrider', 2.2], ['sedan', 2], ['camel', 0.8], ['oxcart', 1.2], ['mulecart', 1.2], ['packdonkey', 1.6],
    ['handcart', 1.4], ['chickens', 1.5], ['groom', 1], ['dog', 1.2]],
  bridge: [['merchant', 5], ['porter', 6], ['scholar', 4], ['peddler', 4], ['servant', 3], ['child', 2], ['elder', 2], ['official', 1.5],
    ['umbrella', 3], ['water', 2], ['lady', 2], ['barrow', 2], ['donkeyrider', 2], ['sedan', 2], ['packdonkey', 1.5], ['chickens', 1.5], ['dog', 0.8]],
  road: [['farmer', 6], ['porter', 6], ['peddler', 3], ['elder', 2], ['water', 2], ['merchant', 2], ['child', 1.5], ['rider', 2],
    ['donkeyrider', 3], ['packdonkey', 3], ['oxcart', 2], ['mulecart', 1.5], ['handcart', 2], ['barrow', 2], ['camel', 0.6], ['dog', 1], ['groom', 1], ['sedan', 0.8]],
  path: [['farmer', 6], ['porter', 3], ['elder', 2], ['child', 2], ['packdonkey', 2], ['donkeyrider', 1], ['dog', 1]],
  lane: [['merchant', 3], ['servant', 4], ['lady', 2], ['child', 2], ['elder', 2], ['water', 3], ['porter', 2], ['dog', 1]],
  quay: [['porter', 8], ['servant', 3], ['handcart', 3], ['barrow', 3], ['merchant', 2], ['water', 2]],
  garden: [['official', 4], ['lady', 5], ['scholar', 3], ['servant', 3], ['guard', 1.5], ['elder', 1]],
  corridor: [['official', 3], ['lady', 4], ['servant', 2], ['scholar', 2]],
};
const SPEED = { rider: 2.1, donkeyrider: 1.5, camel: 1.3, oxcart: 0.9, mulecart: 1.2, packdonkey: 1.2, handcart: 1.0, sedan: 1.3,
  child: 1.6, dog: 1.6, elder: 0.8, barrow: 1.0, groom: 1.2, goats: 0.5, pig: 0.4, buffalo: 0.5, deer: 0.6, crane: 0 };
const NAMES_ZH = { merchant: '布商', porter: '挑夫', scholar: '書生', mother: '帶孩子的婦人', monk: '雲遊僧', farmer: '農夫', peddler: '貨郎',
  servant: '僕役', child: '孩童', elder: '老翁', official: '官員', umbrella: '撐傘的行人', water: '挑水夫', lady: '仕女', guard: '衛兵',
  barrow: '推車的苦力', rider: '騎馬的人', donkeyrider: '騎驢的老者', oxcart: '趕牛車的人', camel: '駱駝商隊', sedan: '轎夫',
  packdonkey: '趕驢的人', mulecart: '騾車', dog: '小黃狗', goats: '羊群', pig: '黑豬', buffalo: '水牛', handcart: '拉貨車的人',
  chickens: '賣雞的小販', groom: '馬夫', deer: '梅花鹿', crane: '白鶴' };
// animals that roam a home spot: [u, v, radius m, name, count]
const ROAMERS = [
  [4600, 880, 30, 'deer', 6], [5200, 860, 25, 'deer', 4], [2600, 900, 20, 'crane', 3], [5600, 650, 10, 'crane', 2],
  [32800, 760, 40, 'buffalo', 3], [31600, 700, 30, 'goats', 3], [30300, 700, 20, 'pig', 2], [26800, 330, 40, 'buffalo', 2],
  [25500, 380, 25, 'goats', 2], [28600, 860, 20, 'dog', 2], [24200, 900, 30, 'goats', 2], [25900, 880, 25, 'buffalo', 1],
  [9800, 900, 15, 'dog', 1], [14000, 780, 40, 'dog', 2], [19000, 820, 30, 'pig', 1], [30900, 620, 20, 'chickens', 1],
];

function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 4294967296); }
function pick(r, pool) {
  let t = 0; for (const [, w] of pool) t += w;
  let x = r() * t; for (const [n, w] of pool) if ((x -= w) <= 0) return n;
  return pool[0][0];
}

class Path {
  constructor(ptsUV, width, kind) {
    this.kind = kind; this.width = width;
    this.p = ptsUV.map(([u, v]) => P(u, v));
    this.cum = [0];
    for (let i = 1; i < this.p.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.p[i][0] - this.p[i - 1][0], this.p[i][1] - this.p[i - 1][1]));
    this.len = this.cum[this.cum.length - 1];
  }
  at(s, out) {   // position + unit tangent at arc length s
    s = Math.max(0, Math.min(this.len, s));
    let i = 1; while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const a = this.p[i - 1], b = this.p[i], L = this.cum[i] - this.cum[i - 1] || 1, f = (s - this.cum[i - 1]) / L;
    out.x = a[0] + (b[0] - a[0]) * f; out.z = a[1] + (b[1] - a[1]) * f;
    out.tx = (b[0] - a[0]) / L; out.tz = (b[1] - a[1]) / L;
    return out;
  }
}

export class Crowd {
  constructor(figures, heightAt) {
    this.fig = figures.meta.items; this.heightAt = heightAt;
    this.paths = PATHS.map(([pts, w, , kind]) => new Path(pts, w, kind));
    this.agents = [];
    const r = rng(1736);
    PATHS.forEach(([, w, dens, kind], pi) => {
      const path = this.paths[pi], n = Math.round(path.len * dens * 0.3);
      const pool = POOLS[kind] || POOLS.road;
      for (let k = 0; k < n; k++) {
        const name = pick(r, pool);
        const idle = kind !== 'bridge' && r() < 0.18 && !(name in SPEED && SPEED[name] > 1.2);
        this.agents.push({
          name, path, s: r() * path.len, dir: r() < 0.5 ? 1 : -1, lat: (r() - 0.5) * w * 0.85,
          speed: idle ? 0 : (SPEED[name] ?? 1.15) * (0.85 + r() * 0.3), ph: r() * 6.28, idle,
          x: 0, y: 0, z: 0, hx: 1, hz: 0, flipRand: r() < 0.5 ? -1 : 1, wait: 0,
        });
      }
    });
    for (const [u, v, rad, name, cnt] of ROAMERS) {
      const [hx, hz] = P(u, v);
      for (let k = 0; k < cnt; k++) {
        const a = r() * 6.28, d = r() * rad;
        this.agents.push({ name, roam: { hx, hz, rad }, x: hx + Math.cos(a) * d, z: hz + Math.sin(a) * d, y: 0,
          tx: hx, tz: hz, speed: SPEED[name] ?? 0.5, ph: r() * 6.28, wait: r() * 5, hx: 1, hz: 0, flipRand: r() < 0.5 ? -1 : 1, rnd: r });
      }
    }
    this._tmp = {};
    this.hidden = null;      // agent followed in POV (hidden from 3D)
    this.update(0);
  }

  label(a) { return NAMES_ZH[a.name] || a.name; }

  update(dt) {
    const t = this._tmp;
    for (const a of this.agents) {
      if (a.roam) {
        if (a.wait > 0) { a.wait -= dt; a.moving = false; }
        else {
          const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
          if (d < 0.3 || a.speed === 0) {
            const an = a.rnd() * 6.28, rr = a.rnd() * a.roam.rad;
            a.tx = a.roam.hx + Math.cos(an) * rr; a.tz = a.roam.hz + Math.sin(an) * rr; a.wait = 2 + a.rnd() * 8;
          } else {
            a.x += dx / d * a.speed * dt; a.z += dz / d * a.speed * dt; a.hx = dx / d; a.hz = dz / d; a.moving = true;
          }
        }
        a.y = this.heightAt(a.x, a.z);
        if (a.moving) a.ph += dt * a.speed * 5.5;
        continue;
      }
      const p = a.path;
      if (a.speed > 0) {
        a.s += a.dir * a.speed * dt;
        if (a.s > p.len) { a.s = p.len; a.dir = -1; } else if (a.s < 0) { a.s = 0; a.dir = 1; }
        a.ph += dt * a.speed * 5.5;
      } else a.ph += dt * 0.6;
      p.at(a.s, t);
      a.x = t.x - t.tz * a.lat; a.z = t.z + t.tx * a.lat;
      a.hx = t.tx * a.dir; a.hz = t.tz * a.dir;
      a.y = this.heightAt(a.x, a.z, p.kind);
      a.moving = a.speed > 0;
    }
  }

  // 3D billboards. camRx/camRz = camera right vector on the ground plane
  write3D(layer, camRx, camRz, cx, cz, radius) {
    let n = 0; const r2 = radius * radius;
    for (const a of this.agents) {
      if (a === this.hidden) continue;
      const dx = a.x - cx, dz = a.z - cz;
      if (dx * dx + dz * dz > r2) continue;
      const it = this.fig[a.name]; if (!it) continue;
      const h = it.hm, w = h * it.px / it.py;
      const screenDir = a.hx * camRx + a.hz * camRz;
      const flip = it.face === 0 ? a.flipRand : (Math.sign(screenDir || 1) === it.face ? 1 : -1);
      layer.set(n++, a.name, a.x, a.y, a.z, w, h, flip, a.ph, a.moving ? 1 : 0);
      if (n >= layer.max) break;
    }
    layer.commit(n);
  }

  // 2D sprites over the scroll (strip px). Only agents inside [u0,u1]; sorted far -> near
  write2D(layer, u0, u1) {
    const list = [];
    for (const a of this.agents) {
      const u = X2U(a.x); if (u < u0 || u > u1) continue;
      list.push([Z2V(a.z), u, a]);
    }
    list.sort((p, q) => p[0] - q[0]);
    let n = 0;
    for (const [v, u, a] of list) {
      const it = this.fig[a.name]; if (!it) continue;
      const px = 7 + 24 * Math.max(0, Math.min(1, v / 1024));       // painted figure height (1.75 m) by depth
      const h = px * it.hm / 1.75, w = h * it.px / it.py;
      const flip = it.face === 0 ? a.flipRand : (Math.sign(a.hx || 1) === it.face ? 1 : -1);
      layer.set(n++, a.name, u, -v, 0, w, h, flip, a.ph, a.moving ? 1 : 0, 1);
      if (n >= layer.max) break;
    }
    layer.commit(n);
  }

  // nearest agent to a screen point (for POV picking). project(x,y,z) -> [sx, sy, depth]
  pick(project, sx, sy, maxPx = 40) {
    let best = null, bd = maxPx;
    for (const a of this.agents) {
      const it = this.fig[a.name]; if (!it || it.kind === 'still') continue;
      const p = project(a.x, a.y + it.hm * 0.5, a.z); if (!p) continue;
      const d = Math.hypot(p[0] - sx, p[1] - sy);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
}
