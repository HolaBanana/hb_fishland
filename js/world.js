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
    this.obj = new Array(n).fill(null);     // {type, des, size, berries, regrow, variant}
    this.struct = new Array(n).fill(null);  // {type, decon, owner}
    this.floor = new Array(n).fill(null);   // {type, decon}
    this.items = new Array(n).fill(null);   // {type, n}
    this.crops = new Array(n).fill(null);   // {g}
    this.bp = new Array(n).fill(null);      // {type, del:{}}
    this.zone = new Uint8Array(n);          // 0 nic, 1 sklad, 2 pole
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
    this.counts = { wood: 0, stone: 0, iron: 0, food: 0, meal: 0 };
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
      if (this.bp[i]) this.bpSet.add(i);
      const o = this.obj[i];
      if (o) {
        if (o.type === 'bush') this.bushSet.add(i);
        if (o.des) { this.desSet.add(i); this.des[o.des].add(i); }
      }
      const s = this.struct[i];
      if (s) this.indexStruct(i, s.type, true);
      if ((s && s.decon) || (this.floor[i] && this.floor[i].decon)) this.deconSet.add(i);
      const c = this.crops[i];
      if (c) { this.cropSet.add(i); if (c.g >= 1) this.ripeSet.add(i); }
      this.recalc(i);
    }
    this.rebuildZones();
  },
  indexStruct(i, type, add) {
    if (add) {
      this.structSet.add(i);
      (this.structBy[type] || (this.structBy[type] = new Set())).add(i);
      if (BUILD[type].light) this.lights.add(i);
    } else {
      this.structSet.delete(i);
      if (this.structBy[type]) this.structBy[type].delete(i);
      this.lights.delete(i);
    }
  },

  idx(x, y) { return y * this.w + x; },
  xy(i) { return [i % this.w, (i / this.w) | 0]; },
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; },

  // ---------- Generování mapy ----------
  generate(seed) {
    this.seed = seed;
    const w = Config.MAP_W, h = Config.MAP_H;
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
    const eWater = q(elev, 0.08), eShallow = q(elev, 0.11), eSand = q(elev, 0.14), eRock = q(elev, 0.78);
    const mSoil = q(moist, 0.78), mDirt = q(moist, 0.08);
    const fTree = q(forest, 0.55);

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
    const oreT = rockOre.length ? q(rockOre, 0.86) : 1;
    for (const i of rockIdx) if (oreN[i] > oreT) this.obj[i].type = 'ore';

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
    put(0, 'wood', 75); put(1, 'wood', 75); put(2, 'wood', 30);
    put(3, 'meal', 18); put(4, 'food', 30); put(5, 'stone', 20);
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
  /** Položí předměty na políčko nebo do okolí. Vrací nepoložený zbytek. */
  dropItem(x, y, type, n) {
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
        if (!it) { const k = Math.min(n, Config.STACK); this.addAt(i, type, k); n -= k; }
        else if (it.type === type && it.n < Config.STACK) { const k = Math.min(n, Config.STACK - it.n); this.addAt(i, type, k); n -= k; }
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
  addAt(i, type, k) {
    const it = this.items[i];
    if (it) it.n += k;
    else {
      this.items[i] = { type, n: k };
      this.itemSet.add(i);
      if (this.zone[i] !== 1) this.looseSet.add(i);
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
  putItem(i, type, n) {
    if (!this.canHoldItem(i)) return n;
    const it = this.items[i];
    if (it && it.type !== type) return n;
    const k = Math.min(n, Config.STACK - (it ? it.n : 0));
    if (k > 0) this.addAt(i, type, k);
    return n - k;
  },
  /** Průběžně udržované počty surovin (bez procházení mapy). */
  countItems() { return this.counts; },

  // ---------- Zóny ----------
  rebuildZones() {
    this.stockTiles = []; this.farmTiles = [];
    for (let i = 0; i < this.n; i++) {
      if (this.zone[i] === 1) this.stockTiles.push(i);
      else if (this.zone[i] === 2) this.farmTiles.push(i);
    }
    this.looseSet = new Set();
    for (const i of this.itemSet) if (this.zone[i] !== 1) this.looseSet.add(i);
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
  placeBlueprint(i, type) {
    this.bp[i] = { type, del: {} };
    this.bpSet.add(i);
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
    this.bp[i] = null;
    this.bpSet.delete(i);
    const [x, y] = this.xy(i);
    for (const m in bp.del) if (bp.del[m] > 0) this.dropItem(x, y, m, bp.del[m]);
  },
  completeBlueprint(i) {
    const bp = this.bp[i];
    if (!bp) return;
    const def = BUILD[bp.type];
    this.bp[i] = null;
    this.bpSet.delete(i);
    const [x, y] = this.xy(i);
    if (def.layer === 'floor') {
      this.floor[i] = { type: bp.type, decon: false };
    } else {
      this.struct[i] = { type: bp.type, decon: false, owner: -1 };
      this.indexStruct(i, bp.type, true);
      this.removeCrop(i);
      this.recalc(i);
      // odsunout předměty z políčka
      const it = this.items[i];
      if (it) { const t = it.type, k = this.takeItem(i, it.n); this.dropItem(x, y, t, k); }
    }
    this.recalc(i);
  },
  deconstruct(i) {
    const [x, y] = this.xy(i);
    let def = null;
    if (this.struct[i] && this.struct[i].decon) {
      def = BUILD[this.struct[i].type];
      this.indexStruct(i, this.struct[i].type, false);
      this.struct[i] = null;
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
  deconTarget(i) {
    if (this.struct[i] && this.struct[i].decon) return this.struct[i];
    if (this.floor[i] && this.floor[i].decon) return this.floor[i];
    return null;
  },
  structsOfType(type) { return this.structBy[type] ? [...this.structBy[type]] : []; },

  // ---------- Růst ----------
  update(hours) {
    const light = TimeSys.daylight();
    const growMul = (0.15 + 0.85 * light) * (1 + Weather.rain * 0.35);
    let matured = 0;
    for (const i of this.cropSet) {
      const c = this.crops[i];
      if (!c || c.g >= 1) continue;
      const fert = TERRAIN[this.terrain[i]].fert;
      c.g += hours / Config.CROP_HOURS * fert * growMul;
      if (c.g >= 1) { c.g = 1; matured++; this.ripeSet.add(i); }
    }
    if (matured > 0) Game.notifyOnce('crop', `Úroda dozrála (${matured} polí) – kolonisté ji sklidí.`, 'good', 360);
    for (const i of this.bushSet) {
      const o = this.obj[i];
      if (o && !o.berries) {
        o.regrow -= hours * (0.5 + light * 0.5);
        if (o.regrow <= 0) o.berries = true;
      }
    }
    // vzácně vyroste nový stromek
    if (U.chance(hours * 0.6)) {
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
};
