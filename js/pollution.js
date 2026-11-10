'use strict';
/**
 * Pollution – znečištění. Kotle a pece ho vypouštějí, šíří se po okolí a pomalu
 * mizí. Snižuje náladu a zpomaluje růst plodin. Dá se zobrazit jako vrstva na mapě.
 */
const Pollution = {
  grid: null,
  tmp: null,
  show: false,
  active: new Set(),     // políčka s nenulovým znečištěním (pro rychlý výpočet)

  reset() {
    this.grid = new Float32Array(World.n);
    this.tmp = new Float32Array(World.n);
    this.active.clear();
  },
  /** Přidá znečištění na políčko (volá se každý tick běžícího stroje). */
  add(i, amt) {
    this.grid[i] = Math.min(1.5, this.grid[i] + amt * 0.003);
    this.active.add(i);
  },
  at(i) { return this.grid[i]; },
  /** Šíření do sousedů a rozpad; volá se jednou za 60 ticků. */
  update() {
    if (!this.active.size) return;
    const g = this.grid, t = this.tmp, w = World.w, n = World.n;
    const next = new Set();
    for (const i of this.active) t[i] = 0;
    for (const i of this.active) {
      const v = g[i];
      if (v < 0.004) continue;
      const share = v * 0.045, x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      let given = 0;
      for (const j of nb) {
        if (j < 0 || j >= n) continue;
        if (!next.has(j) && !this.active.has(j)) t[j] = 0;
        t[j] += share; given += share; next.add(j);
      }
      t[i] += (v - given) * 0.985;
      next.add(i);
    }
    for (const i of this.active) if (!next.has(i)) g[i] = 0;
    for (const i of next) g[i] = t[i];
    this.active = next;
  },
  pack() {
    const out = [];
    for (const i of this.active) if (this.grid[i] >= 0.01) out.push([i, +this.grid[i].toFixed(3)]);
    return out;
  },
  unpack(arr) {
    this.reset();
    for (const [i, v] of arr || []) { this.grid[i] = v; this.active.add(i); }
  },
};
