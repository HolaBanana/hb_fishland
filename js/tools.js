'use strict';
/**
 * Tools – nástroje hráče (označování, stavění, zóny) a jejich aplikace na výběr políček.
 */
const Tools = (() => {
  const notBlockedTerrain = (i) => {
    const t = World.terrain[i];
    return t !== T.WATER && t !== T.SHALLOW;
  };

  // Každé `apply(i)` vrací funkci, která změnu na políčku vrátí zpět (tlačítko Zpět).
  const desTool = (des) => (i) => {
    const prev = World.obj[i].des;
    World.designate(i, des);
    return () => { const o = World.obj[i]; if (o && o.des === des) World.designate(i, prev); };
  };
  const setDecon = (i, on) => {
    const s = World.struct[i];
    if (s) { s.decon = on; i = s.i; } else if (World.floor[i]) World.floor[i].decon = on;
    if (on) World.deconSet.add(i); else World.deconSet.delete(i);
  };
  const isDecon = (i) => !!((World.struct[i] && World.struct[i].decon) || (!World.struct[i] && World.floor[i] && World.floor[i].decon));
  const zoneTool = (z) => (i) => {
    const prev = World.zone[i];
    World.zone[i] = z;
    let chopped = false;
    const o = World.obj[i];
    if (z === 2 && o && o.type === 'tree' && !o.des) { World.designate(i, 'chop'); chopped = true; }
    return () => {
      World.zone[i] = prev;
      const q = World.obj[i];
      if (chopped && q && q.des === 'chop') World.designate(i, null);
    };
  };

  const defs = {
    select: { name: 'Výběr', mode: 'none', hint: 'Klepni na kolonistu nebo políčko. Tažením posouváš mapu, dvěma prsty přibližuješ.' },
    chop: {
      name: 'Kácet', mode: 'rect', hint: 'Táhni prstem přes les – stromy se označí ke kácení.',
      valid: i => { const o = World.obj[i]; return !!o && o.type === 'tree' && o.des !== 'chop'; },
      apply: desTool('chop'),
    },
    mine: {
      name: 'Těžit', mode: 'rect', hint: 'Táhni přes skály a železnou rudu – označí se k těžbě.',
      valid: i => { const o = World.obj[i]; return !!o && (o.type === 'rock' || o.type === 'ore') && o.des !== 'mine'; },
      apply: desTool('mine'),
    },
    harvest: {
      name: 'Sbírat', mode: 'rect', hint: 'Táhni přes keře s bobulemi – kolonisté je budou sklízet.',
      valid: i => { const o = World.obj[i]; return !!o && o.type === 'bush' && o.des !== 'harvest'; },
      apply: desTool('harvest'),
    },
    decon: {
      name: 'Zbourat', mode: 'rect', hint: 'Táhni přes stavby nebo podlahy, které chceš zbourat (vrátí se část materiálu).',
      valid: i => !!((World.struct[i] && !World.struct[i].decon) || (!World.struct[i] && World.floor[i] && !World.floor[i].decon)),
      apply: i => { setDecon(i, true); return () => { if (isDecon(i)) setDecon(i, false); }; },
    },
    cancel: {
      name: 'Zrušit', mode: 'rect', hint: 'Táhni pro zrušení označení, plánů staveb a bourání.',
      valid: i => !!(World.bp[i] || (World.obj[i] && World.obj[i].des) || isDecon(i)),
      apply: i => {
        const bp = World.bp[i];
        const bpType = bp ? bp.type : null, bpAt = bp ? bp.i : i, bpDir = bp ? bp.dir : 0;
        const des = World.obj[i] ? World.obj[i].des : null;
        const decon = isDecon(i);
        if (bpType) World.cancelBlueprint(i);
        if (des) World.designate(i, null);
        if (decon) setDecon(i, false);
        return () => {
          if (bpType && defs[bpType].valid(bpAt, bpDir)) World.placeBlueprint(bpAt, bpType, bpDir);
          if (des && World.obj[i] && !World.obj[i].des) World.designate(i, des);
          if (decon && (World.struct[i] || World.floor[i])) setDecon(i, true);
        };
      },
    },
    zone_stock: {
      name: 'Sklad', mode: 'rect', hint: 'Táhni pro vytvoření skladu. Kolonisté sem nosí suroviny.',
      valid: i => World.zone[i] !== 1 && notBlockedTerrain(i) && !(World.obj[i] && OBJECTS[World.obj[i].type].blocks),
      apply: zoneTool(1),
      after: () => World.rebuildZones(),
    },
    zone_farm: {
      name: 'Pole', mode: 'rect', hint: 'Táhni přes trávu nebo úrodnou půdu – vznikne pole s bramborami. Stromy na něm se pokácí.',
      valid: i => World.zone[i] !== 2 && TERRAIN[World.terrain[i]].fert > 0 && !World.struct[i] && !World.floor[i] &&
        !(World.obj[i] && (World.obj[i].type === 'rock' || World.obj[i].type === 'ore')),
      apply: zoneTool(2),
      after: () => World.rebuildZones(),
    },
    zone_pasture: {
      name: 'Pastvina', mode: 'rect', hint: 'Táhni kolem kurníku nebo ovčína. Zvířata se drží na pastvině; počítej 3 políčka na kus.',
      valid: i => World.zone[i] !== 3 && notBlockedTerrain(i) && !World.struct[i] && !(World.obj[i] && OBJECTS[World.obj[i].type].blocks),
      apply: zoneTool(3),
      after: () => World.rebuildZones(),
    },
    hunt: {
      name: 'Lovit', mode: 'rect', hint: 'Táhni přes zvěř (nebo vlastní zvířata k porážce). Jednotlivý kus označíš i klepnutím na něj nástrojem Výběr.',
      valid: i => Animals.at(i % World.w, (i / World.w) | 0).some(a => !a.hunt),
      apply: i => {
        const marked = Animals.at(i % World.w, (i / World.w) | 0).filter(a => !a.hunt);
        for (const a of marked) a.hunt = true;
        return () => { for (const a of marked) a.hunt = false; };
      },
    },
    zone_clear: {
      name: 'Smazat zónu', mode: 'rect', hint: 'Táhni pro odstranění skladu, pole nebo pastviny.',
      valid: i => World.zone[i] !== 0,
      apply: zoneTool(0),
      after: () => World.rebuildZones(),
    },
  };

  // stavební nástroje z definic BUILD
  for (const k in BUILD) {
    const b = BUILD[k];
    const turns = !!(b.rot || b.size);
    const isBeltTool = !!(b.machine && b.machine.belt);
    const tileOk = (t) => {
      if (World.bp[t] || World.crops[t]) return false;
      if (b.onWater ? World.terrain[t] !== T.SHALLOW : !notBlockedTerrain(t)) return false;
      const o = World.obj[t];
      if (b.onOre ? !(o && o.type === 'ore') : !!o) return false;
      return b.layer === 'floor' ? !World.floor[t] : !World.struct[t];
    };
    defs[k] = {
      name: b.name, mode: b.mode, hint: b.hint, build: k, rot: !!b.rot, tech: b.tech,
      valid: (i, dir = Game.buildDir) => {
        if (!Research.unlocked(k)) return false;
        // přetažením přes hotový pás se jen změní jeho směr
        if (isBeltTool && World.isBelt(i)) return World.struct[i].dir !== dir && !World.struct[i].decon;
        const tiles = World.footprint(i, k, turns ? dir : 0);
        if (!tiles) return false;
        for (const t of tiles) if (!tileOk(t)) return false;
        return true;
      },
      apply: (i, dir = Game.buildDir) => {
        if (isBeltTool && World.isBelt(i)) {
          const s = World.struct[i], prev = s.dir;
          s.dir = dir;
          return () => { if (World.struct[i] === s) s.dir = prev; };
        }
        World.placeBlueprint(i, k, turns ? dir : 0);
        return () => { if (World.bp[i] && World.bp[i].type === k) World.cancelBlueprint(i); };
      },
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
    if (d.mode === 'line') {
      // rovná čára po delší ose tahu, v pořadí tahu (pásy)
      const horiz = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
      const len = horiz ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
      const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
      for (let k = 0; k <= len; k++) {
        const x = horiz ? x0 + sx * k : x0, y = horiz ? y0 : y0 + sy * k;
        if (World.inb(x, y)) out.push(World.idx(x, y));
      }
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

  const undoStack = [];
  const UNDO_MAX = 30;

  /** Směr stavby pro daný tah: čára (pás) míří ve směru tahu, jinak platí zvolené otočení. */
  function dirFor(tool, x0, y0, x1, y1) {
    const d = defs[tool];
    if (d && d.mode === 'line' && (x0 !== x1 || y0 !== y1)) {
      if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) return x1 > x0 ? 0 : 2;
      return y1 > y0 ? 1 : 3;
    }
    return Game.buildDir;
  }
  function countValid(tool, tiles, dir) {
    const d = defs[tool];
    let n = 0;
    if (d && d.valid) for (const i of tiles) if (d.valid(i, dir)) n++;
    return n;
  }
  /** Které suroviny chybí na `n` kusů stavby (názvy malými písmeny). */
  function lacking(tool, n) {
    const d = defs[tool], lack = [];
    if (!d || !d.build) return lack;
    const cost = BUILD[d.build].cost, have = World.counts;
    for (const m in cost) if (have[m] < cost[m] * n) lack.push(ITEMS[m].name.toLowerCase());
    return lack;
  }

  function apply(tool, tiles, dir = Game.buildDir) {
    const d = defs[tool];
    if (!d || !d.apply) return 0;
    if (d.tech && !Research.has(d.tech)) { UI.toast(`${d.name}: nejdřív vyzkoumej „${TECHS[d.tech].name}“.`, 'warn'); return 0; }
    const undos = [];
    for (const i of tiles) if (d.valid(i, dir)) undos.push(d.apply(i, dir));
    const n = undos.length;
    if (d.after) d.after();
    if (n > 0) {
      undoStack.push({ name: d.name, n, undos, after: d.after });
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      if (d.build) {
        const lack = lacking(tool, n);
        UI.toast(`Naplánováno: ${d.name} ×${n}` + (lack.length ? ` – chybí ${lack.join(', ')}!` : ''), lack.length ? 'warn' : 'info');
      }
      UI.updateUndo();
    }
    return n;
  }

  /** Vrátí poslední akci hráče (označení, plán stavby, zónu…). */
  function undo() {
    const a = undoStack.pop();
    if (!a) return false;
    for (let k = a.undos.length - 1; k >= 0; k--) a.undos[k]();
    if (a.after) a.after();
    UI.toast(`Vráceno zpět: ${a.name} ×${a.n}`, 'info');
    UI.updateUndo();
    return true;
  }

  function costText(tool, n = 1) {
    const d = defs[tool];
    if (!d || !d.build) return '';
    const cost = BUILD[d.build].cost;
    return Object.keys(cost).map(m => `${cost[m] * n} ${ITEMS[m].name.toLowerCase()}`).join(', ');
  }

  return { defs, tilesFor, apply, costText, countValid, lacking, undo, undoStack, dirFor };
})();
