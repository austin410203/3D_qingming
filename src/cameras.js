// cameras.js — god view (orbit over the city), person view (ride along with someone in the crowd),
// free walk (be a passer-by yourself).
import * as THREE from 'three';
import { WORLD_X1, Z_NEAR, Z_FAR } from './layout.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

export class GodCam {
  constructor() {
    this.tx = 1300; this.tz = -60; this.yaw = 0; this.pitch = 0.62; this.dist = 55;
    this.goal = { tx: this.tx, tz: this.tz, yaw: 0, pitch: 0.62, dist: 55 };
    this.MIN = 10; this.MAX = 420;
  }
  pan(dxPx, dyPx, viewH) {
    const k = this.dist / viewH * 1.1;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const g = this.goal;
    g.tx -= (dxPx * c + dyPx * s / Math.sin(this.pitch) * 0.9) * k;
    g.tz -= (-dxPx * s + dyPx * c / Math.sin(this.pitch) * 0.9) * k;
    this.clampGoal();
  }
  rotate(dyaw, dpitch) { this.goal.yaw += dyaw; this.goal.pitch = clamp(this.goal.pitch + dpitch, 0.18, 1.45); }
  zoom(f) { this.goal.dist = clamp(this.goal.dist * f, this.MIN, this.MAX); }
  clampGoal() { const g = this.goal; g.tx = clamp(g.tx, -20, WORLD_X1 + 20); g.tz = clamp(g.tz, Z_FAR + 10, Z_NEAR + 10); }
  snap() { Object.assign(this, { tx: this.goal.tx, tz: this.goal.tz, yaw: this.goal.yaw, pitch: this.goal.pitch, dist: this.goal.dist }); }
  update(dt, cam, heightAt) {
    const g = this.goal;
    this.tx = damp(this.tx, g.tx, 8, dt); this.tz = damp(this.tz, g.tz, 8, dt);
    this.yaw = damp(this.yaw, g.yaw, 8, dt); this.pitch = damp(this.pitch, g.pitch, 8, dt); this.dist = damp(this.dist, g.dist, 7, dt);
    this.apply(cam, heightAt);
  }
  apply(cam, heightAt, dist = this.dist, pitch = this.pitch) {
    const ty = heightAt ? Math.max(0, heightAt(this.tx, this.tz)) : 0;
    const cp = Math.cos(pitch);
    cam.position.set(this.tx + Math.sin(this.yaw) * cp * dist, ty + Math.sin(pitch) * dist, this.tz + Math.cos(this.yaw) * cp * dist);
    if (heightAt) cam.position.y = Math.max(cam.position.y, heightAt(cam.position.x, cam.position.z) + 2.5);
    cam.lookAt(this.tx, ty, this.tz);
  }
}

// ride along with an agent of the crowd
export class PovCam {
  constructor() { this.agent = null; this.look = 0; this.lookP = -0.05; this.yaw = 0; this.goalLook = 0; this.goalP = -0.05; }
  attach(a) { this.agent = a; this.yaw = Math.atan2(-a.hx, -a.hz); this.goalLook = this.look = 0; this.goalP = this.lookP = -0.04; }
  drag(dx, dy) { this.goalLook -= dx * 0.005; this.goalP = clamp(this.goalP - dy * 0.004, -0.9, 0.7); }
  update(dt, cam, fig) {
    const a = this.agent; if (!a) return;
    const it = fig[a.name];
    const eye = it ? (it.kind === 'ride' || it.kind === 'cart' ? Math.min(2.3, it.hm * 0.9) : it.hm * 0.88) : 1.6;
    const moving = a.moving && (Math.abs(a.hx) + Math.abs(a.hz)) > 0;
    if (moving) {
      let target = Math.atan2(-a.hx, -a.hz), d = wrapA(target - this.yaw);
      this.yaw += d * (1 - Math.exp(-3 * dt));
    }
    this.look = damp(this.look, this.goalLook, 6, dt); this.lookP = damp(this.lookP, this.goalP, 6, dt);
    const bob = moving ? Math.abs(Math.sin(a.ph)) * 0.05 : 0;
    cam.position.set(a.x, a.y + eye + bob, a.z);
    const yy = this.yaw + this.look;
    cam.lookAt(a.x - Math.sin(yy) * Math.cos(this.lookP) * 10, a.y + eye + Math.sin(this.lookP) * 10, a.z - Math.cos(yy) * Math.cos(this.lookP) * 10);
  }
}

// free walking: you are a passer-by
export class WalkCam {
  constructor() { this.x = 0; this.z = 0; this.y = 0; this.yaw = 0; this.pitch = -0.05; this.keys = new Set(); this.joy = null; this.ph = 0; }
  place(x, z, yaw) { this.x = x; this.z = z; this.yaw = yaw; this.pitch = -0.05; }
  drag(dx, dy) { this.yaw -= dx * 0.005; this.pitch = clamp(this.pitch - dy * 0.004, -1.0, 0.8); }
  update(dt, cam, world) {
    let f = 0, s = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1; if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD')) s += 1; if (k.has('KeyA')) s -= 1;
    if (k.has('ArrowLeft')) this.yaw += dt * 1.8; if (k.has('ArrowRight')) this.yaw -= dt * 1.8;
    if (this.joy) { f += -this.joy.y; s += this.joy.x; }
    const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 2.6 : 1;
    const len = Math.hypot(f, s);
    if (len > 0.05) {
      f /= Math.max(1, len); s /= Math.max(1, len);
      const sp = 1.6 * run * dt, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      const dx = (-sn * f + c * s) * sp, dz = (-c * f - sn * s) * sp;
      const tryMove = (nx, nz) => {
        const h = world.heightAt(nx, nz);
        if (h < -0.2) return false;                                  // river: stay on dry land / bridges
        if (world.nearCollider(nx, nz, 0.3)) return false;
        if (Math.abs(h - this.y) > 1.4) return false;
        return true;
      };
      if (tryMove(this.x + dx, this.z + dz)) { this.x += dx; this.z += dz; }
      else if (tryMove(this.x + dx, this.z)) this.x += dx;
      else if (tryMove(this.x, this.z + dz)) this.z += dz;
      this.ph += sp * 3.4;
    }
    this.x = clamp(this.x, 0, WORLD_X1); this.z = clamp(this.z, Z_FAR + 20, Z_NEAR - 1);
    this.y = damp(this.y, world.heightAt(this.x, this.z), 14, dt);
    const eye = 1.6 + Math.abs(Math.sin(this.ph)) * 0.05;
    cam.position.set(this.x, this.y + eye, this.z);
    cam.lookAt(this.x - Math.sin(this.yaw) * Math.cos(this.pitch) * 10, this.y + eye + Math.sin(this.pitch) * 10, this.z - Math.cos(this.yaw) * Math.cos(this.pitch) * 10);
  }
}
