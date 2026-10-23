// audio.js — generative soundscape: a guzheng improvising on the pentatonic scale (Karplus–Strong plucks),
// river & breeze, a street murmur that swells with the crowd, the odd bird. All synthesised; no files.
const PENTA = [0, 2, 4, 7, 9];                       // gong shang jue zhi yu
const BASE = 146.83;                                  // D3

export class Soundscape {
  constructor() { this.on = true; this.started = false; this.crowd = 0; this.water = 0.5; }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.started = true;
    this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.9 : 0; this.master.connect(ctx.destination);
    // reverb: generated hall impulse
    const len = ctx.sampleRate * 2.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.32; this.verb.connect(wet); wet.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.42; this.music.connect(this.master); this.music.connect(this.verb);
    this.buildStrings();
    this.buildNoise();
    this.nextNote = ctx.currentTime + 0.3; this.phrase = []; this.deg = 7;
    this.timer = setInterval(() => this.schedule(), 120);
  }

  // Karplus–Strong plucks for three octaves of the scale, rendered once
  buildStrings() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    this.notes = [];
    for (let oct = 0; oct < 3; oct++) for (const st of PENTA) {
      const f = BASE * Math.pow(2, oct + st / 12), N = Math.round(sr / f), dur = 3.2, L = Math.floor(sr * dur);
      const buf = ctx.createBuffer(1, L, sr), d = buf.getChannelData(0), ring = new Float32Array(N);
      for (let i = 0; i < N; i++) ring[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / N * Math.PI));   // pluck near the bridge
      let idx = 0; const damp = 0.4985 + oct * 0.0004;
      for (let i = 0; i < L; i++) {
        const nx = (idx + 1) % N, v = (ring[idx] + ring[nx]) * damp;
        d[i] = ring[idx]; ring[idx] = v; idx = nx;
      }
      // soft attack shaping and a little body resonance
      for (let i = 0; i < 64; i++) d[i] *= i / 64;
      this.notes.push(buf);
    }
  }
  pluck(i, t, vel = 1, bend = 0) {
    const ctx = this.ctx, b = this.notes[Math.max(0, Math.min(this.notes.length - 1, i))];
    const s = ctx.createBufferSource(); s.buffer = b;
    if (bend) { s.playbackRate.setValueAtTime(1, t + 0.25); s.playbackRate.linearRampToValueAtTime(Math.pow(2, bend / 12), t + 0.7); }   // 按音 press-bend
    const g = ctx.createGain(); g.gain.value = 0.35 * vel;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = (i / this.notes.length - 0.5) * 0.8; s.connect(g); g.connect(pan); pan.connect(this.music); }
    else { s.connect(g); g.connect(this.music); }
    s.start(t);
  }
  schedule() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    while (this.nextNote < ctx.currentTime + 0.6) {
      const t = this.nextNote, r = Math.random();
      if (r < 0.08) {                                   // 刮奏 glissando run
        const up = Math.random() < 0.6;
        for (let k = 0; k < 9; k++) this.pluck(up ? 3 + k : 13 - k, t + k * 0.045, 0.45);
        this.deg = up ? 11 : 4; this.nextNote += 1.2;
      } else {
        this.deg = Math.max(2, Math.min(13, this.deg + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
        const bend = Math.random() < 0.12 ? 2 : 0;
        this.pluck(this.deg, t, 0.7 + Math.random() * 0.3, bend);
        if (Math.random() < 0.18) this.pluck(this.deg - 5, t, 0.5);          // octave below
        if (Math.random() < 0.06) this.pluck(this.deg + 1, t + 0.09, 0.5);   // grace note
        const beat = 0.5;
        this.nextNote += beat * [1, 1, 2, 2, 3, 1.5][Math.floor(Math.random() * 6)];
      }
      if (Math.random() < 0.12) this.nextNote += 2.5;                        // breathe
    }
    // birds now and then
    if (Math.random() < 0.035) this.chirp();
  }

  buildNoise() {
    const ctx = this.ctx, L = ctx.sampleRate * 4, buf = ctx.createBuffer(1, L, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < L; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    const src = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(ctx.currentTime + Math.random()); return s; };
    // river / breeze
    const w = src(), wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 600;
    this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0.10;
    w.connect(wf); wf.connect(this.waterGain); this.waterGain.connect(this.master);
    // crowd murmur: band-passed noise with slow random swells
    const c = src(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 450; f1.Q.value = 1.2; f2.type = 'bandpass'; f2.frequency.value = 1300; f2.Q.value = 2.5;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    const mod = ctx.createGain(); mod.gain.value = 1;
    c.connect(f1); c.connect(f2); f1.connect(mod); f2.connect(mod); mod.connect(this.crowdGain); this.crowdGain.connect(this.master);
    this.crowdMod = mod;
  }
  chirp() {
    const ctx = this.ctx, t = ctx.currentTime + 0.05, n = 2 + Math.floor(Math.random() * 4), f0 = 2600 + Math.random() * 1800;
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), tt = t + k * 0.13;
      o.frequency.setValueAtTime(f0, tt); o.frequency.exponentialRampToValueAtTime(f0 * 1.5, tt + 0.06);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.025, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09);
      o.connect(g); g.connect(this.master); this.master && o.start(tt); o.stop(tt + 0.1);
    }
  }

  // called every frame: crowd 0..1 (people near the listener), water 0..1
  update(crowd, water) {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.16 * crowd, t, 0.5);
    this.waterGain.gain.setTargetAtTime(0.04 + 0.1 * water, t, 0.8);
    this.crowdMod.gain.setTargetAtTime(0.6 + 0.4 * Math.random(), t, 0.25);
  }
  toggle() {
    this.on = !this.on;
    if (!this.started) { this.start(); }
    if (this.master) this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.2);
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.on;
  }
  resume() { if (!this.started) this.start(); else if (this.ctx.state === 'suspended') this.ctx.resume(); }
}
