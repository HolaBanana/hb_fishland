'use strict';
/**
 * Animals – zvěř a hospodářská zvířata.
 *  - jeleni: divoká zvěř, bloumá po mapě, dá se lovit,
 *  - divočáci: při nájezdu žerou úrodu na polích; bdělý kolonista je zaplaší,
 *  - slepice a ovce: žijí u kurníku / ovčína na zóně Pastvina, dávají vejce a vlnu.
 */
class Animal {
  constructor(type, x, y) {
    this.id = Animals.nextId++;
    this.type = type;
    this.def = ANIMALS[type];
    this.x = x + 0.5; this.y = y + 0.5;
    this.dir = 'left';
    this.state = 'wander';    // wander | raid | eat | flee
    this.path = null; this.pathI = 0;
    this.timer = U.int(20, 200);
    this.target = -1;
    this.leaveAt = 0;
    this.animT = 0;
    this.hp = this.def.hp;
    this.hunt = false;        // označeno k lovu / porážce
    this.home = -1;           // index kurníku / ovčína
    this.prod = U.rand();     // postup snášky / růstu vlny 0..1
    this.gone = false;
  }
  get tx() { return Math.floor(this.x); }
  get ty() { return Math.floor(this.y); }

  goTo(x, y, mode = 0) {
    const p = Pathfinder.find(this.tx, this.ty, x, y, mode);
    this.path = p; this.pathI = 0;
    return !!p;
  }
  /** Krok po cestě; vrací true po dojití. */
  step(speed) {
    if (!this.path || this.pathI >= this.path.length) return true;
    const ni = this.path[this.pathI];
    if (!World.walk[ni]) { this.path = null; return true; }
    const nx = (ni % World.w) + 0.5, ny = Math.floor(ni / World.w) + 0.5;
    const dx = nx - this.x, dy = ny - this.y, d = Math.hypot(dx, dy);
    const sp = speed / World.cost[ni];
    if (d <= sp) { this.x = nx; this.y = ny; this.pathI++; }
    else { this.x += dx / d * sp; this.y += dy / d * sp; }
    if (Math.abs(dx) > 0.01) this.dir = dx > 0 ? 'right' : 'left';
    this.animT += sp;
    return false;
  }
  /** Bdělý kolonista nablízku? */
  scared(r) {
    for (const c of Game.colonists) {
      if (!c.sleeping && Math.hypot(c.x - this.x, c.y - this.y) < r) return c;
    }
    return null;
  }
  /** Úprk pryč od kolonisty / kolonie. `leave` = zmizet z mapy po doběhnutí. */
  flee(from, leave) {
    this.state = 'flee';
    this.leaving = !!leave;
    const s = from || World.start;
    const ang = Math.atan2(this.y - (s.y + 0.5), this.x - (s.x + 0.5)) + U.range(-0.6, 0.6);
    for (let r = leave ? 26 : 10; r > 3; r -= 3) {
      const x = Math.round(this.x + Math.cos(ang) * r), y = Math.round(this.y + Math.sin(ang) * r);
      if (World.canWalk(x, y) && this.goTo(x, y)) return;
    }
    if (leave) this.gone = true; else { this.state = 'wander'; this.timer = 60; }
  }
  nearestCrop() {
    let best = -1, bd = Infinity;
    for (const i of World.cropSet) {
      const d = Math.abs((i % World.w) - this.tx) + Math.abs(((i / World.w) | 0) - this.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /** Náhodný cíl potulky; hospodářská zvířata se drží pastviny u svého domova. */
  wanderTarget() {
    const live = !this.def.wild;
    for (let k = 0; k < 10; k++) {
      let bx = this.tx, by = this.ty, r = 5;
      if (live && this.home >= 0) { bx = this.home % World.w; by = (this.home / World.w) | 0; r = 6; }
      const x = bx + U.int(-r, r), y = by + U.int(-r, r);
      if (!World.canWalk(x, y)) continue;
      const i = World.idx(x, y);
      if (live && Animals.hasPasture(this.home) && World.zone[i] !== 3) continue;
      if (live && !Animals.hasPasture(this.home) && Math.max(Math.abs(x - bx), Math.abs(y - by)) > 2) continue;
      if (World.terrain[i] === T.SHALLOW) continue;
      return this.goTo(x, y);
    }
    return false;
  }

  tick() {
    const d = this.def;
    if (this.state === 'flee') {
      if (this.step(d.speed * 1.5)) { if (this.leaving) this.gone = true; else { this.state = 'wander'; this.timer = 150; } }
      return;
    }
    if (d.wild) {
      const c = this.scared(d.shy);
      if (c) { this.flee(c, this.type === 'boar' && this.state !== 'wander'); return; }
    }
    if (this.state === 'raid' || this.state === 'eat') {
      if (TimeSys.minutes > this.leaveAt) { this.flee(null, true); return; }
      if (this.state === 'raid') {
        if (this.target < 0 || !World.crops[this.target]) {
          this.target = this.nearestCrop();
          if (this.target < 0 || !this.goTo(this.target % World.w, (this.target / World.w) | 0)) { this.flee(null, true); return; }
        }
        if (this.step(d.speed * 0.8)) { this.state = 'eat'; this.timer = 420; }
      } else if (--this.timer <= 0) {
        if (World.crops[this.target]) { World.removeCrop(this.target); Game.stats.cropsEaten++; }
        this.target = -1;
        this.state = 'raid';
      }
      return;
    }
    // potulka
    if (this.path && this.pathI < this.path.length) { this.step(d.speed * 0.5); return; }
    if (--this.timer <= 0) {
      this.timer = U.int(120, 400);
      this.wanderTarget();
    }
  }
}

const Animals = {
  list: [],
  nextId: 1,
  pastureCache: new Map(),
  reset() { this.list = []; this.nextId = 1; this.pastureCache.clear(); },

  tick() {
    if (!this.list.length) return;
    for (const a of this.list) a.tick();
    if (this.list.some(a => a.gone)) this.list = this.list.filter(a => !a.gone);
  },
  at(x, y) { return this.list.filter(a => a.tx === x && a.ty === y); },
  byId(id) { return this.list.find(a => a.id === id); },
  count(type) { let n = 0; for (const a of this.list) if (a.type === type) n++; return n; },

  /** Počet políček pastviny v okolí domova (kurníku / ovčína). */
  pastureTiles(home) {
    if (home < 0) return 0;
    const hx = home % World.w, hy = (home / World.w) | 0;
    let n = 0;
    for (let y = hy - 7; y <= hy + 7; y++) for (let x = hx - 7; x <= hx + 7; x++) {
      if (World.inb(x, y) && World.zone[World.idx(x, y)] === 3) n++;
    }
    return n;
  },
  hasPasture(home) { return this.pastureTiles(home) >= 4; },
  herd(home) { return this.list.filter(a => a.home === home); },
  /** Jak dobře je stádo živené: 1 = dost pastviny (3 políčka na kus), jinak úměrně méně. */
  feed(home) {
    const n = this.herd(home).length;
    if (!n) return 1;
    return U.clamp(this.pastureTiles(home) / (n * 3), 0.25, 1) * (TimeSys.season === 3 ? 0.5 : 1);
  },

  /** Jednou za herní hodinu: snáška, vlna, množení, přírůstek divoké zvěře. */
  hourly() {
    const feedOf = new Map();
    for (const a of this.list) {
      if (a.def.wild || a.home < 0) continue;
      if (!World.struct[a.home] || !BUILD[World.struct[a.home].type].livestock) { a.home = -1; continue; }
      if (!feedOf.has(a.home)) feedOf.set(a.home, this.feed(a.home));
      const f = feedOf.get(a.home);
      if (a.def.eggHours) {
        a.prod += f / a.def.eggHours;
        if (a.prod >= 1) { a.prod = 0; World.dropItem(a.tx, a.ty, 'egg', 1); Game.stats.eggs = (Game.stats.eggs || 0) + 1; }
      } else if (a.def.woolHours && a.prod < 1) a.prod = Math.min(1, a.prod + f / a.def.woolHours);
    }
    // množení u domovů
    for (const type of ['coop', 'sheepfold']) for (const i of World.structBy[type] || []) {
      const s = World.struct[i], L = BUILD[type].livestock;
      s.breed = (s.breed || 0) + (feedOf.get(i) || this.feed(i));
      const herd = this.herd(i);
      if (s.breed >= 60 && herd.length >= 2 && herd.length < L.cap) { s.breed = 0; this.spawnLivestock(i, 1); }
      else if (herd.length < 2 && s.breed >= 96) { s.breed = 0; this.spawnLivestock(i, 1); }   // zatoulaný kus se vrátí
    }
    // divoká zvěř: jeleni se objevují dál od kolonie
    if (this.count('deer') < 9 && U.chance(0.12)) {
      for (let k = 0; k < 30; k++) {
        const x = U.int(3, World.w - 4), y = U.int(3, World.h - 4), i = World.idx(x, y);
        if (!World.walk[i] || World.terrain[i] === T.SHALLOW || Math.hypot(x - World.start.x, y - World.start.y) < 22) continue;
        const n = U.int(2, 3);
        for (let q = 0; q < n; q++) { const p = World.canWalk(x + q, y) ? { x: x + q, y } : { x, y }; this.list.push(new Animal('deer', p.x, p.y)); }
        break;
      }
    }
  },
  spawnLivestock(home, n) {
    const L = BUILD[World.struct[home].type].livestock;
    const p = World.nearestWalkable(home % World.w, (home / World.w) | 0);
    for (let k = 0; k < n; k++) { const a = new Animal(L.type, p.x, p.y); a.home = home; this.list.push(a); }
  },
  /** Po dostavbě kurníku / ovčína přijdou první zvířata. */
  onBuilt(s) {
    const L = BUILD[s.type].livestock;
    if (L) { this.spawnLivestock(s.i, L.start); Game.alert(`${BUILD[s.type].name}: přišla první zvířata. Vyznač kolem zónu Pastvina.`, 'good', s.i % World.w, (s.i / World.w) | 0); }
  },

  /** Nájezd divočáků na pole. Vrací true, pokud se podařilo zvěř vysadit. */
  boarRaid() {
    if (World.cropSet.size < 6) return false;
    const crops = [...World.cropSet];
    const c = crops[Math.floor(U.rand() * crops.length)];
    const cx = c % World.w, cy = (c / World.w) | 0;
    let n = 0;
    const want = U.int(2, 3);
    for (let k = 0; k < 60 && n < want; k++) {
      const ang = U.rand() * Math.PI * 2, r = U.range(16, 24);
      const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
      if (!World.canWalk(x, y) || !Pathfinder.find(x, y, cx, cy, 1)) continue;
      const a = new Animal('boar', x, y);
      a.state = 'raid'; a.leaveAt = TimeSys.minutes + 60 * 6;
      this.list.push(a);
      n++;
    }
    if (n) Game.alert('Divočáci se ženou na pole! Kolonista poblíž je zaplaší, lovec je může skolit.', 'warn', cx, cy);
    return n > 0;
  },
  /** Zabité zvíře: maso a kůže na zem. */
  kill(a) {
    a.gone = true;
    if (a.def.meat) World.dropItem(a.tx, a.ty, 'meat', a.def.meat);
    if (a.def.leather) World.dropItem(a.tx, a.ty, 'leather', a.def.leather);
    Game.stats.hunted = (Game.stats.hunted || 0) + 1;
  },

  pack() { return { nextId: this.nextId, list: this.list.map(a => ({ id: a.id, type: a.type, x: a.x, y: a.y, state: a.state === 'flee' ? 'wander' : a.state, leaveAt: a.leaveAt, hp: a.hp, hunt: a.hunt, home: a.home, prod: +a.prod.toFixed(3) })) }; },
  unpack(d) {
    this.reset();
    const arr = Array.isArray(d) ? d : (d && d.list) || [];
    for (const q of arr) {
      if (!ANIMALS[q.type]) continue;
      const a = new Animal(q.type, Math.floor(q.x), Math.floor(q.y));
      if (q.id) a.id = q.id;
      a.x = q.x; a.y = q.y;
      a.state = q.state || (q.type === 'boar' ? 'raid' : 'wander');
      a.leaveAt = q.leaveAt || 0;
      if (q.hp !== undefined) a.hp = q.hp;
      a.hunt = !!q.hunt; a.home = q.home !== undefined ? q.home : -1;
      if (q.prod !== undefined) a.prod = q.prod;
      this.list.push(a);
    }
    if (d && d.nextId) this.nextId = d.nextId;
    else this.nextId = Math.max(0, ...this.list.map(a => a.id)) + 1;
  },
};
