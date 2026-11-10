'use strict';
/**
 * Social – vztahy mezi kolonisty. Přátelství nebo nevraživost roste podle
 * společně stráveného času, povah a společného jídla. Vztahy ovlivňují náladu.
 */
const Social = {
  FRIEND: 40, RIVAL: -40,

  /** Vrozená „chemie“ dvojice + vliv povah. Kladná = rozumí si. */
  compat(a, b) {
    const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
    let v = (U.hash2(lo, hi, Game.seed + 77) - 0.42) * 1.6;
    const ta = a.trait.id, tb = b.trait.id;
    const clash = (x, y) => (ta === x && tb === y) || (ta === y && tb === x);
    if (ta === tb) v += 0.4;
    if (clash('optimist', 'pessimist')) v -= 0.9;
    if (clash('hardwork', 'lazy')) v -= 1.1;
    if (ta === 'optimist' || tb === 'optimist') v += 0.25;
    return v;
  },
  get(a, b) { return a.rel[b.id] || 0; },
  add(a, b, d) {
    a.rel[b.id] = U.clamp((a.rel[b.id] || 0) + d, -100, 100);
    b.rel[a.id] = U.clamp((b.rel[a.id] || 0) + d, -100, 100);
  },
  label(v) { return v >= 70 ? 'blízký přítel' : v >= this.FRIEND ? 'přítel' : v >= 12 ? 'dobrý známý' : v > -12 ? 'známý' : v > this.RIVAL ? 'nemají se rádi' : 'nevraživost'; },

  /** Jednou za herní hodinu: kdo je s kým pohromadě. */
  hourly() {
    const cs = Game.colonists;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 4 || a.sleeping || b.sleeping) continue;
      let delta = this.compat(a, b) * 0.7;
      // společné jídlo sbližuje
      const eating = a.job && b.job && a.job.type === 'eat' && b.job.type === 'eat';
      if (eating) delta += 2;
      this.add(a, b, delta);
      const v = this.get(a, b);
      if (v >= this.FRIEND && U.chance(0.25)) {
        a.addThought('chat' + b.id, 'Popovídal/a si: ' + b.first, 4, 8);
        b.addThought('chat' + a.id, 'Popovídal/a si: ' + a.first, 4, 8);
      } else if (v <= -20 && U.chance(0.2)) {
        a.addThought('spat' + b.id, 'Hádka: ' + b.first, -5, 8);
        b.addThought('spat' + a.id, 'Hádka: ' + a.first, -5, 8);
        this.add(a, b, -2);
      }
    }
  },
  /** Vliv vztahů na náladu (jen žijící kolonisté). */
  mood(c) {
    let friends = 0, rivals = 0;
    for (const o of Game.colonists) {
      if (o === c) continue;
      const v = c.rel[o.id] || 0;
      if (v >= this.FRIEND) friends++; else if (v <= this.RIVAL) rivals++;
    }
    const out = [];
    if (friends) out.push({ label: friends === 1 ? 'Má přítele' : `Má přátele (${friends})`, val: Math.min(3, friends) * 3 });
    if (rivals) out.push({ label: rivals === 1 ? 'Nevraživost v kolonii' : `Nevraživosti (${rivals})`, val: -Math.min(3, rivals) * 3 });
    return out;
  },
  /** Smrt přítele. */
  onDeath(dead) {
    for (const o of Game.colonists) {
      if ((o.rel[dead.id] || 0) >= this.FRIEND) o.addThought('grief' + dead.id, 'Zemřel/a přítel: ' + dead.first, -10, 48);
      delete o.rel[dead.id];
    }
  },
};
