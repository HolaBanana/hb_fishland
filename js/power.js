'use strict';
/**
 * Power – energetické sítě. Zdroje (vodní kolo, větrník, kotel) a sloupy se
 * propojí, když jsou od sebe do POWER_LINK políček; stroj je napájen ze sítě,
 * jejíž zdroj nebo sloup má do POWER_REACH políček. Při nedostatku energie
 * běží stroje úměrně pomaleji, bez energie stojí.
 */
const Power = {
  dirty: true,
  nets: [],            // {supply, demand, factor, gens:[], users:[]}
  netOf: new Map(),    // index stavby → síť
  supply: 0, demand: 0,

  reset() { this.dirty = true; this.nets = []; this.netOf.clear(); this.supply = 0; this.demand = 0; },

  dist(a, b) {
    // vzdálenost mezi obrysy staveb (Čebyšev)
    let best = Infinity;
    const w = World.w;
    for (const p of a.tiles) for (const q of b.tiles) {
      const d = Math.max(Math.abs((p % w) - (q % w)), Math.abs(((p / w) | 0) - ((q / w) | 0)));
      if (d < best) best = d;
    }
    return best;
  },

  rebuild() {
    this.dirty = false;
    this.nets = []; this.netOf.clear();
    const trans = [], users = [];
    for (const i of World.machines) {
      const s = World.struct[i], m = BUILD[s.type].machine;
      if (m.gen || m.pole) trans.push(s);
      else if (m.power) users.push(s);
    }
    // sjednocení propojených zdrojů a sloupů
    const parent = trans.map((_, k) => k);
    const find = (k) => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
    for (let a = 0; a < trans.length; a++) for (let b = a + 1; b < trans.length; b++) {
      if (this.dist(trans[a], trans[b]) <= Config.POWER_LINK) parent[find(a)] = find(b);
    }
    const byRoot = new Map();
    trans.forEach((s, k) => {
      const r = find(k);
      if (!byRoot.has(r)) { const net = { supply: 0, demand: 0, factor: 0, gens: [], poles: [], users: [] }; byRoot.set(r, net); this.nets.push(net); }
      const net = byRoot.get(r);
      (BUILD[s.type].machine.gen ? net.gens : net.poles).push(s);
      this.netOf.set(s.i, net);
    });
    for (const u of users) {
      let best = null, bd = Config.POWER_REACH + 1;
      for (const t of trans) { const d = this.dist(u, t); if (d < bd) { bd = d; best = t; } }
      if (best) { const net = this.netOf.get(best.i); net.users.push(u); this.netOf.set(u.i, net); }
    }
  },

  /** Okamžitý výkon zdroje. */
  output(s) {
    const m = BUILD[s.type].machine;
    if (s.decon || s.broken) return 0;
    if (m.gen === 'water') return TimeSys.temp() < -2 ? 0 : m.supply;
    if (m.gen === 'wind') return Math.round(m.supply * Math.min(1, 0.15 + Math.abs(Weather.wind) * 0.9 + Weather.rain * 0.25));
    if (m.gen === 'boiler') return s.burn > 0 ? m.supply : 0;
    return 0;
  },
  genStatus(s) {
    const m = BUILD[s.type].machine, out = this.output(s);
    if (s.broken) return 'Porucha – čeká na opravu';
    if (m.gen === 'water' && !out) return 'Zamrzlé – bez výkonu';
    if (m.gen === 'boiler' && !out) return (s.inv.wood || 0) > 0 ? 'Připraven (není odběr)' : 'Chybí palivo (dřevo)';
    return `Vyrábí ${out} ⚡`;
  },

  /** Volá se každých pár ticků: spočítá výrobu a spotřebu každé sítě. */
  update(ticks) {
    if (this.dirty) this.rebuild();
    this.supply = 0; this.demand = 0;
    for (const net of this.nets) {
      let demand = 0;
      for (const u of net.users) if (u.want && !u.decon && !u.broken) demand += BUILD[u.type].machine.power;
      let supply = 0;
      for (const g of net.gens) {
        const m = BUILD[g.type].machine;
        if (m.gen === 'boiler') {
          // kotel topí jen při odběru; dřevo přikládá ze zásobníku
          if (demand > 0 && g.burn <= 0 && (g.inv.wood || 0) >= 1) { g.inv.wood--; g.burn = m.burnMin; }
          if (g.burn > 0 && demand > 0) { g.burn -= ticks * Config.MIN_PER_TICK; Pollution.add(g.i, m.pollute * ticks); }
          g.on = g.burn > 0 && demand > 0;
        } else g.on = true;
        if (g.on && !g.broken && demand > 0) Maintenance.wearTime(g, ticks);
        supply += this.output(g);
      }
      net.supply = supply; net.demand = demand;
      net.factor = demand <= 0 ? (supply > 0 ? 1 : 0) : Math.min(1, supply / demand);
      this.supply += supply; this.demand += demand;
    }
  },
  /** Podíl energie, který stroj právě dostává (0 = stojí). */
  factor(s) {
    const net = this.netOf.get(s.i);
    return net ? net.factor : 0;
  },
};
