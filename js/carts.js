'use strict';
/**
 * Carts – koleje s vozíkem pro delší vzdálenosti. Vozík patří nakládací
 * zastávce: nabere hromádky z políček vedle ní, po kolejích dojede k nejbližší
 * vykládací zastávce, složí náklad na políčka vedle ní a vrátí se.
 */
const Carts = {
  list: [],
  CAP: 60,
  SPEED: 0.17,

  reset() { this.list = []; },
  isTrack(i) { const s = World.struct[i]; const m = s && BUILD[s.type].machine; return !!m && (!!m.rail || !!m.stop); },
  isStop(i) { const s = World.struct[i]; const m = s && BUILD[s.type].machine; return !!m && !!m.stop; },
  /** Políčka vedle zastávky, která nejsou kolejí. */
  sides(i) {
    const w = World.w, x = i % w, out = [];
    for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (q >= 0 && q < World.n && !this.isTrack(q)) out.push(q);
    return out;
  },
  /** Nejkratší cesta po kolejích od `from` k nejbližší zastávce s daným režimem. */
  route(from, unload) {
    const w = World.w, prev = new Map([[from, -1]]), q = [from];
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (i !== from && this.isStop(i) && !!World.struct[i].unload === unload) {
        const path = [];
        for (let k = i; k !== from; k = prev.get(k)) path.push(k);
        return path.reverse();
      }
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= World.n || prev.has(j) || !this.isTrack(j)) continue;
        prev.set(j, i); q.push(j);
      }
    }
    return null;
  },
  /** Každá nakládací zastávka má svůj vozík. */
  sync() {
    const stops = World.structBy.cartstop || new Set();
    this.list = this.list.filter(c => {
      const ok = stops.has(c.home) && !World.struct[c.home].unload;
      if (!ok && c.cargo) World.dropItem(Math.floor(c.x), Math.floor(c.y), c.cargo.type, c.cargo.n, c.cargo.age);
      return ok;
    });
    for (const i of stops) {
      if (World.struct[i].unload || this.list.some(c => c.home === i)) continue;
      this.list.push({ home: i, x: (i % World.w) + 0.5, y: ((i / World.w) | 0) + 0.5, state: 'load', cargo: null, wait: 0, path: null, pi: 0, dir: 0 });
    }
  },
  move(c) {
    if (!c.path || c.pi >= c.path.length) return true;
    const ni = c.path[c.pi];
    if (!this.isTrack(ni)) { c.path = null; return true; }   // kolej zmizela
    const nx = (ni % World.w) + 0.5, ny = ((ni / World.w) | 0) + 0.5;
    const dx = nx - c.x, dy = ny - c.y, d = Math.hypot(dx, dy);
    if (d <= this.SPEED) { c.x = nx; c.y = ny; c.pi++; }
    else { c.x += dx / d * this.SPEED; c.y += dy / d * this.SPEED; }
    c.dir = Math.abs(dx) > Math.abs(dy) ? 0 : 1;
    return false;
  },
  tick() {
    const t = Game.tickCount;
    if (t % 60 === 0) this.sync();
    for (const c of this.list) {
      const here = World.idx(Math.floor(c.x), Math.floor(c.y));
      if (c.state === 'load') {
        if (t % 20 !== 0) continue;
        c.wait += 20;
        for (const q of this.sides(c.home)) {
          const it = World.items[q];
          if (!it || (c.cargo && c.cargo.type !== it.type)) continue;
          const k = Math.min(this.CAP - (c.cargo ? c.cargo.n : 0), Math.max(0, Game.availItem(q)));
          if (k <= 0) continue;
          const type = it.type, age = it.age;
          World.takeItem(q, k);
          if (c.cargo) c.cargo.n += k; else c.cargo = { type, n: k, age };
        }
        if (c.cargo && (c.cargo.n >= this.CAP * 0.6 || c.wait >= 400)) {
          c.path = this.route(c.home, true); c.pi = 0;
          if (c.path) { c.state = 'go'; c.wait = 0; } else c.msg = 'Chybí vykládací zastávka na konci kolejí';
        }
      } else if (c.state === 'go') {
        if (this.move(c)) { c.state = c.path ? 'unload' : 'back'; if (!c.path) { c.path = this.route(here, false); c.pi = 0; } c.wait = 0; }
      } else if (c.state === 'unload') {
        if (t % 20 !== 0) continue;
        c.wait += 20;
        // přednostně do skladu, na pás nebo do stroje; až potom na holou zem
        const sides = this.sides(here).sort((p, q) => (World.struct[q] || World.isStock(q) ? 1 : 0) - (World.struct[p] || World.isStock(p) ? 1 : 0));
        if (c.cargo) for (const q of sides) {
          const k = Machines.pushTo(q, c.cargo.type, c.cargo.n, c.cargo.age);
          c.cargo.n -= k;
          if (c.cargo.n <= 0) { c.cargo = null; break; }
        }
        if (!c.cargo || c.wait >= 600) {
          c.path = [];
          const back = this.route(here, false);
          // vrátit se právě ke své domovské zastávce
          if (back && back[back.length - 1] === c.home) c.path = back;
          else { const p = this.pathTo(here, c.home); if (p) c.path = p; }
          c.pi = 0; c.state = 'back';
        }
      } else if (c.state === 'back') {
        if (this.move(c)) {
          if (here !== c.home) { c.x = (c.home % World.w) + 0.5; c.y = ((c.home / World.w) | 0) + 0.5; }
          c.state = 'load'; c.wait = 0;
        }
      }
    }
  },
  /** Cesta po kolejích mezi dvěma konkrétními políčky. */
  pathTo(from, to) {
    const w = World.w, prev = new Map([[from, -1]]), q = [from];
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (i === to) { const path = []; for (let k = i; k !== from; k = prev.get(k)) path.push(k); return path.reverse(); }
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= World.n || prev.has(j) || !this.isTrack(j)) continue;
        prev.set(j, i); q.push(j);
      }
    }
    return null;
  },
  pack() { return this.list.map(c => ({ home: c.home, cargo: c.cargo })); },
  unpack(arr) {
    this.reset();
    for (const d of arr || []) this.list.push({ home: d.home, x: (d.home % World.w) + 0.5, y: ((d.home / World.w) | 0) + 0.5, state: 'load', cargo: d.cargo || null, wait: 0, path: null, pi: 0, dir: 0 });
  },
};
