'use strict';
/**
 * Events – náhodné události: příchod nového kolonisty, nájezd zvěře na pole.
 * (Požár po blesku spouští Weather.strike.) Kontroluje se jednou za herní hodinu.
 */
const Events = {
  nextJoin: 0,
  nextRaid: 0,

  reset() {
    this.nextJoin = TimeSys.minutes + 60 * 24 * U.range(3, 5);
    this.nextRaid = TimeSys.minutes + 60 * 24 * U.range(2, 3.5);
  },
  hourly() {
    const now = TimeSys.minutes;
    if (now >= this.nextJoin) {
      this.nextJoin = now + 60 * 24 * U.range(6, 10);
      if (Game.colonists.length < Config.MAX_COLONISTS && TimeSys.daylight() > 0.5) this.wanderer();
      else this.nextJoin = now + 60 * 6;
    }
    if (now >= this.nextRaid) {
      // zvěř chodí na pole za soumraku a v noci, ne v zimě
      if (TimeSys.season !== 3 && TimeSys.daylight() < 0.6 && Animals.boarRaid()) this.nextRaid = now + 60 * 24 * U.range(2.5, 5);
      else this.nextRaid = now + 60 * 3;
    }
  },
  /** K osadě se přidá poutník. */
  wanderer() {
    const s = World.start;
    let pos = null;
    for (let k = 0; k < 80 && !pos; k++) {
      const ang = U.rand() * Math.PI * 2, r = U.range(14, 22);
      const x = Math.round(s.x + Math.cos(ang) * r), y = Math.round(s.y + Math.sin(ang) * r);
      if (World.canWalk(x, y) && Pathfinder.find(x, y, s.x, s.y, 1)) pos = { x, y };
    }
    if (!pos) return;
    const used = new Set(Game.colonists.map(c => c.first));
    const c = makeColonist(Game.nextId++, pos.x, pos.y, used);
    Game.colonists.push(c);
    Game.stats.joined++;
    UI.buildColonistBar();
    Game.alert(`${c.name} (${c.trait.name.toLowerCase()}) se přidává ke kolonii!`, 'good', pos.x, pos.y);
  },
  pack() { return { nextJoin: this.nextJoin, nextRaid: this.nextRaid }; },
  unpack(d) { if (d) { this.nextJoin = d.nextJoin; this.nextRaid = d.nextRaid; } else this.reset(); },
};
