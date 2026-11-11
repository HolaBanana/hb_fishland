'use strict';
/**
 * Game – stav hry, rezervace, herní smyčka s pevným krokem a zrychlením času.
 */
const Game = {
  colonists: [],
  res: new Map(),        // klíč → id kolonisty (rezervace cílů)
  itemRes: new Map(),    // index políčka → rezervovaný počet kusů
  resType: {},           // rezervováno celkem podle typu suroviny
  nextId: 4,
  over: false,
  stats: null,
  alerts: [],            // poslední upozornění {msg, kind, x, y, t}
  shots: [],             // krátké čáry výstřelů pro vykreslení
  speed: 1,
  lastSpeed: 1,
  autoFast: false,       // zrychlit čas, když všichni kolonisté spí
  peaceful: false,       // mírumilovný režim – bez nájezdů
  difficulty: 'normal',  // easy | normal | hard
  fastNow: false,        // právě běží automatické zrychlení
  tool: 'select',
  pending: null,         // výběr čekající na potvrzení {tool,x0,y0,x1,y1,dir}
  buildDir: 0,           // otočení umisťované stavby (0 východ, 1 jih, 2 západ, 3 sever)
  selected: null,
  tickCount: 0,
  notified: new Map(),
  acc: 0,

  init(seed, opts, roster) {
    this.seed = seed;
    U.seed(seed);
    TimeSys.reset();
    World.generate(seed, opts);
    this.opts = World.opts;
    this.difficulty = World.opts.difficulty;
    this.peaceful = !!World.opts.peaceful;
    this.history = [];
    Pathfinder.init(World.w, World.h);
    Sprites.buildTerrain();
    if (Renderer.clearChunks) Renderer.clearChunks();
    this.res.clear(); this.itemRes.clear(); this.notified.clear();
    for (const k of ITEM_KEYS) this.resType[k] = 0;
    this.tickCount = 0; this.pending = null;
    this.over = false;
    this.alerts = [];
    this.shots = [];
    this.stats = { built: 0, chopped: 0, mined: 0, cooked: 0, harvested: 0, cropsEaten: 0, joined: 0, crafted: 0, machined: 0, deaths: [] };
    Fire.reset(); Animals.reset(); Power.reset(); Research.reset(); Pollution.reset();
    this.colonists = roster ? placeRoster(roster, World.start) : createColonists(World.start);
    this.nextId = this.colonists.length;
    Quests.reset();
    Weather.reset();
    Events.reset(); Trade.reset(); Combat.reset(); Carts.reset();
    Camera.zoom = Config.ZOOM_DEFAULT;
    Camera.centerTile(World.start.x, World.start.y + 1);
  },

  /** Nová kolonie na nové mapě (i za běhu hry). */
  newGame(seed, opts, roster) {
    this.init(seed, opts, roster);
    this.afterLoad();
  },
  /** Načte uloženou hru: svět se vygeneruje ze semínka a doplní se uložené změny. */
  load(data) {
    this.init(data.seed, data.opts);
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
  /** Upozornění vázané na místo na mapě (ukládá se do seznamu upozornění). */
  alert(msg, kind, x, y) {
    this.alerts.push({ msg, kind, x, y, t: TimeSys.minutes });
    if (this.alerts.length > 40) this.alerts.shift();
    UI.toast(msg, kind);
  },
  /** Hodinový vzorek zásob pro graf (posledních 14 dní). */
  sample() {
    const row = { t: Math.round(TimeSys.minutes), n: Game.colonists.length };
    for (const k of ITEM_KEYS) if (World.counts[k]) row[k] = World.counts[k];
    this.history.push(row);
    if (this.history.length > 24 * 14) this.history.shift();
  },
  /** Výstřel / hod – jen vizuální stopa. */
  shot(x0, y0, x1, y1, col) { if (this.shots.length < 40) this.shots.push({ x0, y0, x1, y1, col, t: 7 }); },
  /** Smrt kolonisty; když zemřou všichni, hra končí. */
  killColonist(c, cause) {
    if (c.dead) return;
    c.dead = true;
    c.endJob();
    if (c.coat) World.dropItem(c.tx, c.ty, 'coat', 1);
    if (c.bow) World.dropItem(c.tx, c.ty, 'bow', 1);
    for (const i of World.structBy.bed || []) if (World.struct[i].owner === c.id) World.struct[i].owner = -1;
    this.colonists = this.colonists.filter(q => q !== c);
    this.stats.deaths.push({ name: c.name, day: TimeSys.day, cause });
    Social.onDeath(c);
    if (this.selected && this.selected.c === c) this.select(null);
    if (Camera.follow === c) Camera.follow = null;
    UI.buildColonistBar();
    this.alert(`${c.name} zemřel/a ${cause}.`, 'warn', c.tx, c.ty);
    if (!this.colonists.length) {
      this.over = true;
      Save.clear();
      UI.gameOver();
    }
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
  setPeaceful(on) {
    this.peaceful = !!on;
    if (this.opts) this.opts.peaceful = !!on;
    if (on && Combat.raiders.length) { for (const r of Combat.raiders) r.flee(); }
  },
  setLowPower(on) {
    this.lowPower = !!on;
    try { localStorage.setItem('kolonie.lowPower', on ? '1' : '0'); } catch (e) { /* bez úložiště */ }
  },
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
    Tools.apply(p.tool, Tools.tilesFor(p.tool, p.x0, p.y0, p.x1, p.y1), p.dir);
    UI.updateConfirm();
  },
  /** Otočí umisťovanou stavbu o 90°. */
  rotate() {
    this.buildDir = (this.buildDir + 1) % 4;
    if (this.pending) this.pending.dir = Tools.dirFor(this.pending.tool, this.pending.x0, this.pending.y0, this.pending.x1, this.pending.y1);
    UI.updateRotate();
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
    if (TimeSys.lastHour !== hourBefore) { this.sample(); Events.hourly(); Animals.hourly(); Trade.hourly(); Combat.hourly(); Social.hourly(); Save.auto(); }   // jednou za herní hodinu
    Weather.tick();
    if (this.tickCount % 30 === 0) {
      const hours = 30 * Config.HOURS_PER_TICK;
      World.update(hours);
      Fire.update(hours);
    }
    if (this.tickCount % 10 === 0) Power.update(10);
    Machines.tick();
    if (this.tickCount % 60 === 0) Pollution.update();
    Combat.tick();
    Carts.tick();
    Animals.tick();
    for (const c of this.colonists.slice()) c.tick();
  },

  start() {
    let last = performance.now();
    let uiT = 0, frame = 0, drawDt = 0;
    const loop = (now) => {
      const dt = U.clamp((now - last) / 1000, 0, 0.1);
      last = now;
      this.acc += dt * Config.TPS * this.effectiveSpeed();
      let steps = 0;
      while (this.acc >= 1 && steps < 16 && !this.over) { this.tick(); this.acc -= 1; steps++; }
      if (steps >= 16) this.acc = 0;
      Input.update(dt);
      Camera.update();
      // úsporný režim: kreslit jen každý druhý snímek (~30 snímků/s)
      drawDt += dt;
      if (!this.lowPower || (frame++ & 1) === 0) { Renderer.draw(drawDt); drawDt = 0; }
      uiT += dt;
      if (uiT > 0.25) { uiT = 0; UI.update(); Sound.update(); if (!this.over) Quests.check(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
};
