'use strict';
/**
 * Machines – stavby s vlastním stavem a tickem volaným z Game.tick:
 *  - dílny obsluhované kolonistou (pila, pec) – jen drží zásobník a postup,
 *  - automatické stroje (vrták, automatická pila, pec s podavačem),
 *  - dopravní pásy,
 *  - zdroje energie (počítá je Power).
 * Stav stavby: s.inv (vstupy), s.out (výstupy čekající na vyložení), s.prog (0..1),
 * s.dir (směr výstupu), s.target (cílová zásoba u dílen), s.msg (stav pro UI).
 */
const Machines = {
  PULL_PERIOD: 15,
  OUT_CAP: 6,

  def(s) { return BUILD[s.type].machine; },
  init(s) {
    const m = BUILD[s.type].machine;
    if (!m) return;
    if (!s.inv) s.inv = {};
    if (!s.out) s.out = {};
    if (s.prog === undefined) s.prog = 0;
    if (m.target !== undefined && s.target === undefined) s.target = m.target;
    if (m.gen === 'boiler' && s.burn === undefined) s.burn = 0;
    s.msg = '';
  },
  /** Kolik kusů vstupu `type` se do zásobníku ještě vejde. */
  room(s, type) {
    const m = this.def(s);
    if (!m) return 0;
    let cap = 0;
    for (const r of this.recipes(m)) if (r.in[type]) cap = Math.max(cap, r.in[type] * 6);
    if (cap) { /* vstup některého receptu */ }
    else if (m.fuel === type) cap = 12;
    else if (m.ammo === type) cap = 30;
    return Math.max(0, cap - (s.inv[type] || 0));
  },
  /** Všechny recepty stavby (hlavní + alternativní). */
  recipes(m) { return m.recipe ? [m.recipe].concat(m.alts || []) : []; },
  hasInputs(s, r) {
    for (const k in r.in) if ((s.inv[k] || 0) < r.in[k]) return false;
    return true;
  },
  /** Recept, na který má stavba v zásobníku dost surovin (nebo null). */
  readyRecipe(s) {
    for (const r of this.recipes(this.def(s))) if (this.hasInputs(s, r)) return r;
    return null;
  },
  canCraft(s) { return !!this.readyRecipe(s); },
  /** Dokončí jeden výrobní cyklus: spotřebuje vstupy, vrátí výstupy. */
  craft(s) {
    const r = this.readyRecipe(s);
    for (const k in r.in) s.inv[k] -= r.in[k];
    s.prog = 0;
    return r.out;
  },
  /** Políčka sousedící se stavbou (bez políčka výstupu). */
  sides(s) {
    const out = [], w = World.w, front = BUILD[s.type].rot ? World.step(s.i, s.dir) : -1;
    const own = new Set(s.tiles);
    for (const t of s.tiles) {
      const x = t % w;
      for (const q of [x > 0 ? t - 1 : -1, x < w - 1 ? t + 1 : -1, t - w, t + w]) {
        if (q < 0 || q >= World.n || own.has(q) || q === front || out.includes(q)) continue;
        out.push(q);
      }
    }
    return out;
  },

  /**
   * Vloží předměty na cílové políčko: do stroje, truhly, na pás nebo na zem.
   * Vrací počet skutečně přesunutých kusů.
   */
  pushTo(i, type, n, age = 0) {
    if (i < 0) return 0;
    const s = World.struct[i];
    if (s) {
      const m = BUILD[s.type].machine;
      if (m && m.belt) {
        const it = World.items[i];
        if (it && it.type !== type) return 0;
        const k = Math.min(n, Config.BELT_STACK - (it ? it.n : 0));
        if (k > 0) World.addAt(i, type, k, age);
        return Math.max(0, k);
      }
      if (m) {
        const k = Math.min(n, this.room(s, type));
        if (k > 0) s.inv[type] = (s.inv[type] || 0) + k;
        return k;
      }
      if (BUILD[s.type].storage) return World.allowed(i, type) ? n - World.putItem(i, type, n, age) : 0;
      return 0;
    }
    if (!World.canHoldItem(i)) return 0;
    const it = World.items[i];
    if (it && it.type !== type) return 0;
    const k = Math.min(n, Config.STACK - (it ? it.n : 0));
    if (k > 0) World.addAt(i, type, k, age);
    return Math.max(0, k);
  },

  /** Stroj si vezme vstupy ze sousedních políček (země, sklad, truhla, pás). */
  pull(s) {
    const m = this.def(s);
    const want = m.recipe ? [].concat(...this.recipes(m).map(r => Object.keys(r.in))) : m.fuel ? [m.fuel] : m.ammo ? [m.ammo] : [];
    if (!want.length) return;
    for (const q of this.sides(s)) {
      const it = World.items[q];
      if (!it || !want.includes(it.type)) continue;
      const k = Math.min(this.room(s, it.type), Game.availItem(q), 4);
      if (k <= 0) continue;
      const type = it.type;
      World.takeItem(q, k);
      s.inv[type] = (s.inv[type] || 0) + k;
    }
  },
  /** Vyloží hotové výrobky na políčko ve směru otočení. */
  eject(s) {
    const front = World.step(s.i, s.dir);
    let left = 0;
    for (const k in s.out) {
      if (s.out[k] < 1) continue;
      s.out[k] -= this.pushTo(front, k, Math.floor(s.out[k]));
      left += s.out[k];
    }
    return left;
  },

  tick() {
    const t = Game.tickCount;
    if (t % Config.BELT_PERIOD === 0) this.tickBelts();
    for (const i of World.machines) {
      const s = World.struct[i];
      if (!s || s.decon) continue;
      const m = BUILD[s.type].machine;
      if (m.manual || m.pole || m.rail || m.stop) continue;
      if (m.turret) { if (t % this.PULL_PERIOD === 0) this.pull(s); continue; }
      if (m.gen) { if (m.fuel && t % this.PULL_PERIOD === 0) this.pull(s); continue; }
      if (s.broken) { s.on = false; s.want = false; continue; }
      // --- automatický stroj ---
      if (t % this.PULL_PERIOD === 0) { this.pull(s); this.eject(s); }
      let outN = 0;
      for (const k in s.out) outN += s.out[k];
      let ready = outN < this.OUT_CAP;
      if (!ready) s.msg = 'Výstup je plný – není kam vykládat';
      if (ready && m.drill) {
        const o = World.obj[i];
        if (!o || o.type !== 'ore' || o.amount <= 0) { ready = false; s.msg = 'Ložisko je vyčerpané'; }
      } else if (ready && !this.canCraft(s)) { ready = false; s.msg = 'Chybí vstupní suroviny'; }
      s.want = ready;
      if (!ready) { s.on = false; continue; }
      const p = Power.factor(s);
      s.on = p > 0.05;
      if (!s.on) { s.msg = 'Bez energie'; continue; }
      s.msg = p < 0.99 ? `Běží na ${Math.round(p * 100)} % (málo energie)` : 'Běží';
      s.prog += p / (m.drill ? m.work : m.recipe.work);
      if (m.pollute) Pollution.add(i, m.pollute * p);
      if (s.prog >= 1) {
        if (m.drill) {
          const o = World.obj[i];
          s.prog = 0;
          o.amount--;
          s.out.ore = (s.out.ore || 0) + 1;
          if (o.amount <= 0) { World.removeObj(i); Game.alert('Vrták vyčerpal ložisko rudy.', 'info', i % World.w, (i / World.w) | 0); }
        } else {
          const out = this.craft(s);
          for (const k in out) s.out[k] = (s.out[k] || 0) + out[k];
        }
        Game.stats.machined++;
        Maintenance.wear(s);
        this.eject(s);
      }
    }
  },

  /** Posun pásů: každá hromádka se za jeden krok posune nejvýš o jedno políčko. */
  tickBelts() {
    if (!World.belts.size) return;
    const got = new Set();
    for (const i of World.belts) {
      const it = World.items[i];
      if (!it || got.has(i)) continue;
      const s = World.struct[i];
      const n = Math.min(it.n, Config.BELT_RATE);
      const kind = BUILD[s.type].machine.kind;
      let targets;
      if (kind === 'splitter') {
        // střídavě rovně, vpravo, vlevo; obsazený směr se přeskočí
        const opts = [s.dir, (s.dir + 1) % 4, (s.dir + 3) % 4], r = s.rr || 0;
        targets = [0, 1, 2].map(k => World.step(i, opts[(r + k) % 3]));
      } else if (kind === 'sorter') {
        targets = [World.step(i, !s.filter || it.type === s.filter ? s.dir : (s.dir + 1) % 4)];
      } else if (kind === 'tunnel') {
        targets = [this.tunnelExit(i, s.dir)];
      } else targets = [World.step(i, s.dir)];
      for (let q = 0; q < targets.length; q++) {
        const k = this.pushTo(targets[q], it.type, n, it.age);
        if (k > 0) {
          World.takeItem(i, k); got.add(targets[q]);
          if (kind === 'splitter') s.rr = ((s.rr || 0) + q + 1) % 3;
          break;
        }
      }
    }
  },
  /** Výjezd podzemního pásu: další tunel stejného směru do 6 políček, jinak políčko před vjezdem. */
  tunnelExit(i, dir) {
    let q = i;
    for (let d = 1; d <= 6; d++) {
      q = World.step(q, dir);
      if (q < 0) break;
      const s = World.struct[q];
      if (d >= 2 && s && s.type === 'tunnel' && s.dir === dir) return q;
    }
    return World.step(i, dir);
  },

  /** Popis stavu stroje pro informační panel. */
  status(s) {
    const m = this.def(s);
    if (!m) return '';
    if (m.manual) return this.canCraft(s) ? 'Čeká na řemeslníka' : 'Čeká na suroviny';
    if (m.gen) return Power.genStatus(s);
    if (m.belt) return 'Směr ' + ['→', '↓', '←', '↑'][s.dir] + (m.kind === 'sorter' ? `, rovně pouští: ${s.filter ? ITEMS[s.filter].name.toLowerCase() : 'vše'}` : '');
    if (m.rail) return 'Kolej';
    if (m.stop) { const c = Carts.list.find(q => q.home === s.i); return s.unload ? 'Vykládací zastávka' : 'Nakládací zastávka' + (c ? ` – vozík ${{ load: 'nakládá', go: 'jede', unload: 'vykládá', back: 'se vrací' }[c.state]}` + (c.cargo ? ` (${ITEMS[c.cargo.type].name.toLowerCase()} ${c.cargo.n})` : '') : ''); }
    if (m.pole) return 'Vede energii';
    if (s.broken) return 'Porucha – čeká na opravu (1 železný plát)';
    if (m.turret) return (s.inv.ammo || 0) >= 1 ? `Připravena, munice ${Math.floor(s.inv.ammo)}` : 'Bez munice';
    return s.msg || '';
  },
};

/**
 * Maintenance – opotřebení strojů. Provozem se stroj opotřebovává; při nulovém
 * stavu se zastaví a kolonista ho musí opravit (práce Údržba, 1 železný plát).
 */
const Maintenance = {
  LIFE: 260,                 // výrobků do poruchy
  GEN_TICKS: 600 * 24 * 6,   // doba provozu zdroje do poruchy
  add(s, amt) {
    s.wear = (s.wear || 0) + amt;
    if (s.wear >= 1 && !s.broken) {
      s.broken = true; s.on = false;
      s.msg = 'Porucha – čeká na opravu (1 železný plát)';
      Power.dirty = true;
      Game.alert(`Porucha: ${BUILD[s.type].name.toLowerCase()} potřebuje opravu.`, 'warn', s.i % World.w, (s.i / World.w) | 0);
    }
  },
  wear(s) { this.add(s, 1 / this.LIFE); },
  wearTime(s, ticks) { this.add(s, ticks / this.GEN_TICKS); },
  repair(s) { s.wear = 0; s.broken = false; s.msg = ''; Power.dirty = true; },
  /** Stav 0..1 (1 = jako nový). */
  condition(s) { return 1 - Math.min(1, s.wear || 0); },
};
