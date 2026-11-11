'use strict';
/**
 * Sound – zvukové efekty generované přes Web Audio, bez zvukových souborů:
 * sekera, krumpáč, kladivo, výstřel, déšť, hrom, hukot strojů, upozornění.
 * Zvuk se spustí až po prvním dotyku (požadavek prohlížečů). Hlasitost a
 * vypnutí jsou v Menu a pamatují se v prohlížeči.
 */
const Sound = {
  ctx: null, master: null, noiseBuf: null,
  volume: 0.6, muted: false,
  last: {},            // název → čas posledního přehrání (omezení četnosti)
  rainGain: null, humGain: null,
  GAP: { chop: 0.16, pick: 0.16, hammer: 0.14, shot: 0.08, hit: 0.12, thunder: 2, alarm: 3, ui_info: 0.4, ui_good: 0.4, ui_warn: 0.6 },

  load() {
    try {
      const d = JSON.parse(localStorage.getItem('kolonie.sound') || '{}');
      if (typeof d.volume === 'number') this.volume = d.volume;
      this.muted = !!d.muted;
    } catch (e) { /* bez úložiště */ }
  },
  store() { try { localStorage.setItem('kolonie.sound', JSON.stringify({ volume: this.volume, muted: this.muted })); } catch (e) { /* nic */ } },
  setVolume(v) { this.volume = U.clamp(v, 0, 1); this.apply(); this.store(); },
  setMuted(m) { this.muted = !!m; this.apply(); this.store(); },
  apply() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; },

  /** Zavolat při prvním dotyku / stisku klávesy. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.apply();
      // bílý šum na 1 s
      const buf = this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // smyčka deště a hukot strojů (hlasitost řídí update)
      this.rainGain = this.loopNoise('bandpass', 2400, 0.6);
      this.humGain = ctx.createGain(); this.humGain.gain.value = 0; this.humGain.connect(this.master);
      for (const f of [55, 82.5]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; o.connect(lp); lp.connect(this.humGain); o.start(); }
    } catch (e) { this.ctx = null; }
  },
  loopNoise(type, freq, q) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf; src.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    return g;
  },
  /** Krátký tón s obálkou. */
  tone(freq, dur, type, vol, slideTo, delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  /** Krátký šumový úder přes filtr. */
  burst(dur, type, freq, vol, delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf;
    f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  },

  /** Přehraje efekt. S polohou (x, y v políčkách) zní jen to, co je na obrazovce. */
  play(name, x, y) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - (this.last[name] || -10) < (this.GAP[name] || 0.1)) return;
    let v = 1;
    if (x !== undefined) {
      const p = Camera.worldToScreen(x * Config.TILE, y * Config.TILE);
      if (p.x < -60 || p.y < -60 || p.x > Camera.vw + 60 || p.y > Camera.vh + 60) return;
      v = U.clamp(Camera.zoom / 3, 0.35, 1);
    }
    this.last[name] = now;
    switch (name) {
      case 'chop': this.burst(0.07, 'bandpass', 900, 0.5 * v); this.tone(150, 0.1, 'sine', 0.5 * v, 70); break;
      case 'pick': this.tone(1500 + Math.random() * 300, 0.12, 'triangle', 0.3 * v, 900); this.burst(0.04, 'highpass', 3000, 0.3 * v); break;
      case 'hammer': this.tone(220, 0.07, 'square', 0.18 * v, 120); this.burst(0.04, 'bandpass', 1400, 0.3 * v); break;
      case 'shot': this.burst(0.09, 'highpass', 1800, 0.35 * v); this.tone(700, 0.08, 'sawtooth', 0.12 * v, 200); break;
      case 'hit': this.burst(0.1, 'lowpass', 500, 0.6 * v); break;
      case 'thunder': this.burst(1.8, 'lowpass', 140, 0.9); this.burst(0.5, 'lowpass', 400, 0.5, 0.05); break;
      case 'alarm': for (let k = 0; k < 3; k++) { this.tone(660, 0.16, 'square', 0.16, null, k * 0.36); this.tone(440, 0.16, 'square', 0.16, null, k * 0.36 + 0.18); } break;
      case 'ui_info': this.tone(660, 0.08, 'sine', 0.12); break;
      case 'ui_good': this.tone(523, 0.09, 'sine', 0.14); this.tone(784, 0.12, 'sine', 0.14, null, 0.09); break;
      case 'ui_warn': this.tone(392, 0.12, 'triangle', 0.2); this.tone(294, 0.18, 'triangle', 0.2, null, 0.12); break;
    }
  },
  /** Průběžné zvuky: déšť podle počasí, hukot podle běžících strojů na obrazovce. */
  update() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, paused = Game.speed === 0;
    const rain = paused || TimeSys.temp() < 0 ? 0 : Weather.rain * 0.22;
    this.rainGain.gain.setTargetAtTime(rain, t, 0.5);
    let on = 0;
    if (!paused && Renderer.view) {
      const v = Renderer.view;
      for (const i of World.machines) {
        const s = World.struct[i];
        if (!s || !s.on) continue;
        const x = i % World.w, y = (i / World.w) | 0;
        if (x >= v.tx0 && x <= v.tx1 && y >= v.ty0 && y <= v.ty1) on++;
      }
    }
    this.humGain.gain.setTargetAtTime(Math.min(0.09, on * 0.02) * U.clamp(Camera.zoom / 3, 0.3, 1), t, 0.4);
  },
};
