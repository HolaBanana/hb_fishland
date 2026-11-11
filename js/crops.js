'use strict';
/**
 * Crops – druhy plodin. Druh se volí pro celé souvislé pole (klepnutím na pole).
 *  - brambory: spolehlivé, rostou od jara do podzimu,
 *  - kukuřice: rychlá a vydatná, ale jen v teple (léto),
 *  - zelí: pomalé, ale snese mráz – roste i v zimě venku,
 *  - léčivé byliny: suroviny na léky.
 */
const CROPS = {
  potato:  { name: 'Brambory',      hours: 42, minT: 2,  out: 'food',  n: 6, season: 'jaro až podzim', leaf: [[54, 120, 50], [74, 146, 60], [100, 170, 72]], fruit: [[216, 176, 100], [240, 236, 250]] },
  corn:    { name: 'Kukuřice',      hours: 32, minT: 12, out: 'food',  n: 9, season: 'jen v teple (léto)', leaf: [[70, 130, 40], [96, 156, 50], [130, 180, 64]], fruit: [[240, 206, 70], [250, 230, 120]] },
  cabbage: { name: 'Zelí',          hours: 50, minT: -4, out: 'food',  n: 5, season: 'celý rok, snese mráz', frost: true, leaf: [[60, 120, 90], [90, 156, 110], [140, 196, 150]], fruit: [[170, 220, 170], [200, 236, 200]] },
  herbs:   { name: 'Léčivé byliny', hours: 36, minT: 5,  out: 'herbs', n: 3, season: 'jaro až podzim', leaf: [[60, 110, 60], [84, 140, 76], [120, 170, 96]], fruit: [[170, 110, 210], [240, 236, 250]] },
};
const CROP_KEYS = Object.keys(CROPS);

const Crops = {
  def(t) { return CROPS[t] || CROPS.potato; },
  /** Roste plodina venku za daného počasí? (v zimě jen mrazuvzdorné) */
  growFactor(t, temp, roofed) {
    const d = this.def(t);
    if (!roofed && TimeSys.season === 3 && !d.frost) return 0;
    return U.clamp((temp - d.minT) / 6, 0, 1);
  },
  /** Má smysl teď zasévat? */
  canSowNow(t, i) {
    const d = this.def(t);
    if (World.roof[i]) return World.tempAt(i) > d.minT;
    if (TimeSys.season === 3 && !d.frost) return false;
    return TimeSys.temp() > d.minT - 3;
  },
  /** Výnos sklizně (bonus za dovednost farmáře). */
  yieldOf(crop, skillLvl) {
    const d = this.def(crop && crop.t);
    return { type: d.out, n: Math.max(1, Math.round(d.n * (0.85 + skillLvl * 0.04))) };
  },
};
