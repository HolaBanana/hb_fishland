'use strict';
/**
 * Animals – zvěř na mapě. Zatím divočáci, kteří při nájezdu žerou úrodu na
 * polích; bdělý kolonista poblíž je zaplaší.
 */
class Animal {
  constructor(type, x, y) {
    this.type = type;
    this.x = x + 0.5; this.y = y + 0.5;
    this.dir = 'left';
    this.state = 'raid';      // raid | eat | flee
    this.path = null; this.pathI = 0;
    this.timer = 0;
    this.target = -1;
    this.leaveAt = TimeSys.minutes + 60 * 6;
    this.animT = 0;
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
  scared() {
    for (const c of Game.colonists) {
      if (!c.sleeping && Math.hypot(c.x - this.x, c.y - this.y) < 3) return true;
    }
    return false;
  }
  flee() {
    this.state = 'flee';
    // utéct pryč od kolonie
    const s = World.start;
    const ang = Math.atan2(this.y - s.y, this.x - s.x) + U.range(-0.5, 0.5);
    for (let r = 26; r > 6; r -= 4) {
      const x = Math.round(this.x + Math.cos(ang) * r), y = Math.round(this.y + Math.sin(ang) * r);
      if (World.canWalk(x, y) && this.goTo(x, y)) return;
    }
    this.gone = true;
  }
  nearestCrop() {
    let best = -1, bd = Infinity;
    for (const i of World.cropSet) {
      const d = Math.abs((i % World.w) - this.tx) + Math.abs(((i / World.w) | 0) - this.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  tick() {
    if (this.state === 'flee') { if (this.step(0.13)) this.gone = true; return; }
    if (TimeSys.minutes > this.leaveAt || this.scared()) { this.flee(); return; }
    if (this.state === 'raid') {
      if (this.target < 0 || !World.crops[this.target]) {
        this.target = this.nearestCrop();
        if (this.target < 0 || !this.goTo(this.target % World.w, (this.target / World.w) | 0)) { this.flee(); return; }
      }
      if (this.step(0.075)) { this.state = 'eat'; this.timer = 420; }
    } else if (this.state === 'eat') {
      if (--this.timer <= 0) {
        if (World.crops[this.target]) { World.removeCrop(this.target); Game.stats.cropsEaten++; }
        this.target = -1;
        this.state = 'raid';
      }
    }
  }
}

const Animals = {
  list: [],
  reset() { this.list = []; },
  tick() {
    if (!this.list.length) return;
    for (const a of this.list) a.tick();
    if (this.list.some(a => a.gone)) this.list = this.list.filter(a => !a.gone);
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
      this.list.push(new Animal('boar', x, y));
      n++;
    }
    if (n) Game.alert('Divočáci se ženou na pole! Kolonista poblíž je zaplaší.', 'warn', cx, cy);
    return n > 0;
  },
  pack() { return this.list.map(a => ({ type: a.type, x: a.x, y: a.y, leaveAt: a.leaveAt })); },
  unpack(arr) {
    this.list = (arr || []).map(d => { const a = new Animal(d.type, Math.floor(d.x), Math.floor(d.y)); a.leaveAt = d.leaveAt; return a; });
  },
};
