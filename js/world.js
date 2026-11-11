'use strict';
/**
 * World – mřížka mapy, generování terénu, objekty, stavby, předměty a zóny.
 * Indexy políček: i = y * w + x
 */
const World = {
  w: 0, h: 0, n: 0, seed: 0,

  // ---------- Inicializace ----------
  alloc(w, h) {
    this.w = w; this.h = h; this.n = w * h;
    const n = this.n;
    this.terrain = new Uint8Array(n);
    this.obj = new Array(n).fill(null);     // {type, des, size, berries, regrow, amount}
    this.struct = new Array(n).fill(null);  // {type, decon, owner, i, dir, tiles, + stav stroje}; u větších staveb sdílí objekt všechna políčka
    this.floor = new Array(n).fill(null);   // {type, decon}
    this.items = new Array(n).fill(null);   // {type, n, age} – age = stáří v hodinách (kažení)
    this.crops = new Array(n).fill(null);   // {g}
    this.bp = new Array(n).fill(null);      // {type, del:{}, i, dir, tiles}
    this.zone = new Uint8Array(n);          // 0 nic, 1 sklad, 2 pole
    this.filter = new Uint16Array(n);       // filtr surovin skladu (0 = vše)
    this.roof = new Uint8Array(n);          // 1 = pod střechou (uzavřená místnost)
    this.roomId = new Int16Array(n);        // index do rooms, -1 = venku
    this.rooms = [];
    this.roomsDirty = true;
    this.walk = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.variant = new Uint8Array(n);

    // výchozí stav objektů po vygenerování (pro ukládání rozdílů)
    this.baseType = new Uint8Array(n);
    this.baseSize = new Float32Array(n);
    this.resetIndex();
  },

  /** Průběžně udržované indexy – počty surovin a seznamy úkolů. */
  resetIndex() {
    this.itemSet = new Set();
    this.looseSet = new Set();      // hromádky mimo sklad (k odnesení)
    this.counts = {};
    for (const k of ITEM_KEYS) this.counts[k] = 0;
    this.itemVer = 0;               // zvýší se při každé změně předmětů / zón
    this.bpSet = new Set();
    this.desSet = new Set();        // všechna označení (pro vykreslení)
    this.des = { chop: new Set(), mine: new Set(), harvest: new Set() };
    this.deconSet = new Set();
    this.cropSet = new Set();
    this.ripeSet = new Set();       // zralá pole ke sklizni
    this.emptyFarm = new Set();     // políčka pole bez plodiny (k osetí)
    this.structSet = new Set();
    this.structBy = {};             // typ stavby → Set indexů
    this.lights = new Set();        // stavby, které svítí
    this.machines = new Set();      // stavby s vlastním tickem (stroje, pásy, zdroje)
    this.belts = new Set();
    this.bushSet = new Set();
    this.stockTiles = [];
    this.farmTiles = [];
  },

  /** Přepočítá všechny indexy ze surových polí (po načtení uložené hry). */
  rebuildIndex() {
    this.resetIndex();
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (it) { this.itemSet.add(i); this.counts[it.type] += it.n; }
      if (this.bp[i] && this.bp[i].i === i) this.bpSet.add(i);
      const o = this.obj[i];
      if (o) {
        if (o.type === 'bush') this.bushSet.add(i);
        if (o.des) { this.desSet.add(i); this.des[o.des].add(i); }
      }
      const s = this.struct[i];
      if (s && s.i === i) this.indexStruct(i, s.type, true);
      if (s && s.decon) this.deconSet.add(s.i);
      else if (!s && this.floor[i] && this.floor[i].decon) this.deconSet.add(i);
      const c = this.crops[i];
      if (c) { this.cropSet.add(i); if (c.g >= 1) this.ripeSet.add(i); }
      this.recalc(i);
    }
    this.rebuildZones();
    this.roomsDirty = true;
  },
  indexStruct(i, type, add) {
    this.roomsDirty = true;
    Power.dirty = true;
    if (add) {
      this.structSet.add(i);
      (this.structBy[type] || (this.structBy[type] = new Set())).add(i);
      if (BUILD[type].light) this.lights.add(i);
      const m = BUILD[type].machine;
      if (m) { if (m.belt) this.belts.add(i); else this.machines.add(i); }
    } else {
      this.machines.delete(i); this.belts.delete(i);
      this.structSet.delete(i);
      if (this.structBy[type]) this.structBy[type].delete(i);
      this.lights.delete(i);
    }
  },

  idx(x, y) { return y * this.w + x; },
  xy(i) { return [i % this.w, (i / this.w) | 0]; },
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; },

  // ---------- Generování mapy ----------
  generate(seed, opts) {
    this.seed = seed;
    const o = this.opts = Object.assign(NEWGAME.defaults(), opts);
    const w = NEWGAME.size[o.size].n, h = w;
    this.alloc(w, h);
    const n = this.n;
    const elev = new Float32Array(n), moist = new Float32Array(n), forest = new Float32Array(n), oreN = new Float32Array(n);

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // mírné zakřivení souřadnic – přirozenější tvary
      const wx = x + (U.noise(x / 20, y / 20, seed + 9) - 0.5) * 14;
      const wy = y + (U.noise(x / 20, y / 20, seed + 19) - 0.5) * 14;
      elev[i] = U.fbm(wx / 30, wy / 30, seed, 5);
      moist[i] = U.fbm(x / 15 + 40, y / 15 + 40, seed + 77, 4);
      forest[i] = U.fbm(x / 11, y / 11, seed + 155, 3);
      oreN[i] = U.fbm(x / 5, y / 5, seed + 301, 2);
      this.variant[i] = (U.hash2(x, y, seed + 5) * 256) | 0;
    }
    // prahy podle kvantilů → stabilní složení mapy pro libovolné semínko
    const q = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.floor(p * (s.length - 1))]; };
    const qw = NEWGAME.water[o.water];
    const eWater = q(elev, qw), eShallow = q(elev, qw + 0.03), eSand = q(elev, qw + 0.06), eRock = q(elev, NEWGAME.rock[o.rock]);
    const mSoil = q(moist, 0.78), mDirt = q(moist, 0.08);
    const fTree = q(forest, NEWGAME.forest[o.forest]);

    for (let i = 0; i < n; i++) {
      const e = elev[i];
      if (e < eWater) this.terrain[i] = T.WATER;
      else if (e < eShallow) this.terrain[i] = T.SHALLOW;
      else if (e < eSand) this.terrain[i] = T.SAND;
      else if (e > eRock) {
        this.terrain[i] = T.GRAVEL;
        this.obj[i] = { type: 'rock', des: null };
      } else {
        const m = moist[i];
        this.terrain[i] = m > mSoil ? T.SOIL : m < mDirt ? T.DIRT : T.GRASS;
        if (e > eRock - 0.012) this.terrain[i] = T.GRAVEL; // podhůří
      }
    }
    // železná ruda uvnitř hor
    const rockIdx = [];
    for (let i = 0; i < n; i++) if (this.obj[i]) rockIdx.push(i);
    const rockOre = rockIdx.map(i => oreN[i]);
    const oreT = rockOre.length ? q(rockOre, 0.9) : 1;
    for (const i of rockIdx) if (oreN[i] > oreT) { this.obj[i].type = 'ore'; this.obj[i].amount = Config.ORE_AMOUNT; }

    // stromy a keře
    for (let i = 0; i < n; i++) {
      const t = this.terrain[i];
      if (this.obj[i] || !(t === T.GRASS || t === T.SOIL || t === T.DIRT)) continue;
      const [x, y] = this.xy(i);
      const r = U.hash2(x, y, seed + 999);
      if ((forest[i] > fTree && r < 0.5 + (forest[i] - fTree) * 2) || r < 0.025) {
        this.obj[i] = { type: 'tree', des: null, size: 0.7 + U.hash2(x, y, seed + 3) * 0.3 };
      } else if (r > 0.988) {
        this.obj[i] = { type: 'bush', des: null, berries: true, regrow: 0 };
      }
    }

    for (let i = 0; i < n; i++) {
      if (this.obj[i] && this.obj[i].type === 'bush') this.bushSet.add(i);
      this.recalc(i);
    }
    this.start = this.findStart();
    this.prepareStart();
    const CODE = { tree: 1, rock: 2, ore: 3, bush: 4 };
    for (let i = 0; i < n; i++) {
      const o = this.obj[i];
      this.baseType[i] = o ? CODE[o.type] : 0;
      this.baseSize[i] = o && o.size ? o.size : 0;
    }
  },

  findStart() {
    const cx = this.w >> 1, cy = this.h >> 1;
    const ok = (x, y) => {
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        if (!this.inb(x + dx, y + dy)) return false;
        const i = this.idx(x + dx, y + dy);
        const t = this.terrain[i];
        if (t === T.WATER || t === T.SHALLOW) return false;
        const o = this.obj[i];
        if (o && (o.type === 'rock' || o.type === 'ore')) return false;
      }
      return true;
    };
    for (let r = 0; r < 50; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ok(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
    return { x: cx, y: cy };
  },

  prepareStart() {
    const { x: sx, y: sy } = this.start;
    // vyčistit malou mýtinu
    for (let dy = -4; dy <= 5; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = sx + dx, y = sy + dy;
      if (!this.inb(x, y)) continue;
      const i = this.idx(x, y);
      const o = this.obj[i];
      if (o && (o.type === 'tree' || o.type === 'bush') && Math.hypot(dx, dy) < 4.5) this.removeObj(i);
      if (this.terrain[i] === T.WATER || this.terrain[i] === T.SHALLOW || this.terrain[i] === T.SAND) this.terrain[i] = T.GRASS;
      if (this.terrain[i] === T.GRAVEL && !this.obj[i]) this.terrain[i] = T.DIRT;
      this.recalc(i);
    }
    // startovní sklad
    for (let y = sy + 2; y <= sy + 4; y++) for (let x = sx - 2; x <= sx + 3; x++) {
      const i = this.idx(x, y);
      if (this.walk[i] && !this.obj[i]) this.zone[i] = 1;
    }
    this.rebuildZones();
    // startovní zásoby – každá hromádka na vlastní políčko skladu; když sklad
    // nemá dost místa (stísněný start), položí se zbytek volně do okolí
    const st = this.stockTiles;
    const put = (k, type, n) => {
      if (st[k] !== undefined && !this.items[st[k]]) n = this.putItem(st[k], type, n);
      if (n > 0) this.dropItem(sx, sy + 1, type, n);
    };
    const m = NEWGAME.difficulty[this.opts.difficulty].supplies;
    put(0, 'wood', 75); put(1, 'wood', Math.round(75 * Math.min(1, m))); put(2, 'wood', Math.round(30 * m));
    put(3, 'meal', Math.round(18 * m)); put(4, 'food', Math.round(30 * m)); put(5, 'stone', Math.round(20 * m));
  },

  // ---------- Průchodnost ----------
  recalc(i) {
    const t = TERRAIN[this.terrain[i]];
    let walk = t.walk, cost = t.cost;
    const o = this.obj[i];
    if (o) { const d = OBJECTS[o.type]; if (d.blocks) walk = false; else cost *= d.cost; }
    const s = this.struct[i];
    if (s) { const d = BUILD[s.type]; if (d.blocks) walk = false; else if (d.walkCost) cost *= d.walkCost; }
    if (this.floor[i]) cost *= 0.75;
    this.walk[i] = walk ? 1 : 0;
    this.cost[i] = cost;
  },
  canWalk(x, y) { return this.inb(x, y) && this.walk[this.idx(x, y)] === 1; },

  nearestWalkable(x, y) {
    for (let r = 1; r < 10; r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (this.canWalk(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    return { x, y };
  },

  // ---------- Objekty ----------
  removeObj(i) {
    const o = this.obj[i];
    if (!o) return;
    this.obj[i] = null;
    this.desSet.delete(i);
    if (o.des) this.des[o.des].delete(i);
    this.bushSet.delete(i);
    this.recalc(i);
    if (OBJECTS[o.type].blocks) this.roomsDirty = true;
  },
  designate(i, des) {
    const o = this.obj[i];
    if (!o) return;
    if (o.des) this.des[o.des].delete(i);
    o.des = des;
    if (des) { this.desSet.add(i); this.des[des].add(i); } else this.desSet.delete(i);
  },

  // ---------- Předměty ----------
  canHoldItem(i) {
    return this.walk[i] && !this.struct[i] && !(this.bp[i] && BUILD[this.bp[i].type].layer === 'struct');
  },
  isChest(i) { const s = this.struct[i]; return !!s && !!BUILD[s.type].storage; },
  /** Sklad = zóna skladu nebo truhla. */
  isStock(i) { return this.zone[i] === 1 || this.isChest(i); },
  /** Smí se sem cíleně uložit (sklad / truhla)? */
  canStore(i) { return this.isChest(i) ? !this.struct[i].decon : this.canHoldItem(i); },
  stackCap(i) { return this.isChest(i) ? Config.CHEST_STACK : Config.STACK; },
  /** Povoluje filtr skladu na políčku daný druh suroviny? */
  allowed(i, type) { const f = this.filter[i]; return !(f & FILTER_CUSTOM) || !!(f & ITEM_BIT[type]); },
  isBelt(i) { const s = this.struct[i]; return !!s && !!BUILD[s.type].machine && !!BUILD[s.type].machine.belt; },
  /** Leží hromádka „volně“ (mimo sklad nebo ve skladu, kam nepatří)? Na pásu ne. */
  isLoose(i) { const it = this.items[i]; return !!it && !this.isBelt(i) && (!this.isStock(i) || !this.allowed(i, it.type)); },
  /** Souvislý sklad (zóna) nebo jedna truhla, do které políčko patří. */
  stockRegion(i) {
    if (this.isChest(i)) return [i];
    if (this.zone[i] !== 1) return [];
    const out = [i], seen = new Set([i]);
    for (let h = 0; h < out.length; h++) {
      const c = out[h], x = c % this.w, y = (c / this.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!this.inb(x + dx, y + dy)) continue;
        const q = this.idx(x + dx, y + dy);
        if (!seen.has(q) && this.zone[q] === 1) { seen.add(q); out.push(q); }
      }
    }
    return out;
  },
  setFilter(tiles, mask) {
    for (const i of tiles) this.filter[i] = mask;
    this.rebuildZones();
  },
  /** Položí předměty na políčko nebo do okolí. Vrací nepoložený zbytek. */
  dropItem(x, y, type, n, age = 0) {
    if (n <= 0) return 0;
    const seen = new Set();
    const q = [[x, y]];
    seen.add(this.idx(x, y));
    let head = 0;
    while (head < q.length && n > 0) {
      const [cx, cy] = q[head++];
      const i = this.idx(cx, cy);
      if (this.canHoldItem(i)) {
        const it = this.items[i];
        if (!it) { const k = Math.min(n, Config.STACK); this.addAt(i, type, k, age); n -= k; }
        else if (it.type === type && it.n < Config.STACK) { const k = Math.min(n, Config.STACK - it.n); this.addAt(i, type, k, age); n -= k; }
      }
      if (q.length > 400) continue;
      if (!this.walk[i] && !(cx === x && cy === y)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inb(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen.has(ni)) continue;
        seen.add(ni);
        q.push([nx, ny]);
      }
    }
    return n;
  },
  /** Jediné místo, kde předměty přibývají → počty a seznamy zůstávají aktuální. */
  addAt(i, type, k, age = 0) {
    const it = this.items[i];
    if (it) { it.age = (it.age * it.n + age * k) / (it.n + k); it.n += k; }   // stáří = vážený průměr
    else {
      this.items[i] = { type, n: k, age };
      this.itemSet.add(i);
      if (this.isLoose(i)) this.looseSet.add(i);
    }
    this.counts[type] += k;
    this.itemVer++;
  },
  takeItem(i, n) {
    const it = this.items[i];
    if (!it) return 0;
    const k = Math.min(n, it.n);
    it.n -= k;
    this.counts[it.type] -= k;
    this.itemVer++;
    if (it.n <= 0) { this.items[i] = null; this.itemSet.delete(i); this.looseSet.delete(i); }
    return k;
  },
  /** Přidá do konkrétního políčka (sklad); vrací zbytek. */
  putItem(i, type, n, age = 0) {
    if (!this.canStore(i)) return n;
    const it = this.items[i];
    if (it && it.type !== type) return n;
    const k = Math.min(n, this.stackCap(i) - (it ? it.n : 0));
    if (k > 0) this.addAt(i, type, k, age);
    return n - k;
  },
  /** Odebere `n` kusů suroviny odkudkoli z mapy (obchod). Vrací, kolik se podařilo. */
  removeItems(type, n) {
    let left = n;
    for (const i of [...this.itemSet]) {
      if (left <= 0) break;
      const it = this.items[i];
      if (!it || it.type !== type) continue;
      left -= this.takeItem(i, Math.min(left, Math.max(0, Game.availItem(i))));
    }
    return n - left;
  },
  /** Průběžně udržované počty surovin (bez procházení mapy). */
  countItems() { return this.counts; },

  // ---------- Zóny ----------
  rebuildZones() {
    this.stockTiles = []; this.farmTiles = [];
    for (let i = 0; i < this.n; i++) {
      if (this.isStock(i)) this.stockTiles.push(i);
      else { if (this.filter[i]) this.filter[i] = 0; if (this.zone[i] === 2) this.farmTiles.push(i); }
    }
    this.looseSet = new Set();
    for (const i of this.itemSet) if (this.isLoose(i)) this.looseSet.add(i);
    this.emptyFarm = new Set();
    for (const i of this.farmTiles) if (!this.crops[i]) this.emptyFarm.add(i);
    this.itemVer++;
  },
  setCrop(i, g) {
    this.crops[i] = { g };
    this.cropSet.add(i);
    this.emptyFarm.delete(i);
    if (g >= 1) this.ripeSet.add(i);
  },
  removeCrop(i) {
    if (!this.crops[i]) return;
    this.crops[i] = null;
    this.cropSet.delete(i);
    this.ripeSet.delete(i);
    if (this.zone[i] === 2) this.emptyFarm.add(i);
  },
  canSow(i) {
    return this.zone[i] === 2 && !this.crops[i] && !this.obj[i] && !this.struct[i] && !this.floor[i] &&
      !this.bp[i] && !this.items[i] && TERRAIN[this.terrain[i]].fert > 0;
  },

  // ---------- Stavby ----------
  /** Políčka, která stavba zabere (větší stavby, otočení o 90° prohodí rozměry). */
  footprint(i, type, dir = 0) {
    const size = BUILD[type].size;
    if (!size) return [i];
    const w = dir & 1 ? size[1] : size[0], h = dir & 1 ? size[0] : size[1];
    const x = i % this.w, y = (i / this.w) | 0, out = [];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      if (!this.inb(x + dx, y + dy)) return null;
      out.push(this.idx(x + dx, y + dy));
    }
    return out;
  },
  /** Sousední políčko ve směru dir (nebo -1 mimo mapu). */
  step(i, dir) {
    const x = (i % this.w) + DIRS4[dir][0], y = ((i / this.w) | 0) + DIRS4[dir][1];
    return this.inb(x, y) ? this.idx(x, y) : -1;
  },
  placeBlueprint(i, type, dir = 0) {
    const tiles = this.footprint(i, type, dir) || [i];
    const bp = { type, del: {}, i, dir, tiles };
    for (const t of tiles) this.bp[t] = bp;
    this.bpSet.add(i);
  },
  /** Vytvoří objekt stavby a položí ho na všechna její políčka. */
  makeStruct(i, type, dir = 0, extra) {
    const tiles = this.footprint(i, type, dir) || [i];
    const s = Object.assign({ type, decon: false, owner: -1, i, dir, tiles }, extra);
    Machines.init(s);
    for (const t of tiles) this.struct[t] = s;
    return s;
  },
  bpMissing(i) {
    const bp = this.bp[i];
    if (!bp) return null;
    const cost = BUILD[bp.type].cost;
    for (const m in cost) if ((bp.del[m] || 0) < cost[m]) return m;
    return null;
  },
  bpNeed(i, m) {
    const bp = this.bp[i];
    return BUILD[bp.type].cost[m] - (bp.del[m] || 0);
  },
  cancelBlueprint(i) {
    const bp = this.bp[i];
    if (!bp) return;
    for (const t of bp.tiles) this.bp[t] = null;
    this.bpSet.delete(bp.i);
    const [x, y] = this.xy(bp.i);
    for (const m in bp.del) if (bp.del[m] > 0) this.dropItem(x, y, m, bp.del[m]);
  },
  completeBlueprint(i) {
    const bp = this.bp[i];
    if (!bp) return;
    const def = BUILD[bp.type];
    i = bp.i;
    for (const t of bp.tiles) this.bp[t] = null;
    this.bpSet.delete(i);
    const [x, y] = this.xy(i);
    if (def.layer === 'floor') {
      this.floor[i] = { type: bp.type, decon: false };
    } else {
      const s = this.makeStruct(i, bp.type, bp.dir);
      this.indexStruct(i, bp.type, true);
      const keep = def.storage || (def.machine && def.machine.belt);
      for (const t of s.tiles) {
        this.removeCrop(t);
        this.recalc(t);
        // odsunout předměty z políčka (truhla a pás si je nechají)
        const it = this.items[t];
        if (it && !keep) { const ty = it.type, a = it.age, k = this.takeItem(t, it.n); this.dropItem(x, y, ty, k, a); }
      }
      if (keep) this.rebuildZones();
    }
    this.recalc(i);
  },
  deconstruct(i) {
    const [x, y] = this.xy(i);
    let def = null;
    if (this.struct[i] && this.struct[i].decon) {
      def = BUILD[this.struct[i].type];
      this.destroyStruct(i);
    } else if (this.floor[i] && this.floor[i].decon) {
      def = BUILD[this.floor[i].type];
      this.floor[i] = null;
    }
    this.deconSet.delete(i);
    this.recalc(i);
    if (def) for (const m in def.cost) {
      const back = Math.floor(def.cost[m] * 0.6);
      if (back > 0) this.dropItem(x, y, m, back);
    }
  },
  /** Odstraní stavbu bez náhrady (bourání, požár). Obsah truhly vysype ven. */
  destroyStruct(i) {
    const s = this.struct[i];
    if (!s) return;
    const def = BUILD[s.type];
    i = s.i;
    this.indexStruct(i, s.type, false);
    for (const t of s.tiles) { this.struct[t] = null; this.recalc(t); }
    this.deconSet.delete(i);
    const [x, y] = this.xy(i);
    // vysypat zásobníky stroje
    for (const buf of [s.inv, s.out]) if (buf) for (const m in buf) if (buf[m] >= 1) this.dropItem(x, y, m, Math.floor(buf[m]));
    if (def.storage || (def.machine && def.machine.belt)) {
      const it = this.items[i];
      if (it && def.storage) { const t = it.type, a = it.age, k = this.takeItem(i, it.n); this.dropItem(x, y, t, k, a); }
      this.rebuildZones();
    }
  },
  deconTarget(i) {
    if (this.struct[i] && this.struct[i].decon) return this.struct[i];
    if (this.floor[i] && this.floor[i].decon) return this.floor[i];
    return null;
  },
  structsOfType(type) { return this.structBy[type] ? [...this.structBy[type]] : []; },

  // ---------- Místnosti a střecha ----------
  /**
   * Flood fill: všechno, co není dosažitelné z okraje mapy přes volná políčka
   * (zdi, dveře a skály jsou hranice), je uzavřený prostor. Menší uzavřené
   * prostory se považují za zastřešené místnosti.
   */
  computeRooms() {
    this.roomsDirty = false;
    const n = this.n, w = this.w, h = this.h;
    const solid = new Uint8Array(n);   // 1 zeď/skála, 2 dveře
    for (let i = 0; i < n; i++) {
      const s = this.struct[i], o = this.obj[i];
      if (s && BUILD[s.type].wall) solid[i] = 1;
      else if (s && BUILD[s.type].door) solid[i] = 2;
      else if (o && OBJECTS[o.type].blocks) solid[i] = 1;
    }
    const mark = new Uint8Array(n);    // 1 = venku
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    const push = (i) => { if (!solid[i] && !mark[i]) { mark[i] = 1; q[tail++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (head < tail) {
      const i = q[head++], x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < n - w) push(i + w);
    }
    this.roof.fill(0);
    this.roomId.fill(-1);
    this.rooms = [];
    for (let s0 = 0; s0 < n; s0++) {
      if (solid[s0] || mark[s0]) continue;
      // nová uzavřená oblast
      const tiles = [s0];
      mark[s0] = 2;
      for (let k = 0; k < tiles.length; k++) {
        const i = tiles[k], x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (j < 0 || j >= n || solid[j] || mark[j]) continue;
          mark[j] = 2; tiles.push(j);
        }
      }
      if (tiles.length > Config.ROOM_MAX) continue;
      const room = { id: this.rooms.length, tiles, beds: [], heat: 0 };
      for (const i of tiles) {
        this.roof[i] = 1; this.roomId[i] = room.id;
        const s = this.struct[i];
        if (s) {
          if (s.type === 'bed') room.beds.push(i);
          if (BUILD[s.type].heat) room.heat += BUILD[s.type].heat;
        }
      }
      this.rooms.push(room);
    }
    // dveře sousedící s místností jsou také pod střechou
    for (let i = 0; i < n; i++) {
      if (solid[i] !== 2) continue;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < n && this.roomId[j] >= 0) { this.roof[i] = 1; break; }
      }
    }
  },
  roomAt(i) {
    if (this.roomsDirty) this.computeRooms();
    const r = this.roomId[i];
    return r >= 0 ? this.rooms[r] : null;
  },
  isRoofed(i) {
    if (this.roomsDirty) this.computeRooms();
    return this.roof[i] === 1;
  },
  /** Teplota na políčku: venkovní + izolace místnosti + teplo z ohniště. */
  tempAt(i) {
    let t = TimeSys.temp();
    const room = this.roomAt(i);
    if (room) t += 5 + Math.min(22, room.heat);
    else {
      // venku hřeje oheň jen zblízka
      const x = i % this.w, y = (i / this.w) | 0;
      for (const f of this.lights) {
        const s = this.struct[f];
        if (!s || !BUILD[s.type].heat) continue;
        if (Math.abs((f % this.w) - x) <= 2 && Math.abs(((f / this.w) | 0) - y) <= 2) { t += 7; break; }
      }
    }
    return t;
  },

  // ---------- Růst ----------
  update(hours) {
    if (this.roomsDirty) this.computeRooms();
    const light = TimeSys.daylight();
    const temp = TimeSys.temp(), winter = TimeSys.season === 3;
    // v zimě a při mrazu plodiny nerostou
    const warm = winter ? 0 : U.clamp((temp - 1) / 6, 0, 1);
    const growMul = (0.15 + 0.85 * light) * (1 + Weather.rain * 0.35) * warm;
    this.spoil(hours, temp);
    let matured = 0;
    for (const i of this.cropSet) {
      const c = this.crops[i];
      if (!c || c.g >= 1) continue;
      const fert = TERRAIN[this.terrain[i]].fert;
      c.g += hours / Config.CROP_HOURS * fert * growMul * (1 - 0.7 * Math.min(1, Pollution.at(i)));
      if (c.g >= 1) { c.g = 1; matured++; this.ripeSet.add(i); }
    }
    if (matured > 0) Game.notifyOnce('crop', `Úroda dozrála (${matured} polí) – kolonisté ji sklidí.`, 'good', 360);
    for (const i of this.bushSet) {
      const o = this.obj[i];
      if (!o) continue;
      if (winter) { o.berries = false; o.regrow = Math.max(o.regrow, 6); }   // v zimě keře neplodí
      else if (!o.berries) {
        o.regrow -= hours * (0.5 + light * 0.5);
        if (o.regrow <= 0) o.berries = true;
      }
    }
    // vzácně vyroste nový stromek
    if (!winter && U.chance(hours * 0.6)) {
      const x = U.int(0, this.w - 1), y = U.int(0, this.h - 1), i = this.idx(x, y);
      const t = this.terrain[i];
      if ((t === T.GRASS || t === T.SOIL) && !this.obj[i] && !this.struct[i] && !this.floor[i] && !this.bp[i] &&
          !this.items[i] && !this.zone[i] && !Game.colonists.some(c => c.tx === x && c.ty === y)) {
        // ne příliš blízko základny
        const s = this.start;
        if (Math.hypot(x - s.x, y - s.y) > 14) {
          this.obj[i] = { type: 'tree', des: null, size: 0.55 };
          this.recalc(i);
        }
      }
    }
    for (let i = 0; i < this.n; i++) {
      const o = this.obj[i];
      if (o && o.type === 'tree' && o.size < 1) o.size = Math.min(1, o.size + hours * Config.TREE_GROW_PER_HOUR);
    }
  },

  /** Kažení potravin: pomaleji pod střechou a v truhle, výrazně pomaleji v chladu. */
  spoil(hours, temp) {
    const cold = temp < 3 ? 0.35 : 1;
    let lost = 0;
    for (const i of this.itemSet) {
      const it = this.items[i];
      const limit = Config.SPOIL_HOURS[it.type];
      if (!limit) continue;
      let rate = cold;
      if (this.roof[i] || this.isChest(i)) rate *= 0.5;
      it.age += hours * rate;
      if (it.age >= limit) lost += this.takeItem(i, it.n);
    }
    if (lost > 0) Game.notifyOnce('spoil', `Zkazilo se ${lost} ks potravin. Pod střechou a v truhle vydrží déle.`, 'warn', 120);
  },
  /** Čerstvost hromádky 0..1 (1 = čerstvé), nebo -1 pokud se nekazí. */
  freshness(i) {
    const it = this.items[i];
    const limit = it && Config.SPOIL_HOURS[it.type];
    return limit ? U.clamp(1 - it.age / limit, 0, 1) : -1;
  },
};
