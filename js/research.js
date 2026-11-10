'use strict';
/**
 * Research – strom technologií. Body sbírají kolonisté u výzkumného stolu;
 * technologie odemykají stroje. Dokončení celého stromu je cílem hry.
 */
const Research = {
  done: new Set(),
  points: {},          // rozpracované body podle technologie
  current: null,
  won: false,

  reset() { this.done = new Set(); this.points = {}; this.current = null; this.won = false; },
  has(id) { return !id || this.done.has(id); },
  available(id) { return !this.done.has(id) && TECHS[id].req.every(r => this.done.has(r)); },
  /** Je stavba odemčená? */
  unlocked(build) { return this.has(BUILD[build].tech); },
  progress(id) { return this.done.has(id) ? 1 : (this.points[id] || 0) / TECHS[id].cost; },
  setCurrent(id) { if (this.available(id)) this.current = id; },
  /** Je co zkoumat? (pro hledání práce) */
  active() {
    if (this.current && !this.available(this.current)) this.current = null;
    if (!this.current) {
      // automaticky pokračovat další dostupnou technologií
      for (const id in TECHS) if (this.available(id)) { this.current = id; break; }
    }
    return !!this.current;
  },
  add(p) {
    const id = this.current;
    if (!id) return;
    this.points[id] = (this.points[id] || 0) + p;
    if (this.points[id] >= TECHS[id].cost) this.complete(id);
  },
  complete(id) {
    this.done.add(id);
    delete this.points[id];
    this.current = null;
    const unlocked = Object.keys(BUILD).filter(k => BUILD[k].tech === id).map(k => BUILD[k].name);
    Game.alert(`Výzkum dokončen: ${TECHS[id].name}` + (unlocked.length ? ` – nové stavby: ${unlocked.join(', ')}.` : '.'), 'good');
    if (UI.ready) UI.setTab(UI.tab);
    if (!this.won && Object.keys(TECHS).every(t => this.done.has(t))) {
      this.won = true;
      UI.victory();
    }
  },
  pack() { return { done: [...this.done], points: this.points, current: this.current, won: this.won }; },
  unpack(d) {
    this.reset();
    if (!d) return;
    this.done = new Set(d.done || []);
    this.points = d.points || {};
    this.current = d.current || null;
    this.won = !!d.won;
  },
};
