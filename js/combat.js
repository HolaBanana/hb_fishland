'use strict';
/**
 * Combat – nájezdy a obrana. Nájezdníci přicházejí ve vlnách, které sílí
 * s bohatstvím kolonie; útočí na kolonisty a prorážejí dveře, brány a zdi.
 * Brání se kolonisté s kuší a automatické střílny zásobované municí.
 * V mírumilovném režimu (Game.peaceful) nájezdy nechodí.
 */
class Raider {
  constructor(x, y) {
    this.x = x + 0.5; this.y = y + 0.5;
    this.hp = 60; this.maxHp = 60;
    this.dir = 'down'; this.animT = 0; this.moving = false;
    this.path = null; this.pathI = 0;
    this.cd = U.int(0, 30);
    this.repath = 0;
    this.breaking = -1;     // index stavby, kterou právě rozbíjí
    this.fleeing = false;
    this.gone = false;
  }
  get tx() { return Math.floor(this.x); }
  get ty() { return Math.floor(this.y); }

  step(speed) {
    this.moving = false;
    if (!this.path || this.pathI >= this.path.length) return true;
    const ni = this.path[this.pathI];
    const s = World.struct[ni];
    // dveře a brány se nájezdníkům neotevřou – musí je prorazit
    if (s && BUILD[s.type].door && !this.fleeing) { this.breaking = s.i; this.path = null; return false; }
    if (!World.walk[ni]) { this.path = null; return true; }
    const nx = (ni % World.w) + 0.5, ny = Math.floor(ni / World.w) + 0.5;
    const dx = nx - this.x, dy = ny - this.y, d = Math.hypot(dx, dy);
    const sp = speed / World.cost[ni];
    if (d <= sp) { this.x = nx; this.y = ny; this.pathI++; }
    else { this.x += dx / d * sp; this.y += dy / d * sp; }
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left'; else this.dir = dy > 0 ? 'down' : 'up';
    this.animT += sp; this.moving = true;
    return false;
  }
  /** Nejbližší zeď / dveře / jiná stavba jako cíl ničení. */
  nearestStruct(onlyBarrier) {
    let best = -1, bd = Infinity;
    for (const i of World.structSet) {
      const s = World.struct[i], def = BUILD[s.type];
      if (onlyBarrier && !def.wall && !def.door) continue;
      if (def.machine && def.machine.belt) continue;
      const d = Math.abs((i % World.w) - this.tx) + Math.abs(((i / World.w) | 0) - this.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return bd <= 40 ? best : -1;
  }
  hitStruct() {
    const s = World.struct[this.breaking];
    if (!s) { this.breaking = -1; return; }
    const w = World.w;
    let reach = Infinity;
    for (const t of s.tiles) reach = Math.min(reach, Math.max(Math.abs((t % w) - this.tx), Math.abs(((t / w) | 0) - this.ty)));
    if (reach > 1) {
      // není na dosah → dojít k ní
      if (!this.path || this.pathI >= this.path.length) {
        this.path = Pathfinder.find(this.tx, this.ty, s.i % w, (s.i / w) | 0, 2);
        this.pathI = 0;
        if (!this.path || !this.path.length) { this.breaking = -1; this.path = null; return; }
      }
      const b = this.breaking;
      this.step(0.085);
      this.breaking = b;
      return;
    }
    this.moving = false;
    if (this.cd > 0) return;
    this.cd = 38;
    s.hp = (s.hp !== undefined ? s.hp : Combat.hpOf(s)) - 14;
    Sound.play('hit', this.x, this.y);
    if (s.hp <= 0) {
      const x = s.i % w, y = (s.i / w) | 0;
      Game.alert(`Nájezdníci zničili: ${BUILD[s.type].name.toLowerCase()}.`, 'warn', x, y);
      World.destroyStruct(s.i);
      Game.onTileChanged(x, y);
      this.breaking = -1;
    }
  }

  tick() {
    if (this.cd > 0) this.cd--;
    if (this.fleeing) { if (this.step(0.11)) this.gone = true; return; }
    // nejbližší kolonista
    let tc = null, td = 10;
    for (const c of Game.colonists) { const d = Math.hypot(c.x - this.x, c.y - this.y); if (d < td) { td = d; tc = c; } }
    if (tc && td <= 1.5) {
      this.moving = false;
      if (this.cd <= 0) {
        this.cd = 42;
        tc.health -= 9 * Combat.diff().dmg;
        if (tc.sleeping && tc.job) tc.endJob();
        Sound.play('hit', this.x, this.y);
        if (tc.health <= 0) Game.killColonist(tc, 'v boji s nájezdníky');
      }
      return;
    }
    if (this.breaking >= 0) { this.hitStruct(); return; }
    if (!this.path || --this.repath <= 0) {
      this.repath = 45;
      const s = World.start;
      const gx = tc ? tc.tx : s.x, gy = tc ? tc.ty : s.y;
      this.path = Pathfinder.find(this.tx, this.ty, gx, gy, 1);
      this.pathI = 0;
      if (!this.path || (!tc && this.path.length < 2)) {
        // nedostane se dovnitř nebo už stojí v kolonii → ničit stavby
        this.breaking = this.nearestStruct(!this.path);
        this.path = null;
        return;
      }
    }
    this.step(0.085);
  }
  flee() {
    this.fleeing = true; this.breaking = -1;
    const s = World.start;
    const ang = Math.atan2(this.y - s.y, this.x - s.x);
    for (let r = 30; r > 6; r -= 4) {
      const x = Math.round(this.x + Math.cos(ang) * r), y = Math.round(this.y + Math.sin(ang) * r);
      if (World.canWalk(x, y)) { this.path = Pathfinder.find(this.tx, this.ty, x, y, 0); this.pathI = 0; if (this.path) return; }
    }
    this.gone = true;
  }
}

const Combat = {
  raiders: [],
  next: 0,
  until: 0,
  count: 0,           // kolikátý nájezd
  FIRST_DAY: 6,
  HP: { wall_wood: 120, wall_stone: 320, door: 90, gate: 280 },
  DIFF: { easy: { n: 0.6, dmg: 0.7 }, normal: { n: 1, dmg: 1 }, hard: { n: 1.5, dmg: 1.3 } },

  reset() { this.raiders = []; this.count = 0; this.until = 0; this.next = TimeSys.minutes + 60 * 24 * U.range(this.FIRST_DAY, this.FIRST_DAY + 2); },
  diff() { return this.DIFF[Game.difficulty] || this.DIFF.normal; },
  hpOf(s) { return this.HP[s.type] || 70; },
  /** Bohatství kolonie – podle něj sílí nájezdy. */
  wealth() {
    let w = World.structSet.size * 6;
    for (const k in World.counts) w += World.counts[k] * (VALUE[k] || 1);
    return Math.round(w);
  },
  raidSize() { return U.clamp(Math.round((1 + this.wealth() / 1400 + this.count * 0.4) * this.diff().n), 1, 12); },

  hourly() {
    if (Game.peaceful) return;
    const now = TimeSys.minutes;
    if (!this.raiders.length && now >= this.next) {
      if (TimeSys.daylight() > 0.3) this.spawn(this.raidSize());
      else this.next = now + 60;
    }
  },
  spawn(n) {
    const s = World.start;
    const ang0 = U.rand() * Math.PI * 2;
    let made = 0, px = s.x, py = s.y;
    for (let k = 0; k < 200 && made < n; k++) {
      const ang = ang0 + U.range(-0.25, 0.25), r = U.range(26, 34);
      const x = Math.round(s.x + Math.cos(ang) * r), y = Math.round(s.y + Math.sin(ang) * r);
      if (!World.canWalk(x, y) || World.isRoofed(World.idx(x, y))) continue;
      this.raiders.push(new Raider(x, y));
      px = x; py = y; made++;
    }
    if (!made) { this.next = TimeSys.minutes + 120; return; }
    this.count++;
    this.until = TimeSys.minutes + 60 * 10;
    this.next = TimeSys.minutes + 60 * 24 * U.range(4, 7);
    Game.alert(`Nájezd! ${made} ${made === 1 ? 'nájezdník se blíží' : made < 5 ? 'nájezdníci se blíží' : 'nájezdníků se blíží'} ke kolonii.`, 'warn', px, py);
    Sound.play('alarm');
  },
  hurt(r, dmg) {
    r.hp -= dmg;
    if (r.hp <= 0 && !r.gone) {
      r.gone = true;
      Game.stats.raidersKilled = (Game.stats.raidersKilled || 0) + 1;
      if (U.chance(0.35)) World.dropItem(r.tx, r.ty, 'leather', 1);
    }
  },
  nearest(x, y, maxD) {
    let best = null, bd = maxD;
    for (const r of this.raiders) {
      if (r.gone) continue;
      const d = Math.hypot(r.x - x, r.y - y);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  },

  tick() {
    // střílny
    const turrets = World.structBy.turret;
    if (turrets && this.raiders.length) for (const i of turrets) {
      const s = World.struct[i];
      if (s.decon || s.broken) continue;
      if (s.cd > 0) { s.cd--; continue; }
      if ((s.inv.ammo || 0) < 1) { s.msg = 'Bez munice'; continue; }
      const x = (i % World.w) + 0.5, y = ((i / World.w) | 0) + 0.5;
      const r = this.nearest(x, y, 7.5);
      if (!r) continue;
      s.cd = 20; s.inv.ammo--; s.aim = Math.atan2(r.y - y, r.x - x);
      Game.shot(x, y - 0.3, r.x, r.y - 0.3, '#ffd257');
      Sound.play('shot', x, y);
      if (U.chance(0.8)) this.hurt(r, 16);
    }
    if (!this.raiders.length) return;
    const leaving = TimeSys.minutes > this.until;
    for (const r of this.raiders) {
      if (leaving && !r.fleeing) r.flee();
      r.tick();
    }
    if (this.raiders.some(r => r.gone)) {
      this.raiders = this.raiders.filter(r => !r.gone);
      if (!this.raiders.length) Game.alert(leaving ? 'Nájezdníci odtáhli.' : 'Nájezd byl odražen!', 'good');
    }
  },
  pack() { return { next: this.next, until: this.until, count: this.count, raiders: this.raiders.map(r => ({ x: r.x, y: r.y, hp: r.hp })) }; },
  unpack(d) {
    this.reset();
    if (!d) return;
    this.next = d.next; this.until = d.until; this.count = d.count || 0;
    for (const q of d.raiders || []) { const r = new Raider(Math.floor(q.x), Math.floor(q.y)); r.x = q.x; r.y = q.y; r.hp = q.hp; this.raiders.push(r); }
  },
};

/** Zvuk přijde v další části – do té doby prázdná náhrada. */
const Sound = { play() {} };
