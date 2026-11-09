'use strict';
/**
 * Game – stav hry, rezervace, herní smyčka s pevným krokem a zrychlením času.
 */
const Game = {
  colonists: [],
  res: new Map(),        // klíč → id kolonisty (rezervace cílů)
  itemRes: new Map(),    // index políčka → rezervovaný počet kusů
  speed: 1,
  lastSpeed: 1,
  tool: 'select',
  selected: null,
  tickCount: 0,
  notified: new Map(),
  acc: 0,

  init(seed) {
    this.seed = seed;
    U.seed(seed);
    TimeSys.reset();
    World.generate(seed);
    Pathfinder.init(World.w, World.h);
    Sprites.buildTerrain();
    this.res.clear(); this.itemRes.clear(); this.notified.clear();
    this.colonists = createColonists(World.start);
    Weather.reset();
    Camera.zoom = Config.ZOOM_DEFAULT;
    Camera.centerTile(World.start.x, World.start.y + 1);
  },

  // ---------- Rezervace ----------
  reserve(key, c) {
    const o = this.res.get(key);
    if (o !== undefined && o !== c.id) return false;
    if (o === undefined) { this.res.set(key, c.id); c.resKeys.push(key); }
    return true;
  },
  isReserved(key, c) {
    const o = this.res.get(key);
    return o !== undefined && (!c || o !== c.id);
  },
  reserveItem(i, n, c) {
    this.itemRes.set(i, (this.itemRes.get(i) || 0) + n);
    c.itemRes.push([i, n]);
  },
  releaseItemRes(c, i) {
    for (let k = c.itemRes.length - 1; k >= 0; k--) {
      const [ii, n] = c.itemRes[k];
      if (ii !== i) continue;
      const v = (this.itemRes.get(ii) || 0) - n;
      if (v <= 0) this.itemRes.delete(ii); else this.itemRes.set(ii, v);
      c.itemRes.splice(k, 1);
    }
  },
  availItem(i) {
    const it = World.items[i];
    if (!it) return 0;
    return it.n - (this.itemRes.get(i) || 0);
  },
  releaseAll(c) {
    for (const k of c.resKeys) if (this.res.get(k) === c.id) this.res.delete(k);
    c.resKeys.length = 0;
    for (const [i, n] of c.itemRes) {
      const v = (this.itemRes.get(i) || 0) - n;
      if (v <= 0) this.itemRes.delete(i); else this.itemRes.set(i, v);
    }
    c.itemRes.length = 0;
  },
  colonistById(id) { return this.colonists.find(c => c.id === id); },

  // ---------- Události ----------
  onTileChanged(x, y) {
    const i = World.idx(x, y);
    if (World.walk[i]) return;
    // kolonisty na nově neprůchodném políčku odsunout
    for (const c of this.colonists) {
      if (c.tx === x && c.ty === y) {
        const p = World.nearestWalkable(x, y);
        c.x = p.x + 0.5; c.y = p.y + 0.5;
        if (c.path) c.path = null;
        if (c.job) c.job.walkKey = null;
      }
    }
  },
  nearLight(x, y) {
    for (const i of World.structSet) {
      const s = World.struct[i];
      if (!s || !BUILD[s.type].light) continue;
      const sx = i % World.w, sy = (i / World.w) | 0;
      if (Math.hypot(sx - x, sy - y) <= BUILD[s.type].light * 0.8) return true;
    }
    return false;
  },
  /** Upozornění nejvýše jednou za `cooldownMin` herních minut. */
  notifyOnce(key, msg, kind, cooldownMin) {
    const last = this.notified.get(key);
    if (last !== undefined && TimeSys.minutes - last < cooldownMin) return;
    this.notified.set(key, TimeSys.minutes);
    UI.toast(msg, kind);
  },

  // ---------- Ovládání ----------
  select(sel) {
    this.selected = sel;
    if (!sel || sel.type !== 'colonist') Camera.follow = null;
    UI.updateInfo(true);
  },
  setSpeed(s) {
    this.speed = s;
    if (s > 0) this.lastSpeed = s;
    UI.updateSpeed();
  },
  togglePause() { this.setSpeed(this.speed === 0 ? this.lastSpeed : 0); },

  // ---------- Simulace ----------
  tick() {
    this.tickCount++;
    TimeSys.tick();
    Weather.tick();
    if (this.tickCount % 30 === 0) World.update(30 * Config.HOURS_PER_TICK);
    for (const c of this.colonists) c.tick();
  },

  start() {
    let last = performance.now();
    let uiT = 0;
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.acc += dt * Config.TPS * this.speed;
      let steps = 0;
      while (this.acc >= 1 && steps < 12) { this.tick(); this.acc -= 1; steps++; }
      if (steps >= 12) this.acc = 0;
      Input.update(dt);
      Camera.update();
      Renderer.draw(dt);
      uiT += dt;
      if (uiT > 0.25) { uiT = 0; UI.update(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
};
