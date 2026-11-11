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
      if (h === 6) {
        UI.toast(`Svítá – začíná ${this.day}. den.`, 'info');
        if ((this.day - 1) % Config.SEASON_DAYS === 0 && this.day > 1) {
          const msg = ['Přišlo jaro. Pole se dají znovu osít.', 'Začíná léto.', 'Začíná podzim. Zima přijde za ' + Config.SEASON_DAYS + ' dny – udělej zásoby jídla!', 'Přišla zima! Plodiny nerostou a keře neplodí.'][this.season];
          UI.toast(msg, this.season === 3 ? 'warn' : 'good');
        }
      }
    }
  },
  get day() { return Math.floor(this.minutes / 1440) + 1; },
  /** 0 jaro, 1 léto, 2 podzim, 3 zima */
  get season() { return Math.floor((this.day - 1) / Config.SEASON_DAYS) % 4; },
  get year() { return Math.floor((this.day - 1) / (Config.SEASON_DAYS * 4)) + 1; },
  get seasonName() { return SEASONS[this.season]; },
  /** Venkovní teplota ve °C: roční průběh + denní cyklus + počasí. */
  temp() {
    // opěrné body: začátek a střed každého období (jaro, léto, podzim, zima)
    const K = [7, 13, 20, 25, 16, 9, 0, -7];
    const yearLen = Config.SEASON_DAYS * 4 * 1440;
    const p = ((this.minutes - 7 * 60) % yearLen + yearLen) % yearLen / yearLen * 8;
    const a = Math.floor(p) % 8, f = p - Math.floor(p);
    const base = K[a] + (K[(a + 1) % 8] - K[a]) * f;
    const daily = 4 * Math.sin((this.hour - 9) / 24 * Math.PI * 2);
    return base + daily - Weather.rain * 2 - Weather.cloud;
  },
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
    rain:   { name: 'Déšť',    snowName: 'Sněžení', icon: '🌧️', rain: 0.6, cloud: 0.85, fog: 0.1 },
    storm:  { name: 'Bouřka',  snowName: 'Vánice', icon: '⛈️', rain: 1,   cloud: 1,    fog: 0.15 },
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
  snow: 0,             // sněhová pokrývka 0..1

  reset() {
    this.cur = 'clear'; this.until = TimeSys.minutes + 60 * U.range(5, 9);
    this.rain = 0; this.cloud = 0; this.fog = 0; this.flash = 0; this.snow = 0;
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
    // sníh: padá při srážkách pod nulou, taje nad nulou
    const t = TimeSys.temp();
    if (t < 0) this.snow = Math.min(1, this.snow + (0.00004 + this.rain * 0.0012));
    else if (t > 1) this.snow = Math.max(0, this.snow - 0.0002 * (t - 1));
    if (this.cur === 'storm' && this.rain > 0.6 && t > 2 && U.chance(0.0025)) {
      this.flash = 1;
      Sound.play('thunder');
      // blesk může zapálit strom → požár
      if (U.chance(0.3)) this.strike();
    }
  },
  strike() {
    for (let k = 0; k < 20; k++) {
      const x = U.int(0, World.w - 1), y = U.int(0, World.h - 1), i = World.idx(x, y);
      const o = World.obj[i];
      if (o && o.type === 'tree') {
        Fire.ignite(i);
        const near = Math.hypot(x - World.start.x, y - World.start.y) < 40;
        if (near) Game.alert('Blesk zapálil strom poblíž kolonie! Kolonisté běží hasit.', 'warn', x, y);
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
      const cold = TimeSys.temp() < 0;
      const msg = { rain: cold ? 'Začíná sněžit.' : 'Začíná pršet. Úroda poroste rychleji.', storm: cold ? 'Přichází vánice!' : 'Blíží se bouřka!', fog: 'Krajinu zahalila mlha.', clear: 'Vyjasnilo se.', cloudy: 'Zatáhlo se.' }[next];
      UI.toast(msg, next === 'storm' ? 'warn' : 'info');
    }
  },
};
