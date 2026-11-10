'use strict';
/**
 * Save – ukládání a načítání hry.
 *  - automaticky do localStorage jednou za herní hodinu (a při opuštění stránky),
 *  - export / import do souboru JSON.
 * Mapa se neukládá celá: ze semínka se vygeneruje znovu a uloží se jen změny světa
 * (pokácené stromy, vytěžené skály, označení, stavby, plány, předměty, pole, zóny),
 * kolonisté, čas a počasí.
 */
const Save = {
  KEY: 'kolonie.save.v1',
  VERSION: 1,
  lastError: null,

  // ---------- Serializace ----------
  serialize() {
    const W = World, n = W.n;
    const CODE = { tree: 1, rock: 2, ore: 3, bush: 4 };
    const objRemoved = [], objSet = [];
    for (let i = 0; i < n; i++) {
      const o = W.obj[i], base = W.baseType[i];
      if (!o) { if (base) objRemoved.push(i); continue; }
      // nezměněné objekty se neukládají (stromy dorůstají podle uplynulého času)
      const same = CODE[o.type] === base && !o.des && (o.type !== 'bush' || o.berries);
      if (!same) objSet.push([i, o]);
    }
    const struct = [], floor = [], items = [], crops = [], bp = [], stock = [], farm = [];
    for (const i of W.structSet) { const s = W.struct[i]; struct.push([i, s.type, s.decon ? 1 : 0, s.owner]); }
    for (let i = 0; i < n; i++) {
      const f = W.floor[i];
      if (f) floor.push([i, f.type, f.decon ? 1 : 0]);
      if (W.zone[i] === 1) stock.push(i); else if (W.zone[i] === 2) farm.push(i);
    }
    for (const i of W.itemSet) { const it = W.items[i]; items.push([i, it.type, it.n, +(it.age || 0).toFixed(2)]); }
    const filter = [];
    for (const i of W.stockTiles) if (W.filter[i]) filter.push([i, W.filter[i]]);
    for (const i of W.cropSet) crops.push([i, +W.crops[i].g.toFixed(4)]);
    for (const i of W.bpSet) bp.push([i, W.bp[i].type, W.bp[i].del]);
    // pořadí množin závisí na historii → seřadit, ať je uložení deterministické
    for (const arr of [struct, items, crops, bp]) arr.sort((p, q) => p[0] - q[0]);

    return {
      v: this.VERSION,
      seed: Game.seed,
      savedAt: Date.now(),
      label: `Den ${TimeSys.day}, ${TimeSys.timeStr()}`,
      time: { minutes: TimeSys.minutes, lastHour: TimeSys.lastHour },
      weather: { cur: Weather.cur, until: Weather.until, rain: Weather.rain, cloud: Weather.cloud, fog: Weather.fog, wind: Weather.wind, snow: Weather.snow },
      rng: U.getState(),
      tick: Game.tickCount,
      speed: Game.lastSpeed,
      cam: { x: Camera.x, y: Camera.y, zoom: Camera.zoom },
      world: { objRemoved, objSet, struct, floor, items, crops, bp, stock, farm, filter },
      fire: [...Fire.tiles].map(([i, f]) => [i, +f.t.toFixed(2)]),
      animals: Animals.pack(),
      events: Events.pack(),
      stats: Game.stats,
      nextId: Game.nextId,
      colonists: Game.colonists.map(c => this.packColonist(c)),
    };
  },

  packColonist(c) {
    const skills = {};
    for (const k in c.skills) skills[k] = [c.skills[k].lvl, +c.skills[k].xp.toFixed(2)];
    return {
      id: c.id, gender: c.gender, first: c.first, last: c.last, look: c.look, trait: c.trait.id, age: c.age,
      x: c.x, y: c.y, dir: c.dir, skills, priorities: c.priorities,
      hunger: c.hunger, energy: c.energy, mood: c.mood, health: c.health, thoughts: c.thoughts,
      carry: c.carry, breakUntil: c.breakUntil,
    };
  },
  unpackColonist(d) {
    const lv = {};
    for (const k in SKILLS) lv[k] = d.skills[k] ? d.skills[k][0] : 0;
    const c = new Colonist(d.id, 0, 0, {
      gender: d.gender, first: d.first, last: d.last, look: d.look, skills: lv,
      trait: TRAITS.find(t => t.id === d.trait) || TRAITS[0], age: d.age,
    });
    for (const k in SKILLS) if (d.skills[k]) c.skills[k].xp = d.skills[k][1];
    for (const w of WORK_TYPES) if (d.priorities[w.id] !== undefined) c.priorities[w.id] = d.priorities[w.id];
    c.x = d.x; c.y = d.y; c.dir = d.dir || 'down';
    c.hunger = d.hunger; c.energy = d.energy; c.mood = d.mood; c.moodTarget = d.mood;
    c.health = d.health !== undefined ? d.health : 100;
    c.thoughts = d.thoughts || [];
    c.carry = d.carry || null;
    c.breakUntil = d.breakUntil || 0;
    if (!World.canWalk(c.tx, c.ty)) { const p = World.nearestWalkable(c.tx, c.ty); c.x = p.x + 0.5; c.y = p.y + 0.5; }
    return c;
  },

  /** Obnoví stav do čerstvě vygenerovaného světa se stejným semínkem. */
  apply(d) {
    const W = World, n = W.n, w = d.world;
    TimeSys.minutes = d.time.minutes; TimeSys.lastHour = d.time.lastHour;
    const hours = Math.max(0, (d.time.minutes - 7 * 60) / 60);

    // objekty: výchozí stav + dorůst stromů + uložené změny
    for (let i = 0; i < n; i++) {
      const o = W.obj[i];
      if (o && o.type === 'tree') o.size = Math.min(1, W.baseSize[i] + hours * Config.TREE_GROW_PER_HOUR);
    }
    for (const i of w.objRemoved) W.obj[i] = null;
    for (const [i, o] of w.objSet) W.obj[i] = o;

    // ostatní vrstvy se nahrazují celé
    W.items.fill(null); W.struct.fill(null); W.floor.fill(null); W.crops.fill(null); W.bp.fill(null); W.zone.fill(0);
    for (const [i, type, decon, owner] of w.struct) W.struct[i] = { type, decon: !!decon, owner };
    for (const [i, type, decon] of w.floor) W.floor[i] = { type, decon: !!decon };
    for (const [i, type, k, age] of w.items) W.items[i] = { type, n: k, age: age || 0 };
    W.filter.fill(0);
    for (const [i, m] of w.filter || []) W.filter[i] = m;
    for (const [i, g] of w.crops) W.crops[i] = { g };
    for (const [i, type, del] of w.bp) W.bp[i] = { type, del: del || {} };
    for (const i of w.stock) W.zone[i] = 1;
    for (const i of w.farm) W.zone[i] = 2;
    W.rebuildIndex();

    Game.res.clear(); Game.itemRes.clear();
    for (const k in Game.resType) Game.resType[k] = 0;
    Game.colonists = d.colonists.map(c => this.unpackColonist(c));
    Game.nextId = d.nextId !== undefined ? d.nextId : Math.max(-1, ...Game.colonists.map(c => c.id)) + 1;
    if (d.stats) Game.stats = Object.assign(Game.stats, d.stats);
    Fire.reset();
    for (const [i, t] of d.fire || []) Fire.tiles.set(i, { t });
    Animals.unpack(d.animals);
    Events.unpack(d.events);
    Game.tickCount = d.tick || 0;
    Game.lastSpeed = d.speed || 1;
    Object.assign(Weather, d.weather);
    if (d.cam) { Camera.zoom = d.cam.zoom; Camera.centerOn(d.cam.x, d.cam.y); }
    U.setState(d.rng);
  },

  // ---------- localStorage ----------
  valid(d) {
    return !!d && d.v === this.VERSION && Number.isFinite(d.seed) && d.world && Array.isArray(d.colonists) && d.time;
  },
  store() {
    if (Game.over || !Game.colonists.length) return false;
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.serialize()));
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = e;
      return false;
    }
  },
  /** Automatické uložení (jednou za herní hodinu). */
  auto() {
    if (!this.store() && this.lastError) Game.notifyOnce('savefail', 'Hru se nepodařilo automaticky uložit (úložiště prohlížeče není dostupné). Použij export do souboru.', 'warn', 24 * 60);
  },
  /** Vrátí uloženou hru, nebo null. */
  peek() {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY));
      return this.valid(d) ? d : null;
    } catch (e) { return null; }
  },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) { /* nic */ } },

  // ---------- Soubor ----------
  exportFile() {
    const d = this.serialize();
    const blob = new Blob([JSON.stringify(d)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kolonie-den${TimeSys.day}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  /** Načte soubor s uloženou hrou a předá data do `onLoad`. */
  importFile(file, onLoad, onError) {
    const r = new FileReader();
    r.onerror = () => onError('Soubor se nepodařilo přečíst.');
    r.onload = () => {
      let d = null;
      try { d = JSON.parse(r.result); } catch (e) { /* neplatný JSON */ }
      if (!this.valid(d)) { onError('Tohle není platná uložená hra Kolonie.'); return; }
      onLoad(d);
    };
    r.readAsText(file);
  },
};
