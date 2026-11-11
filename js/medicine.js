'use strict';
/**
 * Medicine – nemoci, zranění a léčení.
 *  - Nemoc má závažnost (sev) a imunitu (imm); když imunita doroste dřív, kolonista
 *    se uzdraví, jinak nemoc ubírá zdraví. Odpočinek v posteli a ošetření (léky,
 *    byliny) zrychlují imunitu.
 *  - Zranění z boje krvácí, dokud je lékař neošetří; neošetřená rána se může zanítit.
 */
const DISEASES = {
  flu:       { name: 'Chřipka',      sev: 1 / 34, imm: 1 / 30, contagious: true },
  infection: { name: 'Zánět rány',   sev: 1 / 26, imm: 1 / 30 },
  poison:    { name: 'Otrava jídlem', sev: 1 / 14, imm: 1 / 10 },
};

const Medicine = {
  next: 0,

  reset() { this.next = TimeSys.minutes + 60 * 24 * U.range(5, 8); },
  infect(c, id) {
    if (c.disease || c.dead) return false;
    c.disease = { id, sev: 0.05, imm: 0 };
    Game.alert(`${c.first} onemocněl/a: ${DISEASES[id].name.toLowerCase()}. Lékař ho/ji ošetří, odpočinek v posteli pomáhá.`, 'warn', c.tx, c.ty);
    return true;
  },
  /** Rána z boje. */
  wound(c) {
    if (!c.bleed) Game.notifyOnce('bleed' + c.id, `${c.first} je zraněn/a a krvácí – potřebuje lékaře.`, 'warn', 60);
    c.bleed = true;
    c.bleedT = 0;
  },
  isTended(c) { return (c.tendedUntil || 0) > TimeSys.minutes; },
  needsCare(c) { return !c.dead && (c.bleed || (c.disease && !this.isTended(c))); },

  /** Jednou za herní hodinu pro každého kolonistu. Vrací ztrátu zdraví. */
  hourly(c) {
    let dmg = 0;
    if (c.bleed) {
      dmg += 1.5;
      c.bleedT = (c.bleedT || 0) + 1;
      if (c.bleedT > 10 && U.chance(0.08)) this.infect(c, 'infection');
    }
    const d = c.disease;
    if (d) {
      const def = DISEASES[d.id];
      const care = this.isTended(c) ? c.careQ || 1.3 : 1;
      const rest = c.sleeping ? 1.35 : 1;
      d.imm += def.imm * care * rest * (0.85 + U.rand() * 0.3);
      d.sev += def.sev * (0.85 + U.rand() * 0.3);
      if (d.imm >= 1) {
        c.disease = null;
        c.addThought('cured', 'Uzdravil/a se', 4, 12);
        UI.toast(`${c.first} se uzdravil/a.`, 'good');
      } else if (d.sev >= 1) dmg += 6;
      else if (d.sev > 0.6) dmg += 1;
      // nakažlivá nemoc se může přenést na blízké
      if (c.disease && def.contagious && d.sev > 0.2) {
        for (const o of Game.colonists) if (o !== c && !o.disease && Math.hypot(o.x - c.x, o.y - c.y) < 3 && U.chance(0.04)) this.infect(o, d.id);
      }
    }
    return dmg;
  },
  /** Náhodné epidemie. */
  events() {
    if (TimeSys.minutes < this.next) return;
    this.next = TimeSys.minutes + 60 * 24 * U.range(6, 10);
    const cs = Game.colonists.filter(c => !c.disease);
    if (!cs.length) return;
    // chřipka chodí častěji v chladu
    if (TimeSys.temp() < 10 || U.chance(0.5)) this.infect(U.pick(cs), 'flu');
  },
  /** Syrové nebo zkažené jídlo může přivodit otravu. */
  ate(c, type, fresh) {
    const risk = (type === 'meat' ? 0.06 : type === 'food' || type === 'egg' ? 0.015 : 0.003) + (fresh < 0.25 ? 0.05 : 0);
    if (U.chance(risk)) this.infect(c, 'poison');
  },
  /** Ošetření: q = 2 s léky, 1.6 s bylinami, 1.25 bez nich. */
  tend(doc, c, q) {
    c.tendedUntil = TimeSys.minutes + 60 * 14;
    c.careQ = q * (1 + doc.skills.medicine.lvl * 0.03);
    if (c.bleed) { c.bleed = false; c.health = Math.min(100, c.health + 10); }
    c.addThought('tended', 'Ošetřen/a lékařem', 3, 12);
    Game.stats.tended = (Game.stats.tended || 0) + 1;
  },
  status(c) {
    const out = [];
    if (c.bleed) out.push('krvácí');
    if (c.disease) out.push(`${DISEASES[c.disease.id].name.toLowerCase()} (závažnost ${Math.round(c.disease.sev * 100)} %, imunita ${Math.round(c.disease.imm * 100)} %)`);
    if (this.isTended(c)) out.push('ošetřen/a');
    return out.join(', ');
  },
  pack() { return { next: this.next }; },
  unpack(d) { if (d) this.next = d.next; else this.reset(); },
};
