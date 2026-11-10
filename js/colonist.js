'use strict';
/**
 * Colonist – kolonista: potřeby (hlad, energie, nálada), dovednosti, priority, AI a pohyb.
 */
class Colonist {
  constructor(id, x, y, opts) {
    this.id = id;
    this.gender = opts.gender;
    this.first = opts.first;
    this.last = opts.last;
    this.name = opts.first + ' ' + opts.last;
    this.look = opts.look;
    this.trait = opts.trait;
    this.age = opts.age;
    this.sprites = Sprites.colonist(this.look);
    this.portrait = Sprites.portrait(this.sprites);

    this.x = x + 0.5; this.y = y + 0.5;
    this.dir = 'down'; this.animT = 0; this.moving = false;

    this.skills = {};
    for (const k in SKILLS) this.skills[k] = { lvl: opts.skills[k], xp: 0 };
    this.priorities = {};
    for (const wt of WORK_TYPES) {
      if (!wt.skill) { this.priorities[wt.id] = 3; continue; }
      const l = this.skills[wt.skill].lvl;
      this.priorities[wt.id] = l >= 8 ? 1 : l >= 4 ? 2 : l >= 2 ? 3 : 4;
    }

    this.hunger = U.range(70, 90);
    this.energy = U.range(75, 95);
    this.health = 100;
    this.dead = false;
    this.mood = 60;
    this.moodTarget = 60;
    this.thoughts = [];

    this.job = null;
    this.path = null; this.pathI = 0; this.dest = null;
    this.carry = null;
    this.activity = 'Rozhlíží se';
    this.thinkCd = U.int(1, 10);
    this.unreach = new Map();
    this.resKeys = [];
    this.itemRes = [];
    this.sleeping = false;
    this.eating = false;
    this.workFrac = -1;
    this.working = false;
    this.breakUntil = 0;
    this.tickN = U.int(0, 29);
  }

  get tx() { return Math.floor(this.x); }
  get ty() { return Math.floor(this.y); }
  inBreak() { return this.breakUntil > TimeSys.minutes; }

  // ---------- Dovednosti a práce ----------
  skillFactor(skill) { return 0.55 + this.skills[skill].lvl * 0.075; }
  moodFactor() { return this.mood < 25 ? 0.8 : this.mood > 75 ? 1.12 : 1; }
  work(skill) {
    this.working = true;
    let f = (skill ? this.skillFactor(skill) : 1) * this.moodFactor() * (this.trait.work || 1);
    if (this.hunger < 5) f *= 0.7;
    if (skill) this.gainXp(skill, 0.07);
    return f;
  }
  xpNeed(lvl) { return 50 + lvl * 18; }
  gainXp(skill, amount) {
    const s = this.skills[skill];
    if (s.lvl >= 20) return;
    s.xp += amount * (this.trait.learn || 1);
    while (s.xp >= this.xpNeed(s.lvl) && s.lvl < 20) {
      s.xp -= this.xpNeed(s.lvl);
      s.lvl++;
      UI.toast(`${this.first} se zlepšil/a: ${SKILLS[skill]} → ${s.lvl}`, 'good');
    }
  }

  // ---------- Myšlenky a nálada ----------
  addThought(id, label, val, hours) {
    this.thoughts = this.thoughts.filter(t => t.id !== id);
    this.thoughts.push({ id, label, val, until: TimeSys.minutes + hours * 60 });
  }
  moodFactors() {
    const out = [{ label: 'Základ', val: 50 }];
    if (this.trait.mood) out.push({ label: this.trait.name, val: this.trait.mood });
    for (const t of this.thoughts) out.push({ label: t.label, val: t.val });
    if (this.hunger < 5) out.push({ label: 'Hladoví', val: -20 });
    else if (this.hunger < 25) out.push({ label: 'Má hlad', val: -8 });
    if (this.energy < 10) out.push({ label: 'Vyčerpání', val: -14 });
    else if (this.energy < 25) out.push({ label: 'Únava', val: -6 });
    const here = World.idx(this.tx, this.ty);
    const roofed = World.isRoofed(here);
    const temp = World.tempAt(here);
    if (this.health < 40) out.push({ label: 'Podlomené zdraví', val: -8 });
    if (Weather.rain > 0.3 && !roofed) out.push({ label: temp < 0 ? 'Sněží mu/jí za krk' : 'Moknutí v dešti', val: -4 });
    if (temp < -2) out.push({ label: 'Mrzne', val: -8 });
    else if (temp < 6) out.push({ label: 'Je mu/jí zima', val: -4 });
    else if (roofed && TimeSys.temp() < 6) out.push({ label: 'Teplo domova', val: 3 });
    if (World.floor[here]) out.push({ label: 'Pěkné prostředí', val: 2 });
    if (TimeSys.daylight() < 0.4 && Game.nearLight(this.tx, this.ty)) out.push({ label: 'Teplo a světlo ohně', val: 3 });
    if (Weather.cur === 'clear' && TimeSys.daylight() > 0.8) out.push({ label: 'Krásný den', val: 2 });
    return out;
  }
  updateMood(hours) {
    const now = TimeSys.minutes;
    this.thoughts = this.thoughts.filter(t => t.until > now);
    this.moodTarget = U.clamp(this.moodFactors().reduce((s, f) => s + f.val, 0), 0, 100);
    const r = 8 * hours;
    this.mood += U.clamp(this.moodTarget - this.mood, -r, r);
    // psychické zhroucení
    if (this.mood < 18 && !this.inBreak() && U.chance(0.3 * hours)) {
      this.breakUntil = now + 60 * 3;
      if (this.job) this.endJob();
      UI.toast(`${this.first} má psychické zhroucení! Na chvíli odmítá pracovat.`, 'warn');
    }
  }

  // ---------- Zdraví ----------
  /** Dlouhé hladovění a vyčerpání ubírají zdraví; sytý a odpočatý kolonista se léčí. */
  updateHealth(hours) {
    let d = 0, cause = '';
    if (this.hunger <= 0) { d -= 4.5 * hours; cause = 'hladem'; }
    if (this.energy <= 0) { d -= 2 * hours; cause = cause || 'vyčerpáním'; }
    if (d === 0 && this.hunger > 30 && this.energy > 15) d = (this.sleeping ? 3 : 1.5) * hours;
    if (d < 0 && this.health >= 50 && this.health + d < 50) Game.alert(`${this.first} je ve vážném stavu – umírá ${cause}!`, 'warn', this.tx, this.ty);
    this.health = U.clamp(this.health + d, 0, 100);
    if (this.health <= 0) Game.killColonist(this, cause || 'vyčerpáním');
  }

  // ---------- Pohyb ----------
  speed() {
    let s = 0.105 * (this.trait.move || 1);
    if (this.energy < 10) s *= 0.8;
    if (this.hunger < 5) s *= 0.85;
    if (this.health < 40) s *= 0.8;
    if (this.carry) s *= 0.92;
    return s;
  }
  pathTo(x, y, mode) {
    const p = Pathfinder.find(this.tx, this.ty, x, y, mode);
    if (!p) { this.path = null; return false; }
    this.path = p; this.pathI = 0; this.dest = { x, y, mode };
    return true;
  }
  followPath() {
    if (!this.path) return 'fail';
    if (this.pathI >= this.path.length) {
      // dosednout do středu políčka
      const cx = this.tx + 0.5, cy = this.ty + 0.5;
      const d = Math.hypot(cx - this.x, cy - this.y);
      if (d > 0.02) {
        const sp = Math.min(d, this.speed());
        this.x += (cx - this.x) / d * sp; this.y += (cy - this.y) / d * sp;
        this.moving = true;
        if (d > sp) return 'moving';
      }
      this.path = null;
      return 'arrived';
    }
    const ni = this.path[this.pathI];
    if (!World.walk[ni]) {
      // cesta se zablokovala – přepočítat
      if (!this.pathTo(this.dest.x, this.dest.y, this.dest.mode)) return 'fail';
      return 'moving';
    }
    const nx = (ni % World.w) + 0.5, ny = Math.floor(ni / World.w) + 0.5;
    const dx = nx - this.x, dy = ny - this.y;
    const d = Math.hypot(dx, dy);
    const ci = World.idx(this.tx, this.ty);
    const sp = this.speed() / ((World.cost[ni] + World.cost[ci]) * 0.5);
    if (d <= sp) { this.x = nx; this.y = ny; this.pathI++; }
    else { this.x += dx / d * sp; this.y += dy / d * sp; }
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left';
    else if (Math.abs(dy) > 0.01) this.dir = dy > 0 ? 'down' : 'up';
    this.moving = true;
    this.animT += sp;
    if (this.pathI >= this.path.length) return this.followPath();
    return 'moving';
  }
  face(x, y) {
    const dx = x + 0.5 - this.x, dy = y + 0.5 - this.y;
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left';
    else if (Math.abs(dy) > 0.01) this.dir = dy > 0 ? 'down' : 'up';
  }

  // ---------- Předměty ----------
  pickup(i, want, type) {
    Game.releaseItemRes(this, i);
    const it = World.items[i];
    if (!it || it.type !== type) return false;
    if (this.carry && this.carry.type !== type) this.dropCarry();
    const have = this.carry ? this.carry.n : 0;
    const age = it.age || 0;
    const k = World.takeItem(i, Math.min(want, Config.CARRY - have));
    if (k <= 0) return false;
    if (this.carry) { this.carry.age = (this.carry.age * have + age * k) / (have + k); this.carry.n += k; }
    else this.carry = { type, n: k, age };
    return true;
  }
  dropCarry() {
    if (!this.carry) return;
    World.dropItem(this.tx, this.ty, this.carry.type, this.carry.n, this.carry.age || 0);
    this.carry = null;
  }

  // ---------- Úkoly ----------
  startJob(job) {
    this.job = job;
    job.stage = 0; job.progress = 0; job.walkKey = null;
    if (job.key) Game.reserve(job.key, this);
    if (job.type === 'eat') Game.reserveItem(job.i, 1, this);
    if (job.type === 'sleep' && job.bed >= 0) Game.reserve('b' + job.bed, this);
  }
  endJob() {
    Game.releaseAll(this);
    this.dropCarry();
    this.job = null;
    this.path = null;
    this.sleeping = false;
    this.workFrac = -1;
  }

  think() {
    const night = TimeSys.isNight();
    if (this.inBreak()) { this.startJob({ type: 'wander' }); return; }
    // hašení požáru má přednost před vším kromě holého přežití
    if (Fire.tiles.size && this.hunger > 12 && this.energy > 8) {
      const f = Jobs.findFire(this);
      if (f >= 0) { this.startJob({ type: 'firefight', i: f, key: 'f' + f }); return; }
    }
    if (this.hunger < 30) {
      const f = Jobs.findFood(this);
      if (f >= 0) { this.startJob({ type: 'eat', i: f, key: 'e' + f + '_' + this.id }); return; }
      Game.notifyOnce('nofood', 'Kolonisté nemají co jíst! Sbírejte bobule nebo založte pole.', 'warn', 180);
    }
    if (this.energy < 25 || (night && this.energy < 92)) {
      this.startJob({ type: 'sleep', bed: Jobs.findBed(this) });
      return;
    }
    const job = Jobs.findWork(this);
    if (job) { this.startJob(job); return; }
    this.startJob({ type: 'wander' });
  }

  tick() {
    const h = Config.HOURS_PER_TICK;
    this.moving = false;
    this.working = false;
    this.eating = false;
    // potřeby
    this.hunger = Math.max(0, this.hunger - (100 / 20) * h * (this.trait.hunger || 1) * (this.sleeping ? 0.5 : 1));
    if (!this.sleeping) this.energy = Math.max(0, this.energy - (100 / 21) * h);
    if (++this.tickN >= 30) { this.tickN = 0; this.updateMood(30 * h); this.updateHealth(30 * h); if (this.dead) return; }

    // přerušení kvůli naléhavým potřebám
    if (this.job) {
      const t = this.job.type;
      if (t !== 'eat' && t !== 'sleep' && this.hunger < 12 && this.tickN === 0 && Jobs.findFood(this) >= 0) this.endJob();
      else if (t !== 'sleep' && this.energy <= 1) {
        this.endJob();
        this.startJob({ type: 'sleep', bed: -1, collapse: true });
        UI.toast(`${this.first} se zhroutil/a vyčerpáním!`, 'warn');
      } else if (t === 'wander' && !this.inBreak() && this.job.stage === 2 && this.job.wait > 20 && --this.thinkCd <= 0) {
        // během odpočinku se občas podívat po práci
        this.thinkCd = 20;
        if (Fire.tiles.size || Jobs.findWork(this) || this.hunger < 30 || this.energy < 25 || (TimeSys.isNight() && this.energy < 92)) this.endJob();
      }
    }
    if (!this.job) {
      if (--this.thinkCd <= 0) { this.thinkCd = 6; this.think(); }
    }
    if (this.job) {
      const r = Jobs.drivers[this.job.type](this, this.job);
      if (r === Jobs.DONE) { this.endJob(); this.thinkCd = 1; }
      else if (r === Jobs.FAIL) { this.endJob(); this.thinkCd = 4; }
    }
    if (!this.working && !this.eating) this.workFrac = -1;
  }
}

const LOOKS = {
  skins: [[241, 200, 160], [224, 172, 128], [198, 140, 98], [150, 100, 66], [245, 214, 180]],
  hairs: [[60, 40, 26], [30, 24, 20], [164, 104, 50], [214, 178, 96], [120, 70, 40], [190, 80, 40], [90, 90, 96]],
  shirts: [[180, 60, 56], [58, 108, 170], [70, 140, 80], [196, 150, 52], [130, 80, 160], [60, 150, 150], [200, 110, 60], [150, 150, 160]],
  pants: [[60, 64, 90], [80, 64, 48], [50, 54, 60], [96, 84, 64]],
};

/** Vytvoří náhodného kolonistu. `opts` může vnutit pohlaví, specializaci, rys a barvu trička. */
function makeColonist(id, x, y, usedFirst, opts = {}) {
  const gender = opts.gender || (U.chance(0.5) ? 'm' : 'f');
  let first, guard = 0;
  do { first = U.pick(NAMES[gender].first); } while (usedFirst.has(first) && ++guard < 50);
  usedFirst.add(first);
  const last = U.pick(NAMES[gender].last);
  const keys = Object.keys(SKILLS);
  const skills = {};
  for (const s of keys) skills[s] = U.int(0, 5);
  skills[opts.special || U.pick(keys)] = U.int(8, 12);
  skills[U.pick(keys)] += U.int(1, 3);
  const look = {
    skin: U.pick(LOOKS.skins),
    hair: U.pick(LOOKS.hairs),
    shirt: opts.shirt || U.pick(LOOKS.shirts),
    pants: U.pick(LOOKS.pants),
    style: gender === 'f' ? U.pick(['long', 'long', 'bun', 'short']) : U.pick(['short', 'short', 'spiky', 'bald', 'beard']),
  };
  return new Colonist(id, x, y, { gender, first, last, look, skills, trait: opts.trait || U.pick(TRAITS), age: U.int(19, 52) });
}

/** Vytvoří náhodnou startovní skupinu kolonistů (každý má jinou specializaci). */
function createColonists(start) {
  const out = [];
  const usedFirst = new Set();
  const skillKeys = U.shuffle(Object.keys(SKILLS));
  const traits = U.shuffle(TRAITS.slice());
  const shirts = U.shuffle(LOOKS.shirts.slice());
  const offsets = [[-1, 0], [1, 0], [0, 1], [2, 1]];
  for (let k = 0; k < 4; k++) {
    const gender = k % 2 === 0 ? (U.chance(0.5) ? 'm' : 'f') : (out[k - 1].gender === 'm' ? 'f' : 'm');
    const [ox, oy] = offsets[k];
    const p = World.canWalk(start.x + ox, start.y + oy) ? { x: start.x + ox, y: start.y + oy } : World.nearestWalkable(start.x, start.y);
    out.push(makeColonist(k, p.x, p.y, usedFirst, { gender, special: skillKeys[k], trait: traits[k], shirt: shirts[k] }));
  }
  return out;
}
