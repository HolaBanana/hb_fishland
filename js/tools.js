'use strict';
/**
 * Tools – nástroje hráče (označování, stavění, zóny) a jejich aplikace na výběr políček.
 */
const Tools = (() => {
  const notBlockedTerrain = (i) => {
    const t = World.terrain[i];
    return t !== T.WATER && t !== T.SHALLOW;
  };

  const defs = {
    select: { name: 'Výběr', mode: 'none', hint: 'Klepni na kolonistu nebo políčko. Tažením posouváš mapu, dvěma prsty přibližuješ.' },
    chop: {
      name: 'Kácet', mode: 'rect', hint: 'Táhni prstem přes les – stromy se označí ke kácení.',
      valid: i => { const o = World.obj[i]; return !!o && o.type === 'tree' && o.des !== 'chop'; },
      apply: i => World.designate(i, 'chop'),
    },
    mine: {
      name: 'Těžit', mode: 'rect', hint: 'Táhni přes skály a železnou rudu – označí se k těžbě.',
      valid: i => { const o = World.obj[i]; return !!o && (o.type === 'rock' || o.type === 'ore') && o.des !== 'mine'; },
      apply: i => World.designate(i, 'mine'),
    },
    harvest: {
      name: 'Sbírat', mode: 'rect', hint: 'Táhni přes keře s bobulemi – kolonisté je budou sklízet.',
      valid: i => { const o = World.obj[i]; return !!o && o.type === 'bush' && o.des !== 'harvest'; },
      apply: i => World.designate(i, 'harvest'),
    },
    decon: {
      name: 'Zbourat', mode: 'rect', hint: 'Táhni přes stavby nebo podlahy, které chceš zbourat (vrátí se část materiálu).',
      valid: i => (World.struct[i] && !World.struct[i].decon) || (!World.struct[i] && World.floor[i] && !World.floor[i].decon),
      apply: i => {
        if (World.struct[i]) World.struct[i].decon = true; else World.floor[i].decon = true;
        World.deconSet.add(i);
      },
    },
    cancel: {
      name: 'Zrušit', mode: 'rect', hint: 'Táhni pro zrušení označení, plánů staveb a bourání.',
      valid: i => !!(World.bp[i] || (World.obj[i] && World.obj[i].des) || World.deconSet.has(i)),
      apply: i => {
        if (World.bp[i]) World.cancelBlueprint(i);
        if (World.obj[i] && World.obj[i].des) World.designate(i, null);
        if (World.deconSet.has(i)) {
          if (World.struct[i]) World.struct[i].decon = false;
          if (World.floor[i]) World.floor[i].decon = false;
          World.deconSet.delete(i);
        }
      },
    },
    zone_stock: {
      name: 'Sklad', mode: 'rect', hint: 'Táhni pro vytvoření skladu. Kolonisté sem nosí suroviny.',
      valid: i => World.zone[i] !== 1 && notBlockedTerrain(i) && !(World.obj[i] && OBJECTS[World.obj[i].type].blocks),
      apply: i => { World.zone[i] = 1; },
      after: () => World.rebuildZones(),
    },
    zone_farm: {
      name: 'Pole', mode: 'rect', hint: 'Táhni přes trávu nebo úrodnou půdu – vznikne pole s bramborami. Stromy na něm se pokácí.',
      valid: i => World.zone[i] !== 2 && TERRAIN[World.terrain[i]].fert > 0 && !World.struct[i] && !World.floor[i] &&
        !(World.obj[i] && (World.obj[i].type === 'rock' || World.obj[i].type === 'ore')),
      apply: i => {
        World.zone[i] = 2;
        const o = World.obj[i];
        if (o && o.type === 'tree') World.designate(i, 'chop');
      },
      after: () => World.rebuildZones(),
    },
    zone_clear: {
      name: 'Smazat zónu', mode: 'rect', hint: 'Táhni pro odstranění skladu nebo pole.',
      valid: i => World.zone[i] !== 0,
      apply: i => { World.zone[i] = 0; },
      after: () => World.rebuildZones(),
    },
  };

  // stavební nástroje z definic BUILD
  for (const k in BUILD) {
    const b = BUILD[k];
    defs[k] = {
      name: b.name, mode: b.mode, hint: b.hint, build: k,
      valid: i => {
        if (!notBlockedTerrain(i) || World.bp[i] || World.crops[i]) return false;
        const o = World.obj[i];
        if (o) return false;
        if (b.layer === 'floor') return !World.floor[i];
        return !World.struct[i];
      },
      apply: i => World.placeBlueprint(i, k),
    };
  }

  /** Seznam políček pro tah od (x0,y0) do (x1,y1) podle režimu nástroje. */
  function tilesFor(tool, x0, y0, x1, y1) {
    const d = defs[tool];
    if (!d || d.mode === 'none') return [];
    const out = [];
    const clampX = v => U.clamp(v, 0, World.w - 1), clampY = v => U.clamp(v, 0, World.h - 1);
    if (d.mode === 'single') {
      if (World.inb(x1, y1)) out.push(World.idx(x1, y1));
      return out;
    }
    let ax = clampX(Math.min(x0, x1)), bx = clampX(Math.max(x0, x1));
    let ay = clampY(Math.min(y0, y1)), by = clampY(Math.max(y0, y1));
    if (d.mode === 'perimeter') {
      if (bx - ax >= 1 && by - ay >= 1) {
        for (let x = ax; x <= bx; x++) { out.push(World.idx(x, ay)); out.push(World.idx(x, by)); }
        for (let y = ay + 1; y < by; y++) { out.push(World.idx(ax, y)); out.push(World.idx(bx, y)); }
        return out;
      }
    }
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) out.push(World.idx(x, y));
    return out;
  }

  function apply(tool, tiles) {
    const d = defs[tool];
    if (!d || !d.apply) return 0;
    let n = 0;
    for (const i of tiles) if (d.valid(i)) { d.apply(i); n++; }
    if (d.after) d.after();
    if (n > 0) {
      if (d.build) {
        const cost = BUILD[d.build].cost, have = World.countItems();
        const lack = [];
        for (const m in cost) if (have[m] < cost[m] * n) lack.push(ITEMS[m].name.toLowerCase());
        UI.toast(`Naplánováno: ${d.name} ×${n}` + (lack.length ? ` – chybí ${lack.join(', ')}!` : ''), lack.length ? 'warn' : 'info');
      }
    }
    return n;
  }

  function costText(tool, n = 1) {
    const d = defs[tool];
    if (!d || !d.build) return '';
    const cost = BUILD[d.build].cost;
    return Object.keys(cost).map(m => `${cost[m] * n} ${ITEMS[m].name.toLowerCase()}`).join(', ');
  }

  return { defs, tilesFor, apply, costText };
})();
