'use strict';
/**
 * Fire – požáry. Vznikají po zásahu bleskem, šíří se po stromech, keřích
 * a dřevěných stavbách, déšť je dusí. Kolonisté je hasí (úkol „firefight“).
 */
const Fire = {
  tiles: new Map(),      // index políčka → { t: hodin hoří }
  BURN_HOURS: 3,
  SPREAD_PER_HOUR: 0.17,

  reset() { this.tiles.clear(); },
  flammable(i) {
    const o = World.obj[i];
    if (o && (o.type === 'tree' || o.type === 'bush')) return true;
    const s = World.struct[i];
    if (s && BUILD[s.type].burns) return true;
    const f = World.floor[i];
    return !!(f && BUILD[f.type].burns);
  },
  ignite(i) {
    if (this.tiles.has(i) || !this.flammable(i)) return false;
    this.tiles.set(i, { t: 0 });
    return true;
  },
  extinguish(i) { this.tiles.delete(i); },
  burning(i) { return this.tiles.has(i); },

  /** Shoří, co na políčku hořlavého je. */
  burnDown(i) {
    const x = i % World.w, y = (i / World.w) | 0;
    const o = World.obj[i];
    if (o && (o.type === 'tree' || o.type === 'bush')) World.removeObj(i);
    const s = World.struct[i];
    if (s && BUILD[s.type].burns) {
      Game.alert(`Shořela stavba: ${BUILD[s.type].name.toLowerCase()}.`, 'warn', x, y);
      World.destroyStruct(i);
      World.replan(s);
    }
    const f = World.floor[i];
    if (f && BUILD[f.type].burns) { World.floor[i] = null; World.deconSet.delete(i); World.recalc(i); }
    World.removeCrop(i);
    Game.onTileChanged(x, y);
  },

  update(hours) {
    if (!this.tiles.size) return;
    const rain = Weather.rain, w = World.w;
    const spread = this.SPREAD_PER_HOUR * hours * Math.max(0, 1 - rain * 1.1) * (Weather.snow > 0.3 ? 0.3 : 1);
    const add = [];
    for (const [i, f] of this.tiles) {
      f.t += hours;
      if (!this.flammable(i) || U.chance(rain * 1.2 * hours)) { this.tiles.delete(i); continue; }
      if (f.t >= this.BURN_HOURS) { this.tiles.delete(i); this.burnDown(i); continue; }
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= World.n || this.tiles.has(j)) continue;
        if (this.flammable(j) && U.chance(spread)) add.push(j);
      }
    }
    for (const j of add) {
      if (this.ignite(j) && World.struct[j]) Game.alert('Hoří stavba! Kolonisté běží hasit.', 'warn', j % w, (j / w) | 0);
    }
  },
};
