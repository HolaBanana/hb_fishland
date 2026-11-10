'use strict';
/**
 * Game – stav hry, rezervace, herní smyčka s pevným krokem a zrychlením času.
 */
const Game = {
  colonists: [],
  res: new Map(),        // klíč → id kolonisty (rezervace cílů)
  itemRes: new Map(),    // index políčka → rezervovaný počet kusů
  resType: { wood: 0, stone: 0, iron: 0, food: 0, meal: 0 }, // rezervováno celkem podle typu
  speed: 1,
  lastSpeed: 1,
  autoFast: false,       // zrychlit čas, když všichni kolonisté spí
  fastNow: false,        // právě běží automatické zrychlení
  tool: 'select',
  pending: null,         // výběr čekající na potvrzení {tool,x0,y0,x1,y1}
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
    for (const k in this.resType) this.resType[k] = 0;
    this.tickCount = 0; this.pending = null;
    this.colonists = createColonists(World.start);
    Weather.reset();
    Camera.zoom = Config.ZOOM_DEFAULT;
    Camera.centerTile(World.start.x, World.start.y + 1);
  },

  /** Nová kolonie na nové mapě (i za běhu hry). */
  newGame(seed) {
    this.init(seed);
    this.afterLoad();
  },
  /** Načte uloženou hru: svět se vygeneruje ze semínka a doplní se uložené změny. */
  load(data) {
    this.init(data.seed);
    Save.apply(data);
    this.afterLoad();
  },
  afterLoad() {
    this.selected = null;
    this.acc = 0;
    Tools.undoStack.length = 0;
    Camera.follow = null;
    if (UI.ready) UI.reset();
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
  release(key, c) {
    if (this.res.get(key) !== c.id) return;
    this.res.delete(key);
    const k = c.resKeys.indexOf(key);
    if (k >= 0) c.resKeys.splice(k, 1);
  },
  reserveItem(i, n, c) {
    const it = World.items[i];
    if (!it) return;
    this.itemRes.set(i, (this.itemRes.get(i) || 0) + n);
    this.resType[it.type] += n;
    c.itemRes.push([i, n, it.type]);
  },
  dropItemRes(i, n, type) {
    const v = (this.itemRes.get(i) || 0) - n;
    if (v <= 0) this.itemRes.delete(i); else this.itemRes.set(i, v);
    this.resType[type] = Math.max(0, this.resType[type] - n);
  },
  releaseItemRes(c, i) {
    for (let k = c.itemRes.length - 1; k >= 0; k--) {
      const [ii, n, type] = c.itemRes[k];
      if (ii !== i) continue;
      this.dropItemRes(ii, n, type);
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
    for (const [i, n, type] of c.itemRes) this.dropItemRes(i, n, type);
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
    for (const i of World.lights) {
      const s = World.struct[i];
      if (!s) continue;
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
  setAutoFast(on) {
    this.autoFast = !!on;
    try { localStorage.setItem('kolonie.autoFast', on ? '1' : '0'); } catch (e) { /* bez úložiště */ }
  },
  /** Výběr nástrojem čekající na potvrzení (dotyk). */
  setPending(p) { this.pending = p; UI.updateConfirm(); },
  confirmPending() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    Tools.apply(p.tool, Tools.tilesFor(p.tool, p.x0, p.y0, p.x1, p.y1));
    UI.updateConfirm();
  },
  allSleeping() {
    for (const c of this.colonists) if (!c.sleeping) return false;
    return this.colonists.length > 0;
  },
  /** Skutečná rychlost simulace včetně automatického zrychlení noci. */
  effectiveSpeed() {
    const fast = this.speed > 0 && this.autoFast && this.allSleeping();
    if (fast !== this.fastNow) { this.fastNow = fast; document.body.classList.toggle('fast', fast); }
    return fast ? Math.max(this.speed, Config.AUTO_FAST_SPEED) : this.speed;
  },

  // ---------- Simulace ----------
  tick() {
    this.tickCount++;
    const hourBefore = TimeSys.lastHour;
    TimeSys.tick();
    if (TimeSys.lastHour !== hourBefore) Save.auto();   // jednou za herní hodinu
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
      this.acc += dt * Config.TPS * this.effectiveSpeed();
      let steps = 0;
      while (this.acc >= 1 && steps < 16) { this.tick(); this.acc -= 1; steps++; }
      if (steps >= 16) this.acc = 0;
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
