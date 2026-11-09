'use strict';
/**
 * TimeSys – herní čas a střídání dne a noci.
 * Weather – počasí s plynulými přechody (jasno, oblačno, déšť, bouřka, mlha).
 */
const TimeSys = {
  minutes: 7 * 60,   // začínáme 1. den v 7:00
  lastHour: 7,

  reset() { this.minutes = 7 * 60; this.lastHour = 7; },
  tick() {
    this.minutes += Config.MIN_PER_TICK;
    const h = Math.floor(this.hour);
    if (h !== this.lastHour) {
      this.lastHour = h;
      if (h === 20) UI.toast('Stmívá se. Kolonisté se brzy půjdou vyspat.', 'info');
      if (h === 6) UI.toast(`Svítá – začíná ${this.day}. den.`, 'info');
    }
  },
  get day() { return Math.floor(this.minutes / 1440) + 1; },
  get hour() { return (this.minutes % 1440) / 60; },
  isNight() { const h = this.hour; return h >= 22 || h < 6; },
  /** 0 = noc, 1 = plný den */
  daylight() {
    const h = this.hour;
    if (h >= 7 && h < 18) return 1;
    if (h >= 18 && h < 20.5) return 1 - (h - 18) / 2.5;
    if (h >= 4.5 && h < 7) return (h - 4.5) / 2.5;
    return 0;
  },
  /** síla západu / východu slunce (oranžový nádech) */
  dusk() {
    const h = this.hour;
    const a = Math.max(0, 1 - Math.abs(h - 18.8) / 1.6);
    const b = Math.max(0, 1 - Math.abs(h - 5.8) / 1.3);
    return Math.max(a, b);
  },
  timeStr() {
    const h = Math.floor(this.hour), m = Math.floor(this.minutes % 60);
    return U.pad2(h) + ':' + U.pad2(Math.floor(m / 10) * 10);
  },
};

const Weather = {
  TYPES: {
    clear:  { name: 'Jasno',   icon: '☀️', rain: 0,   cloud: 0,    fog: 0 },
    cloudy: { name: 'Oblačno', icon: '⛅', rain: 0,   cloud: 0.65, fog: 0 },
    rain:   { name: 'Déšť',    icon: '🌧️', rain: 0.6, cloud: 0.85, fog: 0.1 },
    storm:  { name: 'Bouřka',  icon: '⛈️', rain: 1,   cloud: 1,    fog: 0.15 },
    fog:    { name: 'Mlha',    icon: '🌫️', rain: 0,   cloud: 0.3,  fog: 1 },
  },
  NEXT: {
    clear:  { clear: 3, cloudy: 4, fog: 1 },
    cloudy: { clear: 3, cloudy: 1, rain: 3, storm: 1, fog: 1 },
    rain:   { cloudy: 3, rain: 1, storm: 1, clear: 1 },
    storm:  { rain: 3, cloudy: 2 },
    fog:    { clear: 3, cloudy: 2 },
  },
  cur: 'clear', until: 0,
  rain: 0, cloud: 0, fog: 0,
  wind: 0.4, flash: 0,

  reset() {
    this.cur = 'clear'; this.until = TimeSys.minutes + 60 * U.range(5, 9);
    this.rain = 0; this.cloud = 0; this.fog = 0; this.flash = 0;
  },
  get def() { return this.TYPES[this.cur]; },
  tick() {
    if (TimeSys.minutes >= this.until) this.change();
    const d = this.def, k = 0.004;
    this.rain += (d.rain - this.rain) * k;
    this.cloud += (d.cloud - this.cloud) * k;
    this.fog += (d.fog - this.fog) * k;
    this.wind += (U.rand() - 0.5) * 0.004;
    this.wind = U.clamp(this.wind, -0.9, 0.9);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.06);
    if (this.cur === 'storm' && this.rain > 0.6 && U.chance(0.0025)) {
      this.flash = 1;
      // blesk může zapálit / zničit osamělý strom
      if (U.chance(0.25)) this.strike();
    }
  },
  strike() {
    for (let k = 0; k < 20; k++) {
      const x = U.int(0, World.w - 1), y = U.int(0, World.h - 1), i = World.idx(x, y);
      const o = World.obj[i];
      if (o && o.type === 'tree') {
        World.removeObj(i);
        World.dropItem(x, y, 'wood', 3);
        UI.toast('Blesk udeřil do stromu!', 'warn');
        return;
      }
    }
  },
  change() {
    const opts = this.NEXT[this.cur];
    let total = 0;
    for (const k in opts) total += opts[k];
    let r = U.rand() * total;
    let next = 'clear';
    for (const k in opts) { r -= opts[k]; if (r <= 0) { next = k; break; } }
    const prev = this.cur;
    this.cur = next;
    this.until = TimeSys.minutes + 60 * U.range(3, 10);
    if (next !== prev) {
      const msg = { rain: 'Začíná pršet. Úroda poroste rychleji.', storm: 'Blíží se bouřka!', fog: 'Krajinu zahalila mlha.', clear: 'Vyjasnilo se.', cloudy: 'Zatáhlo se.' }[next];
      UI.toast(msg, next === 'storm' ? 'warn' : 'info');
    }
  },
};
