// main.js — 清明上河圖・動 : flat animated handscroll -> (mouse wheel) -> walkable 3D world.
import * as THREE from 'three';
import { STRIP_W, STRIP_H, PAINT_U0, PAINT_U1, U2X, X2U, V2Z, Z2V, CHAPTERS } from './layout.js';
import { buildMaps, MW, MH } from './maps.js';
import { loadAtlas, SpriteLayer } from './sprites.js';
import { Crowd } from './crowd.js';
import { Scroll2D } from './scroll2d.js';
import { World } from './world.js';
import { PaintPost, Dissolve } from './post.js';
import { GodCam, PovCam, WalkCam } from './cameras.js';
import { Soundscape } from './audio.js';

const $ = s => document.querySelector(s);
const canvas = $('#c');
const mm = $('#mm');
const mmImg = new Image(); mmImg.src = 'assets/scroll/overview.webp';
const isTouch = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight, false);

const params = new URLSearchParams(location.search);
const state = { mode: 'scroll', p: 0, pGoal: 0, playing: true, t: 0, ready: false, pick: null };
const setLoad = (f, txt) => { $('#loadbar').style.width = `${Math.round(f * 100)}%`; if (txt) $('#loadtxt').textContent = txt; };

// ---------------------------------------------------------------- boot
const maps = buildMaps();
const maskTex = new THREE.DataTexture(maps.tex, MW, MH, THREE.RGBAFormat);
maskTex.magFilter = maskTex.minFilter = THREE.LinearFilter; maskTex.needsUpdate = true;
setLoad(0.1, '研墨中…');
const [figures, trees, boats] = await Promise.all([loadAtlas('figures'), loadAtlas('trees'), loadAtlas('boats')]);
setLoad(0.2, '鋪絹中…');

const scroll = new Scroll2D(renderer, maskTex, figures, boats);
await scroll.init();
const startU = params.has('u') ? +params.get('u') : STRIP_W - 1200;
scroll.cu = startU;
// load the tiles in view first, then reveal
scroll.update(0, null);
await Promise.all(scroll.tiles.filter(t => t.state).map(t => t.promise));
setLoad(0.35, '起造城郭…');

const world = new World(maps, maskTex, trees, figures);
await world.build(f => setLoad(0.35 + f * 0.6));
const crowd = new Crowd(figures, (x, z, kind) => world.heightAt(x, z));
const people3D = new SpriteLayer(figures, 4000, { alphaCut: 0.5 });
people3D.mesh.layers.set(1);
world.scene.add(people3D.mesh);

const cam3 = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.15, 3000);
const god = new GodCam(), pov = new PovCam(), walk = new WalkCam();
const post = new PaintPost(renderer), dissolve = new Dissolve(renderer);
const sound = new Soundscape();
const birds3D = makeBirds3D(); world.scene.add(birds3D.layer.mesh);
// unroll the scroll on arrival
{ const e = scroll.extents(); scroll.uReveal.value = scroll.cu + e.halfW + 60; state.unroll = scroll.cu - e.halfW - 200; }
setLoad(1, '展卷');
drawMinimap();
setTimeout(() => $('#intro').classList.add('gone'), 300);
state.ready = true;
window.__qm = { state, scroll, world, crowd, god, pov, walk, cam3, renderer, frame, setMode, post, people3D, sound, U2X, V2Z, X2U, Z2V };
console.log(`[qm] buildings ${world.buildingCount}, agents ${crowd.agents.length}, trees ${world.treeList.length}`);

// ---------------------------------------------------------------- dive (2D <-> 3D)
// p: 0 = flat scroll, 1 = 3D god view. 0..0.45 zooms the scroll, 0.35..0.8 ink-dissolves to 3D, 3D camera descends throughout.
const ease = x => x * x * (3 - 2 * x);
function diveAnchor() {
  // the 3D target follows where the scroll is being zoomed
  const u = scroll.zoomU ?? scroll.cu, v = scroll.zoomV * STRIP_H;
  return [U2X(Math.min(PAINT_U1, Math.max(PAINT_U0, u))), V2Z(Math.min(980, Math.max(380, v)))];
}
function startDive(sx, sy) {
  const [u, v] = sx == null ? [scroll.cu, STRIP_H * 0.62] : scroll.screenToStrip(sx, sy);
  scroll.zoomU = u; scroll.zoomV = Math.min(0.95, Math.max(0.3, v / STRIP_H));
  const [x, z] = diveAnchor();
  Object.assign(god.goal, { tx: x, tz: z, yaw: 0, pitch: 0.62, dist: 55 }); god.snap();
}
function diveCamera(p) {
  const e = ease(Math.min(1, Math.max(0, (p - 0.15) / 0.85)));
  const dist = THREE.MathUtils.lerp(330, god.dist, e), pitch = THREE.MathUtils.lerp(0.95, god.pitch, e);
  cam3.fov = THREE.MathUtils.lerp(30, 42, e); cam3.updateProjectionMatrix();
  god.apply(cam3, (x, z) => world.heightAt(x, z), dist, pitch);
}

// ---------------------------------------------------------------- modes
const HINTS = {
  scroll: isTouch ? '雙指張開：走進畫中　單指拖曳：展卷' : '滾輪向下：走進畫中（3D）　拖曳 / ← →：展卷　空白鍵：自動展卷',
  god: isTouch ? '拖曳：移動　雙指：縮放旋轉　點人物：人物視角' : '拖曳：移動　右鍵拖曳 / Q E：旋轉　滾輪：遠近（拉到最遠回到畫卷）　點畫中人：人物視角',
  pov: isTouch ? '拖曳：轉頭看看' : '拖曳：轉頭看看　← →：換一個人　Esc：回上帝視角',
  walk: isTouch ? '左半邊拖曳：走路　右半邊拖曳：轉頭' : 'W A S D / 方向鍵：走路　Shift：快跑　拖曳：轉頭　Esc：回上帝視角',
};
function setMode(m, opts = {}) {
  if (m === 'scroll') {
    if (state.mode !== 'scroll') {
      if (state.mode !== 'god') godFromCamera();
      scroll.cu = X2U(god.tx); scroll.zoomU = scroll.cu; scroll.zoomV = Math.min(0.95, Math.max(0.3, Z2V(god.tz) / STRIP_H));
      state.p = 1;
    }
    state.mode = 'scroll'; state.pGoal = 0;
  } else if (m === 'god') {
    if (state.mode === 'scroll') { if (state.p < 0.01) startDive(); state.pGoal = 1; state.mode = 'scroll'; state.after = 'god'; setButtons('god'); return; }
    if (state.mode === 'pov' || state.mode === 'walk') godFromCamera();
    state.mode = 'god'; crowd.hidden = null;
  } else if (m === 'pov') {
    if (state.mode === 'scroll') { if (state.p < 0.01) startDive(); state.pGoal = 1; state.after = 'pov'; setButtons('pov'); return; }
    const a = opts.agent || nearestAgent(god.tx, god.tz);
    if (!a) return;
    pov.attach(a); crowd.hidden = a; state.mode = 'pov';
    $('#povcard .who').textContent = `你正以「${crowd.label(a)}」的眼睛逛這座城`;
  } else if (m === 'walk') {
    if (state.mode === 'scroll') { if (state.p < 0.01) startDive(); state.pGoal = 1; state.after = 'walk'; setButtons('walk'); return; }
    const src = state.mode === 'pov' && pov.agent ? [pov.agent.x, pov.agent.z] : [god.tx, god.tz];
    const spot = findDry(src[0], src[1]);
    walk.place(spot[0], spot[1], state.mode === 'pov' ? pov.yaw + pov.look : god.yaw);
    walk.y = world.heightAt(spot[0], spot[1]);
    crowd.hidden = null; state.mode = 'walk';
  }
  setButtons(state.mode);
}
function setButtons(m) {
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#povcard').hidden = m !== 'pov';
  $('#hint').textContent = HINTS[m] || '';
  clearTimeout(setButtons.t);
  setButtons.t = setTimeout(() => { if (state.mode === m) $('#hint').textContent = ''; }, 9000);
}
function godFromCamera() {
  // after a ground-level view, hover above where we were
  const x = cam3.position.x, z = cam3.position.z;
  const dir = new THREE.Vector3(); cam3.getWorldDirection(dir);
  Object.assign(god.goal, { tx: x + dir.x * 25, tz: z + dir.z * 25, yaw: Math.atan2(-dir.x, -dir.z), pitch: 0.65, dist: 70 });
  god.clampGoal(); god.snap();
}
function nearestAgent(x, z) {
  let best = null, bd = 1e9;
  for (const a of crowd.agents) {
    const it = figures.meta.items[a.name]; if (!it || it.kind === 'still' || a.roam) continue;
    const d = Math.hypot(a.x - x, a.z - z) - (a.speed > 0 ? 8 : 0);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}
function findDry(x, z) {
  for (let r = 0; r < 120; r += 2) for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (world.heightAt(px, pz) > 0 && !world.nearCollider(px, pz, 0.6)) return [px, pz];
  }
  return [x, z];
}

// ---------------------------------------------------------------- input
const ptrs = new Map();
let drag = null, lastTap = 0;
canvas.addEventListener('contextmenu', e => e.preventDefault());
const unlock = () => { if (sound.on) sound.resume(); };
addEventListener('pointerdown', unlock); addEventListener('keydown', unlock); addEventListener('wheel', unlock, { passive: true });
$('#sound').addEventListener('click', e => { e.stopPropagation(); $('#sound').classList.toggle('off', !sound.toggle()); });
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button });
  if (ptrs.size === 2) drag = { pinch: pinchInfo() };
  else drag = { button: e.button, shift: e.shiftKey, moved: 0, walkSide: e.clientX < innerWidth / 2 ? 'L' : 'R' };
  canvas.classList.add('dragging');
  if (state.mode === 'scroll') state.playing = false, updatePlay();
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) { hover(e); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (!drag) return;
  if (ptrs.size >= 2 && drag.pinch) {
    const n = pinchInfo(), o = drag.pinch;
    const f = o.d / Math.max(10, n.d);
    if (state.mode === 'scroll') { if (state.p === 0) startDive((n.cx), (n.cy)); state.pGoal = state.p = Math.min(1, Math.max(0, state.p + (1 - f) * 1.2)); }
    else if (state.mode === 'god') {
      if (god.goal.dist >= god.MAX - 1 && f > 1) setMode('scroll');
      god.zoom(f); god.rotate(n.a - o.a, (n.cy - o.cy) * 0.004); god.pan(n.cx - o.cx, n.cy - o.cy, innerHeight);
    }
    drag.pinch = n; return;
  }
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (state.mode === 'scroll') {
    if (state.p < 0.02) scroll.cu -= dx * (STRIP_H + 150) / innerHeight / scroll.zoom;
  } else if (state.mode === 'god') {
    if (drag.button === 2 || drag.shift) god.rotate(-dx * 0.005, dy * 0.004);
    else god.pan(dx, dy, innerHeight);
  } else if (state.mode === 'pov') pov.drag(dx, dy);
  else if (state.mode === 'walk') {
    if (isTouch && drag.walkSide === 'L') walk.joy = { x: Math.max(-1, Math.min(1, (e.clientX - p.x0) / 60)), y: Math.max(-1, Math.min(1, (e.clientY - p.y0) / 60)) };
    else walk.drag(dx, dy);
  }
});
const endPtr = e => {
  const p = ptrs.get(e.pointerId);
  ptrs.delete(e.pointerId);
  if (!ptrs.size) canvas.classList.remove('dragging');
  walk.joy = null;
  if (p && drag && !drag.pinch && drag.moved < 8 && performance.now() - p.t0 < 400) tap(e.clientX, e.clientY);
  if (ptrs.size < 2 && drag && drag.pinch) drag = null;
};
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
function pinchInfo() {
  const [a, b] = [...ptrs.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, a: Math.atan2(b.y - a.y, b.x - a.x) };
}
const project = (x, y, z) => {
  const v = new THREE.Vector3(x, y, z).project(cam3);
  if (v.z > 1 || v.z < -1) return null;
  return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
};
function tap(x, y) {
  if (state.mode === 'god' || state.mode === 'pov') {
    const a = crowd.pick(project, x, y, isTouch ? 36 : 26);
    if (a) setMode('pov', { agent: a });
  }
}
const tip = $('#tip');
function hover(e) {
  if (state.mode !== 'god' || isTouch) { canvas.classList.remove('pick'); tip.hidden = true; return; }
  const a = crowd.pick(project, e.clientX, e.clientY, 26);
  canvas.classList.toggle('pick', !!a);
  tip.hidden = !a;
  if (a) { tip.textContent = `${crowd.label(a)}・點我換成他的視角`; tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`; }
}
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
  if (state.mode === 'scroll') {
    if (Math.abs(e.deltaX) > Math.abs(dy) || e.shiftKey) { scroll.cu += (e.deltaX || dy) * 1.5; state.playing = false; updatePlay(); return; }
    if (state.p < 0.001 && dy > 0) startDive(e.clientX, e.clientY);
    state.pGoal = Math.min(1, Math.max(0, state.pGoal + dy * 0.0011));
    state.after = 'god';
    if (state.pGoal > 0) state.playing = false, updatePlay();
  } else if (state.mode === 'god') {
    if (dy < 0 || god.goal.dist < god.MAX - 1) god.zoom(Math.exp(dy * 0.0012));
    else setMode('scroll');
  } else if (state.mode === 'pov' || state.mode === 'walk') {
    if (dy > 0) setMode('god');
  }
}, { passive: false });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  walk.keys.add(e.code);
  if (e.code === 'Escape') setMode(state.mode === 'god' ? 'scroll' : state.mode === 'scroll' ? 'scroll' : 'god');
  if (e.code === 'Space' && state.mode === 'scroll') { state.playing = !state.playing; updatePlay(); e.preventDefault(); }
  if (state.mode === 'scroll' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { state.playing = false; updatePlay(); }
  if (state.mode === 'pov' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) nextPerson();
  if (state.mode === 'god' && e.code === 'KeyP') setMode('pov');
  if (e.code === 'KeyM') $('#sound').click();
  if ((state.mode === 'god' || state.mode === 'scroll') && e.code === 'KeyG') setMode('god');
  if (state.mode !== 'walk' && e.code === 'KeyW' && state.mode !== 'scroll') setMode('walk');
});
addEventListener('keyup', e => walk.keys.delete(e.code));
addEventListener('blur', () => walk.keys.clear());
document.querySelectorAll('#modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#povNext').addEventListener('click', nextPerson);
$('#povExit').addEventListener('click', () => setMode('god'));
function nextPerson() {
  const a0 = pov.agent; if (!a0) return;
  const cands = crowd.agents.filter(a => a !== a0 && !a.roam && Math.hypot(a.x - a0.x, a.z - a0.z) < 60 && a.speed > 0);
  const a = cands[Math.floor(Math.random() * cands.length)] || nearestAgent(a0.x + 30, a0.z);
  if (a) setMode('pov', { agent: a });
}
$('#play').addEventListener('click', () => { state.playing = !state.playing; if (state.mode !== 'scroll') setMode('scroll'); updatePlay(); });
function updatePlay() { $('#play').textContent = state.playing ? '❚❚' : '▶'; }

// minimap: the whole scroll; click / drag to travel
function drawMinimap() {
  const r = mm.getBoundingClientRect(); if (!r.width) return;
  mm.width = r.width * devicePixelRatio; mm.height = r.height * devicePixelRatio;
  const img = mmImg;
  const paint = () => {
    const g = mm.getContext('2d'); g.drawImage(img, 0, 0, mm.width, mm.height);
    g.fillStyle = 'rgba(176,64,44,.9)'; g.font = `${11 * devicePixelRatio}px serif`;
    for (const c of CHAPTERS) { const x = c.u / STRIP_W * mm.width; g.fillRect(x - 1, mm.height - 5 * devicePixelRatio, 2, 5 * devicePixelRatio); }
  };
  if (img.complete && img.naturalWidth) paint(); else img.onload = paint;
}
addEventListener('resize', () => { drawMinimap(); });
let mmDrag = false;
const mmJump = e => {
  const r = mm.getBoundingClientRect(), u = (e.clientX - r.left) / r.width * STRIP_W;
  if (state.mode === 'scroll') { scroll.cu = u; state.playing = false; updatePlay(); }
  else { god.goal.tx = U2X(Math.min(PAINT_U1, Math.max(PAINT_U0, u))); god.clampGoal(); if (state.mode !== 'god') setMode('god'); }
};
mm.addEventListener('pointerdown', e => { mmDrag = true; mm.setPointerCapture(e.pointerId); mmJump(e); });
mm.addEventListener('pointermove', e => { if (mmDrag) mmJump(e); });
mm.addEventListener('pointerup', () => { mmDrag = false; });

// ---------------------------------------------------------------- resize
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  cam3.aspect = innerWidth / innerHeight; cam3.updateProjectionMatrix();
  post.resize(); dissolve.resize();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- loop
let last = performance.now(), chapterShown = '';
const _sz = new THREE.Vector2();
function frame(dt) {
  state.t += dt;
  renderer.getSize(_sz);
  if (_sz.x !== innerWidth || _sz.y !== innerHeight) resize();
  // dive progress
  if (state.mode === 'scroll') {
    const k = 1 - Math.exp(-dt * 5);
    state.p += (state.pGoal - state.p) * k;
    if (Math.abs(state.pGoal - state.p) < 0.002) state.p = state.pGoal;
    if (state.p >= 0.999 && state.pGoal >= 1) { state.mode = 'god'; state.p = 1; const nxt = state.after || 'god'; state.after = null; setMode(nxt); }
    if (state.playing && state.p === 0) { scroll.cu -= dt * 55; if (scroll.cu < 1200) state.playing = false, updatePlay(); }
    if (!state.playing && state.p === 0) {
      if (walk.keys.has('ArrowLeft')) scroll.cu -= dt * 900;
      if (walk.keys.has('ArrowRight')) scroll.cu += dt * 900;
    }
  }
  const p = state.mode === 'scroll' ? state.p : 1;
  if (state.unroll != null) {
    const r = scroll.uReveal;
    r.value -= dt * Math.max(500, (r.value - state.unroll) * 1.6);
    if (r.value < state.unroll) { r.value = -1e9; state.unroll = null; }
  }
  crowd.update(dt);
  // ---- 2D
  if (p < 0.8) {
    scroll.zoom = 1 + 2.4 * ease(Math.min(1, p / 0.6));
    scroll.update(dt, crowd);
  }
  // ---- 3D
  if (p > 0.3) {
    if (state.mode === 'scroll') diveCamera(p);
    else if (state.mode === 'god') {
      if (walk.keys.has('KeyQ')) god.rotate(dt * 1.2, 0); if (walk.keys.has('KeyE')) god.rotate(-dt * 1.2, 0);
      const pk = (walk.keys.has('ArrowLeft') ? -1 : 0) + (walk.keys.has('ArrowRight') ? 1 : 0), pf = (walk.keys.has('ArrowUp') ? -1 : 0) + (walk.keys.has('ArrowDown') ? 1 : 0);
      if (pk || pf) god.pan(-pk * dt * 600, -pf * dt * 600, innerHeight);
      if (cam3.fov !== 42) { cam3.fov = 42; cam3.updateProjectionMatrix(); }
      god.update(dt, cam3, (x, z) => world.heightAt(x, z));
    } else if (state.mode === 'pov') pov.update(dt, cam3, figures.meta.items);
    else if (state.mode === 'walk') walk.update(dt, cam3, world);
    const rv = new THREE.Vector3().setFromMatrixColumn(cam3.matrixWorld, 0);
    const near = state.mode === 'pov' || state.mode === 'walk';
    crowd.write3D(people3D, rv.x, rv.z, cam3.position.x, cam3.position.z, near ? 260 : Math.max(220, cam3.position.y * 3.2));
    people3D.mat.uniforms.uTime.value = state.t;
    world.update(dt, state.t);
    updateBirds3D(dt);
    cam3.near = near ? 0.15 : Math.max(0.5, cam3.position.y * 0.02); cam3.updateProjectionMatrix();
  }
  // ---- compose
  if (p <= 0.3) scroll.render(null);
  else if (p >= 0.8) post.render(world.scene, cam3, null, state.t);
  else {
    scroll.render(dissolve.a);
    post.render(world.scene, cam3, dissolve.b, state.t);
    dissolve.render((p - 0.3) / 0.5);
  }
  // ---- sound: street murmur follows the crowd around the listener
  if (sound.started) {
    let near = 0;
    if (p > 0.5) { const cx = cam3.position.x, cz = cam3.position.z, R = state.mode === 'god' ? 40 + god.dist * 0.5 : 25;
      for (const a of crowd.agents) if (Math.abs(a.x - cx) < R && Math.abs(a.z - cz) < R) near++; near = Math.min(1, near / 40) * (state.mode === 'god' ? Math.max(0.2, 1 - god.dist / 300) : 1); }
    else near = Math.min(1, scroll.walkers.count / 160) * 0.5;
    const wet = p > 0.5 ? (world.isWater(cam3.position.x, cam3.position.z) ? 1 : 0.35) : 0.5;
    sound.update(near, wet);
  }
  // ---- hud
  const u = state.mode === 'scroll' && p < 0.5 ? scroll.cu : X2U(state.mode === 'god' ? god.tx : cam3.position.x);
  let ch = CHAPTERS[0]; for (const c of CHAPTERS) if (Math.abs(c.u - u) < Math.abs(ch.u - u)) ch = c;
  if (ch.zh !== chapterShown) { chapterShown = ch.zh; $('#chapter').textContent = `— ${ch.zh} —`; }
  const view = state.mode === 'scroll' && p < 0.5 && scroll.view ? scroll.view : { u0: u - 900, u1: u + 900 };
  const mv = $('#mmview'), W = mm.clientWidth;
  if (W && Math.abs(mm.width - W * devicePixelRatio) > 2) drawMinimap();
  mv.style.left = `${5 + Math.max(0, view.u0) / STRIP_W * W}px`;
  mv.style.width = `${Math.max(4, (Math.min(STRIP_W, view.u1) - Math.max(0, view.u0)) / STRIP_W * W)}px`;
}
// ink birds wheeling over the 3D city
function makeBirds3D() {
  const atlas = scroll.birds.atlas, layer = new SpriteLayer(atlas, 60, { alphaCut: 0.4 });
  layer.mesh.layers.set(1);
  const flocks = [];
  for (let f = 0; f < 6; f++) flocks.push({ ang: Math.random() * 6.28, r: 40 + Math.random() * 60, h: 28 + Math.random() * 25, sp: 0.08 + Math.random() * 0.06, n: 3 + Math.floor(Math.random() * 5), ph: Math.random() * 6 });
  return { layer, flocks };
}
function updateBirds3D(dt) {
  const L = birds3D.layer; let n = 0;
  const cx = state.mode === 'god' ? god.tx : cam3.position.x, cz = state.mode === 'god' ? god.tz : cam3.position.z;
  for (const f of birds3D.flocks) {
    f.ang += f.sp * dt;
    for (let k = 0; k < f.n; k++) {
      const a = f.ang - k * 0.035, x = cx + Math.cos(a) * (f.r + (k % 3) * 3), z = cz + Math.sin(a) * (f.r + (k % 2) * 4);
      L.set(n++, Math.sin(state.t * 8 + k + f.ph) > 0 ? 'up' : 'down', x, f.h + Math.sin(state.t + k) * 1.5, z, 1.4, 1.4, 1, 0, 0);
    }
  }
  L.commit(n);
}
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  frame(dt);
  requestAnimationFrame(loop);
}
setButtons('scroll');
requestAnimationFrame(loop);
