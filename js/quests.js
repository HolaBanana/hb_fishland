'use strict';
/**
 * Quests – tutoriál jako postupné úkoly s odměnou. Jde kdykoli přeskočit.
 */
const Quests = {
  LIST: [
    { text: 'Označ stromy ke kácení', how: 'Příkazy → Kácet a táhni přes les.', done: () => World.des.chop.size >= 3 || Game.stats.chopped >= 3, reward: { wood: 20 } },
    { text: 'Postav postel', how: 'Stavba → Postel a klepni na volné místo.', done: () => (World.structBy.bed || { size: 0 }).size >= 1, reward: { meal: 6 } },
    { text: 'Postav ohniště', how: 'Stavba → Ohniště. Vaří se na něm teplé jídlo.', done: () => (World.structBy.campfire || { size: 0 }).size >= 1, reward: { food: 15 } },
    { text: 'Založ pole', how: 'Zóny → Pole a táhni přes trávu nebo úrodnou půdu (aspoň 6 políček).', done: () => World.farmTiles.length >= 6, reward: { food: 15 } },
    { text: 'Postav místnost se střechou', how: 'Stavba → zdi do obdélníku a do mezery dveře. Uzavřený prostor má střechu.', done: () => World.rooms.length >= 1, reward: { wood: 30 } },
    { text: 'Postav pilu', how: 'Výroba → Pila. Kolonisté na ní řežou prkna.', done: () => (World.structBy.saw || { size: 0 }).size >= 1, reward: { stone: 20 } },
    { text: 'Postav pec', how: 'Výroba → Pec. Označ k těžbě ložisko rudy (oranžové žilky ve skále).', done: () => (World.structBy.furnace || { size: 0 }).size >= 1, reward: { ore: 20 } },
    { text: 'Postav výzkumný stůl', how: 'Výroba → Výzkumný stůl, pak Výroba → Výzkum a vyber technologii.', done: () => (World.structBy.research || { size: 0 }).size >= 1, reward: { plank: 10 } },
    { text: 'Dokonči první výzkum', how: 'Kolonista s prací Výzkum bádá u stolu. Doporučení: Vodní energie a Mechanika.', done: () => Research.done.size >= 1, reward: { iron: 8 } },
    { text: 'Vyrob první energii', how: 'Vodní kolo patří na mělkou vodu (světle modrá). Stroje musí být do 5 políček od zdroje nebo sloupu.', done: () => Power.supply > 0, reward: { plank: 20 } },
    { text: 'Postav první vrták', how: 'Vyzkoumej Těžební stroje a postav Vrták přímo na ložisko rudy. Šipka určuje, kam bude rudu klást.', done: () => (World.structBy.drill || { size: 0 }).size >= 1, reward: { iron: 15 } },
    { text: 'Vyzkoumej Soběstačnou kolonii', how: 'Pokračuj ve výzkumu (Výroba → Výzkum). Otevře cestu k elektřině.', done: () => Research.done.has('colony'), reward: { iron: 20, plank: 20 } },
    { text: 'Postav vysílačku a zavolej záchranu', how: 'Vyzkoumej Rádiové spojení, postav Vysílačku (2×2) a dej jí 40 ⚡ po dobu 48 hodin. To je cíl hry.', done: () => !!Game.rescued, reward: { meal: 20 } },
  ],
  idx: 0,
  skipped: false,

  reset() { this.idx = 0; this.skipped = false; },
  get active() { return !this.skipped && this.idx < this.LIST.length ? this.LIST[this.idx] : null; },
  skip() { this.skipped = true; UI.updateQuest(); },
  /** Zkontroluje aktuální úkol; při splnění vyplatí odměnu. */
  check() {
    const q = this.active;
    if (!q || !q.done()) return;
    const s = World.start, parts = [];
    for (const k in q.reward) { World.dropItem(s.x, s.y + 1, k, q.reward[k]); parts.push(`${q.reward[k]}× ${ITEMS[k].name.toLowerCase()}`); }
    this.idx++;
    UI.toast(`Úkol splněn: ${q.text}. Odměna: ${parts.join(', ')}.`, 'good');
    if (this.idx >= this.LIST.length) UI.toast('Tutoriál dokončen – kolonie je na cestě k soběstačnosti!', 'good');
    UI.updateQuest();
  },
  pack() { return { idx: this.idx, skipped: this.skipped }; },
  unpack(d) { this.reset(); if (d) { this.idx = d.idx || 0; this.skipped = !!d.skipped; } else this.skipped = true; },
};
