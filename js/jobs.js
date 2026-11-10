'use strict';
/**
 * Jobs – hledání práce podle priorit a "drivery" jednotlivých úkolů.
 * Driver vrací: undefined = pokračuje, Jobs.DONE = hotovo, Jobs.FAIL = selhalo.
 */
const Jobs = (() => {
  const DONE = 1, FAIL = 2;

  const ix = i => i % World.w;
  const iy = i => (i / World.w) | 0;

  /** Chůze k cíli; cesta se spočítá jen jednou pro danou fázi úkolu. */
  function walk(c, j, x, y, mode, failKey) {
    const key = j.stage + ':' + x + ',' + y + ',' + mode;
    if (j.walkKey !== key) {
      j.walkKey = key;
      if (!c.pathTo(x, y, mode)) {
        c.unreach.set(failKey || j.key || ('t' + World.idx(x, y)), TimeSys.minutes + 90);
        return 'fail';
      }
    }
    return c.followPath();
  }

  function nearestItem(types, c, minAvail = 1) {
    let best = -1, bd = Infinity;
    for (const i of World.itemSet) {
      const it = World.items[i];
      if (!it || !types.includes(it.type)) continue;
      if (Game.availItem(i) < minAvail || World.isBelt(i)) continue;
      if ((c.unreach.get('i' + i) || 0) > TimeSys.minutes) continue;
      const d = Math.abs(ix(i) - c.tx) + Math.abs(iy(i) - c.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /** Je někde volný (nerezervovaný) kus dané suroviny? O(1) díky průběžným počtům. */
  function anyItem(type) { return World.counts[type] - Game.resType[type] > 0; }
  function hasFood() { return anyItem('meal') || anyItem('food') || anyItem('egg'); }
  function anyCookable() { return COOKABLE.some(anyItem); }

  function findStockDest(type, c) {
    let best = -1, bs = Infinity;
    for (const i of World.stockTiles) {
      if (!World.canStore(i) || !World.allowed(i, type) || Game.isReserved('d' + i, c)) continue;
      const it = World.items[i];
      if (it && (it.type !== type || it.n >= World.stackCap(i))) continue;
      let s = Math.abs(ix(i) - c.tx) + Math.abs(iy(i) - c.ty);
      if (it) s -= 6; // přednostně doplnit existující hromádku
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  }
  // místo ve skladu podle typu – přepočítá se jen po změně předmětů nebo zón
  let spaceVer = -1, spaceCache = {};
  function hasStockSpace(type) {
    if (spaceVer !== World.itemVer) { spaceVer = World.itemVer; spaceCache = {}; }
    if (spaceCache[type] !== undefined) return spaceCache[type];
    let ok = false;
    for (const i of World.stockTiles) {
      if (!World.canStore(i) || !World.allowed(i, type)) continue;
      const it = World.items[i];
      if (!it || (it.type === type && it.n < World.stackCap(i))) { ok = true; break; }
    }
    return (spaceCache[type] = ok);
  }

  function findFood(c) {
    if (!hasFood()) return -1;
    let i = anyItem('meal') ? nearestItem(['meal'], c) : -1;
    if (i < 0) i = nearestItem(['food', 'egg'], c);
    return i;
  }
  function findBed(c) {
    const beds = World.structsOfType('bed');
    // vlastní postel
    for (const i of beds) if (World.struct[i].owner === c.id && !Game.isReserved('b' + i, c)) return i;
    let best = -1, bd = Infinity;
    for (const i of beds) {
      const s = World.struct[i];
      if (s.decon || Game.isReserved('b' + i, c)) continue;
      if (s.owner >= 0 && s.owner !== c.id && Game.colonistById(s.owner)) continue;
      if ((c.unreach.get('b' + i) || 0) > TimeSys.minutes) continue;
      const d = Math.abs(ix(i) - c.tx) + Math.abs(iy(i) - c.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Nejbližší požár v okolí kolonie, který ještě nikdo nehasí. */
  function findFire(c) {
    let best = -1, bd = Infinity;
    const s = World.start, now = TimeSys.minutes;
    for (const i of Fire.tiles.keys()) {
      const x = ix(i), y = iy(i);
      if (Math.abs(x - s.x) > 45 || Math.abs(y - s.y) > 45) continue;
      if (Game.isReserved('f' + i, c) || (c.unreach.get('f' + i) || 0) > now) continue;
      const d = Math.abs(x - c.tx) + Math.abs(y - c.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /** Volná židle u stolu poblíž. */
  function findSeat(c) {
    const chairs = World.structBy.chair, w = World.w;
    if (!chairs) return -1;
    let best = -1, bd = 30;
    for (const i of chairs) {
      if (World.struct[i].decon || Game.isReserved('s' + i, c)) continue;
      const x = i % w;
      let table = false;
      for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (q >= 0 && q < World.n && World.struct[q] && World.struct[q].type === 'table') { table = true; break; }
      }
      if (!table) continue;
      const d = Math.abs(x - c.tx) + Math.abs(iy(i) - c.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---------- Generátory kandidátů podle pracovních typů ----------
  // Vycházejí z průběžně udržovaných seznamů ve World (žádné procházení celé mapy).
  const candidates = {
    cook() {
      if (World.counts.meal >= Game.colonists.length * 4 || !anyCookable()) return [];
      const out = [];
      const fires = World.structBy.campfire;
      if (fires) for (const i of fires) if (!World.struct[i].decon) out.push({ type: 'cook', i, key: 'o' + i });
      return out;
    },
    build() {
      const out = [];
      for (const i of World.bpSet) {
        const m = World.bpMissing(i);
        if (m && !anyItem(m)) continue;
        out.push({ type: 'build', i, key: 'o' + i });
      }
      for (const i of World.deconSet) out.push({ type: 'decon', i, key: 'o' + i });
      return out;
    },
    grow() {
      const out = [];
      for (const i of World.ripeSet) out.push({ type: 'harvest', i, key: 'o' + i });
      if (TimeSys.daylight() > 0.2) {
        for (const i of World.emptyFarm) if (World.canSow(i)) out.push({ type: 'sow', i, key: 'o' + i });
      }
      for (const i of World.des.harvest) {
        const o = World.obj[i];
        if (o && o.berries) out.push({ type: 'pick', i, key: 'o' + i });
      }
      // stříhání ovcí
      for (const a of Animals.list) {
        if (a.type === 'sheep' && a.prod >= 1 && !a.hunt) out.push({ type: 'shear', a: a.id, i: World.idx(a.tx, a.ty), key: 'a' + a.id });
      }
      return out;
    },
    hunt() {
      const out = [];
      for (const a of Animals.list) if (a.hunt && !a.gone) out.push({ type: 'hunt', a: a.id, i: World.idx(a.tx, a.ty), key: 'a' + a.id });
      return out;
    },
    craft() {
      const out = [];
      for (const i of World.machines) {
        const s = World.struct[i], m = BUILD[s.type].machine;
        if (!m.manual || !m.recipe || s.decon) continue;
        const rs = Machines.recipes(m);
        for (let ri = 0; ri < rs.length; ri++) {
          const r = rs[ri];
          const outType = Object.keys(r.out)[0];
          if (World.counts[outType] >= (r.target !== undefined ? r.target : s.target)) continue;
          let ok = true;
          for (const k in r.in) if ((s.inv[k] || 0) < r.in[k] && !anyItem(k)) { ok = false; break; }
          if (ok) { out.push({ type: 'craft', i, ri, key: 'o' + i }); break; }
        }
      }
      return out;
    },
    research() {
      const out = [];
      const tables = World.structBy.research;
      if (!tables || !tables.size || !Research.active()) return out;
      for (const i of tables) if (!World.struct[i].decon) out.push({ type: 'research', i, key: 'o' + i });
      return out;
    },
    chop() {
      const out = [];
      for (const i of World.des.chop) out.push({ type: 'chop', i, key: 'o' + i });
      return out;
    },
    mine() {
      const out = [];
      for (const i of World.des.mine) out.push({ type: 'mine', i, key: 'o' + i });
      return out;
    },
    haul() {
      const out = [];
      for (const i of World.looseSet) {
        const it = World.items[i];
        if (!it || Game.availItem(i) <= 0 || !hasStockSpace(it.type)) continue;
        out.push({ type: 'haul', i, key: 'i' + i });
      }
      return out;
    },
  };

  /**
   * Naplánuje hromadné zásobování: k plánu `i` přibere sousední plány, které
   * potřebují stejný materiál `m`, dokud se náklad vejde do rukou.
   */
  function planBatch(c, i, m) {
    const batch = [i];
    let total = World.bpNeed(i, m);
    if (total >= Config.CARRY) return { batch, total };
    const x = ix(i), y = iy(i), R = Config.BATCH_RADIUS, now = TimeSys.minutes;
    const near = [];
    for (const b of World.bpSet) {
      if (b === i) continue;
      const cost = BUILD[World.bp[b].type].cost[m];
      if (!cost || World.bpNeed(b, m) <= 0) continue;
      const d = Math.max(Math.abs(ix(b) - x), Math.abs(iy(b) - y));
      if (d > R || Game.isReserved('o' + b, c) || (c.unreach.get('o' + b) || 0) > now) continue;
      near.push([d, b]);
    }
    near.sort((p, q) => p[0] - q[0]);
    for (const [, b] of near) {
      if (total >= Config.CARRY) break;
      batch.push(b);
      total += World.bpNeed(b, m);
    }
    return { batch, total };
  }

  /** Vybere nejlepší práci pro kolonistu podle priorit (1 nejvyšší) a vzdálenosti. */
  function findWork(c) {
    const now = TimeSys.minutes;
    for (let p = 1; p <= 4; p++) {
      for (const wt of WORK_TYPES) {
        if (c.priorities[wt.id] !== p) continue;
        const list = candidates[wt.id](c);
        let best = null, bd = Infinity;
        for (const j of list) {
          if (Game.isReserved(j.key, c)) continue;
          if ((c.unreach.get(j.key) || 0) > now) continue;
          const d = Math.abs(ix(j.i) - c.tx) + Math.abs(iy(j.i) - c.ty);
          if (d < bd) { bd = d; best = j; }
        }
        if (best) { best.work = wt.id; return best; }
      }
    }
    return null;
  }

  // ---------- Drivery úkolů ----------
  const drivers = {
    chop(c, j) { return gather(c, j, 'chop', 'Kácí strom', 'chop'); },
    mine(c, j) { return gather(c, j, 'mine', 'Těží', 'mine'); },
    pick(c, j) { return gather(c, j, 'harvest', 'Sbírá bobule', 'grow'); },

    /**
     * Stavba. Fáze: 0 plán nákladu → 1 pro materiál → 2 rozvoz po plánech v dávce
     * → 3 chůze ke stavbě → 4 stavění. Kolonista nabere materiál pro víc sousedních
     * plánů najednou, obejde je a poslední zásobený plán rovnou postaví; ostatní
     * uvolní, aby je mohl postavit kdokoli.
     */
    build(c, j) {
      if (j.stage === 0) {
        if (!World.bp[j.i]) return FAIL;
        const m = World.bpMissing(j.i);
        if (!m) { j.stage = 3; return; }
        j.mat = m;
        const plan = planBatch(c, j.i, m);
        let have = c.carry && c.carry.type === m ? c.carry.n : 0;
        j.src = -1;
        if (have < plan.total) {
          const src = nearestItem([m], c);
          if (src >= 0) {
            const amt = Math.min(plan.total - have, Game.availItem(src), Config.CARRY - have);
            if (amt > 0) { Game.reserveItem(src, amt, c); j.src = src; j.amt = amt; have += amt; }
          }
        }
        if (have <= 0) return FAIL;
        // ponechat jen tolik plánů, kolik náklad pokryje
        j.batch = [];
        let acc = 0;
        for (const b of plan.batch) {
          if (acc >= have) break;
          if (b !== j.i && !Game.reserve('o' + b, c)) continue;
          j.batch.push(b);
          acc += World.bpNeed(b, m);
        }
        j.last = -1;
        j.stage = j.src >= 0 ? 1 : 2;
        c.activity = 'Nese materiál (' + ITEMS[m].name.toLowerCase() + ')';
      }
      if (j.stage === 1) {
        const r = walk(c, j, ix(j.src), iy(j.src), 0, 'i' + j.src);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        if (!c.pickup(j.src, j.amt, j.mat) && !(c.carry && c.carry.type === j.mat)) return FAIL;
        j.stage = 2;
      }
      if (j.stage === 2) {
        const carrying = c.carry && c.carry.type === j.mat;
        // vybrat nejbližší plán z dávky, který ještě materiál potřebuje
        let b = -1, bd = Infinity;
        if (carrying) for (const q of j.batch) {
          if (!World.bp[q] || World.bpNeed(q, j.mat) <= 0) continue;
          const d = Math.abs(ix(q) - c.tx) + Math.abs(iy(q) - c.ty);
          if (d < bd) { bd = d; b = q; }
        }
        if (b < 0) {
          // rozvoz hotov → zbylé rezervace uvolnit, poslední zásobený plán postavit
          for (const q of j.batch) if (q !== j.last) Game.release('o' + q, c);
          j.batch = [];
          if (j.last >= 0) j.i = j.last;
          if (!World.bp[j.i] || !Game.reserve('o' + j.i, c)) return DONE;
          j.stage = World.bpMissing(j.i) ? 0 : (j.last >= 0 ? 4 : 3);
          return;
        }
        c.activity = j.batch.length > 1 ? `Rozváží materiál (${j.batch.length} plánů)` : 'Nese materiál na stavbu';
        const mode = BUILD[World.bp[b].type].blocks ? 2 : 1;
        const r = walk(c, j, ix(b), iy(b), mode, 'o' + b);
        if (r === 'fail') {
          j.batch = j.batch.filter(q => q !== b);
          if (b !== j.i) Game.release('o' + b, c);
          j.walkKey = null;
          return j.batch.length ? undefined : FAIL;
        }
        if (r === 'moving') return;
        const give = Math.min(World.bpNeed(b, j.mat), c.carry.n);
        const bp = World.bp[b];
        bp.del[j.mat] = (bp.del[j.mat] || 0) + give;
        c.carry.n -= give;
        if (c.carry.n <= 0) c.carry = null;
        if (j.last >= 0 && j.last !== b) Game.release('o' + j.last, c);
        j.last = b;
        j.batch = j.batch.filter(q => q !== b);
        j.walkKey = null;
        return;
      }
      const i = j.i, bp = World.bp[i];
      if (!bp) return FAIL;
      const def = BUILD[bp.type];
      const bx = ix(i), by = iy(i), mode = def.blocks ? 2 : 1;
      if (j.stage === 3) {
        c.activity = 'Jde stavět: ' + def.name.toLowerCase();
        const r = walk(c, j, bx, by, mode, 'o' + i);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 4;
      }
      if (j.stage === 4) {
        const far = Math.max(Math.abs(c.tx - bx), Math.abs(c.ty - by)) > 1;
        if (far || (def.blocks && c.tx === bx && c.ty === by)) { j.stage = 3; j.walkKey = null; return; }
        c.activity = 'Staví: ' + def.name.toLowerCase();
        c.face(bx, by);
        j.progress += c.work('build');
        c.workFrac = j.progress / def.work;
        if (j.progress >= def.work) {
          World.completeBlueprint(i);
          Game.onTileChanged(bx, by);
          Game.stats.built++;
          if (World.struct[i]) Animals.onBuilt(World.struct[i]);
          return DONE;
        }
      }
    },

    /**
     * Práce v dílně (pila, pec): 0 co chybí → 1 pro surovinu → 2 donést do
     * zásobníku dílny → 3 dojít → 4 vyrábět, dokud jsou suroviny a není splněn cíl.
     */
    craft(c, j) {
      const s = World.struct[j.i];
      if (!s || s.decon || !BUILD[s.type].machine) return FAIL;
      const r = Machines.recipes(BUILD[s.type].machine)[j.ri || 0], x = ix(j.i), y = iy(j.i);
      const outType = Object.keys(r.out)[0];
      const target = r.target !== undefined ? r.target : s.target;
      if (j.stage === 0) {
        let miss = null;
        for (const k in r.in) if ((s.inv[k] || 0) < r.in[k]) { miss = k; break; }
        if (!miss) j.stage = 3;
        else {
          j.mat = miss;
          if (c.carry && c.carry.type === miss) j.stage = 2;
          else {
            const src = nearestItem([miss], c);
            if (src < 0) return FAIL;
            const amt = Math.min(Machines.room(s, miss), Game.availItem(src), Config.CARRY);
            Game.reserveItem(src, amt, c);
            j.src = src; j.amt = amt; j.stage = 1;
          }
        }
      }
      if (j.stage === 1) {
        c.activity = 'Nese suroviny do dílny (' + ITEMS[j.mat].name.toLowerCase() + ')';
        const r2 = walk(c, j, ix(j.src), iy(j.src), 0, 'i' + j.src);
        if (r2 === 'fail') return FAIL;
        if (r2 === 'moving') return;
        if (!c.pickup(j.src, j.amt, j.mat)) return FAIL;
        j.stage = 2;
      }
      if (j.stage === 2) {
        const r2 = walk(c, j, x, y, 2);
        if (r2 === 'fail') return FAIL;
        if (r2 === 'moving') return;
        if (c.carry && c.carry.type === j.mat) {
          const k = Math.min(c.carry.n, Machines.room(s, j.mat));
          s.inv[j.mat] = (s.inv[j.mat] || 0) + k;
          c.carry.n -= k;
          if (c.carry.n <= 0) c.carry = null; else c.dropCarry();
        }
        j.stage = 0; j.walkKey = null;
        return;
      }
      if (j.stage === 3) {
        c.activity = 'Jde do dílny: ' + BUILD[s.type].name.toLowerCase();
        const r2 = walk(c, j, x, y, 2);
        if (r2 === 'fail') return FAIL;
        if (r2 === 'moving') return;
        j.stage = 4; j.made = 0;
      }
      if (j.stage === 4) {
        if (!Machines.hasInputs(s, r)) return j.made ? DONE : FAIL;
        c.activity = 'Vyrábí: ' + ITEMS[outType].name.toLowerCase();
        c.face(x, y);
        j.progress += c.work('craft');
        s.prog = j.progress / r.work;
        s.used = Game.tickCount;
        c.workFrac = s.prog;
        if (BUILD[s.type].machine.pollute) Pollution.add(j.i, BUILD[s.type].machine.pollute);
        if (j.progress >= r.work) {
          const out = Machines.craft(s);
          for (const k in out) World.dropItem(c.tx, c.ty, k, out[k]);
          Game.stats.crafted++;
          j.progress = 0;
          if (++j.made >= 8 || World.counts[outType] >= target) return DONE;
        }
      }
    },

    /** Lov a porážka: přiblížit se na dostřel, mířit, vystřelit (hodit oštěp). */
    hunt(c, j) {
      const a = Animals.byId(j.a);
      if (!a || a.gone || !a.hunt) return DONE;
      j.t = (j.t || 0) + 1;
      if (j.t > 2600) return FAIL;
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      const range = c.bow ? 7 : 5;
      if (d > range) {
        c.activity = 'Stopuje zvěř: ' + a.def.name.toLowerCase();
        if (!c.path || (j.t % 40) === 0) {
          if (!c.pathTo(a.tx, a.ty, 1)) { c.unreach.set(j.key, TimeSys.minutes + 60); return FAIL; }
        }
        c.followPath();
        j.progress = 0;
        return;
      }
      c.path = null;
      c.activity = (a.def.wild ? 'Loví: ' : 'Poráží: ') + a.def.name.toLowerCase();
      c.face(a.tx, a.ty);
      j.progress += c.work('hunt');
      c.workFrac = j.progress / 60;
      if (j.progress >= 60) {
        j.progress = 0;
        Game.shot(c.x, c.y - 0.4, a.x, a.y, c.bow ? '#e8e2d0' : '#b98a56');
        const hit = !a.def.wild || U.chance((c.bow ? 0.6 : 0.42) + c.skills.hunt.lvl * 0.03);
        if (hit) {
          a.hp -= c.bow ? 24 : 15;
          if (a.hp <= 0 || !a.def.wild) { Animals.kill(a); return DONE; }
        }
        if (a.def.wild) a.flee(c, false);
      }
    },

    /** Stříhání ovce. */
    shear(c, j) {
      const a = Animals.byId(j.a);
      if (!a || a.gone || a.prod < 1) return DONE;
      j.t = (j.t || 0) + 1;
      if (j.t > 2000) return FAIL;
      if (Math.hypot(a.x - c.x, a.y - c.y) > 1.6) {
        c.activity = 'Jde stříhat ovci';
        if (!c.path || (j.t % 40) === 0) { if (!c.pathTo(a.tx, a.ty, 1)) return FAIL; }
        c.followPath();
        return;
      }
      c.path = null;
      a.timer = 60; a.path = null;      // ovce chvíli postojí
      c.activity = 'Stříhá ovci';
      c.face(a.tx, a.ty);
      j.progress += c.work('grow');
      c.workFrac = j.progress / 70;
      if (j.progress >= 70) {
        a.prod = 0;
        World.dropItem(c.tx, c.ty, 'wool', a.def.wool);
        return DONE;
      }
    },

    /** Vzít si výbavu (teplé oblečení, kuši). */
    equip(c, j) {
      const it = World.items[j.i];
      if (!it || it.type !== j.item || c[j.item]) return FAIL;
      c.activity = 'Jde si pro: ' + ITEMS[j.item].name.toLowerCase();
      const r = walk(c, j, ix(j.i), iy(j.i), 0, 'i' + j.i);
      if (r === 'fail') return FAIL;
      if (r === 'moving') return;
      if (!c.pickup(j.i, 1, j.item)) return FAIL;
      c.carry = null;
      c[j.item] = true;
      return DONE;
    },

    /** Výzkum u výzkumného stolu. */
    research(c, j) {
      const s = World.struct[j.i];
      if (!s || s.decon || !Research.current) return DONE;
      const x = ix(j.i), y = iy(j.i);
      if (j.stage === 0) {
        c.activity = 'Jde bádat';
        const r = walk(c, j, x, y, 2);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 1;
      }
      c.activity = 'Zkoumá: ' + TECHS[Research.current].name.toLowerCase();
      c.face(x, y);
      s.used = Game.tickCount;
      c.workFrac = Research.progress(Research.current);
      Research.add(c.work('research') * Config.RESEARCH_RATE);
      if (++j.progress > 500) return DONE;   // občas přerušit kvůli jídlu a spánku
    },

    decon(c, j) {
      const i = j.i, t = World.deconTarget(i);
      if (!t) return FAIL;
      const def = BUILD[t.type];
      const x = ix(i), y = iy(i), mode = def.blocks ? 2 : 1;
      if (j.stage === 0) {
        c.activity = 'Jde bourat: ' + def.name.toLowerCase();
        const r = walk(c, j, x, y, mode);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 1;
      }
      c.activity = 'Bourá: ' + def.name.toLowerCase();
      c.face(x, y);
      j.progress += c.work('build');
      const need = def.work * 0.6;
      c.workFrac = j.progress / need;
      if (j.progress >= need) {
        World.deconstruct(i);
        Game.onTileChanged(x, y);
        return DONE;
      }
    },

    sow(c, j) {
      const i = j.i, x = ix(i), y = iy(i);
      if (!World.canSow(i)) return FAIL;
      if (j.stage === 0) {
        c.activity = 'Jde sázet';
        const r = walk(c, j, x, y, 0);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 1;
      }
      c.activity = 'Sází brambory';
      j.progress += c.work('grow');
      c.workFrac = j.progress / 28;
      if (j.progress >= 28) {
        World.setCrop(i, 0);
        return DONE;
      }
    },

    harvest(c, j) {
      const i = j.i, x = ix(i), y = iy(i), cr = World.crops[i];
      if (!cr || cr.g < 1) return FAIL;
      if (j.stage === 0) {
        c.activity = 'Jde sklízet';
        const r = walk(c, j, x, y, 0);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 1;
      }
      c.activity = 'Sklízí úrodu';
      j.progress += c.work('grow');
      c.workFrac = j.progress / 32;
      if (j.progress >= 32) {
        World.removeCrop(i);
        const yieldN = Math.round(6 * (0.85 + c.skills.grow.lvl * 0.04));
        World.dropItem(x, y, 'food', yieldN);
        Game.stats.harvested += yieldN;
        return DONE;
      }
    },

    cook(c, j) {
      const i = j.i, s = World.struct[i];
      if (!s || s.type !== 'campfire' || s.decon) return FAIL;
      const x = ix(i), y = iy(i);
      if (j.stage === 0) {
        if (c.carry && COOKABLE.includes(c.carry.type)) { j.mat = c.carry.type; j.stage = 2; }
        else {
          // maso a vejce se kazí nejrychleji → vařit je přednostně
          let src = nearestItem(['meat'], c);
          if (src < 0) src = nearestItem(['egg', 'food'], c);
          if (src < 0) return FAIL;
          const amt = Math.min(Game.availItem(src), 4);
          Game.reserveItem(src, amt, c);
          j.src = src; j.amt = amt; j.mat = World.items[src].type; j.stage = 1;
        }
      }
      if (j.stage === 1) {
        c.activity = 'Nese suroviny k ohništi';
        const r = walk(c, j, ix(j.src), iy(j.src), 0);
        if (r === 'fail') { c.unreach.set('i' + j.src, TimeSys.minutes + 60); return FAIL; }
        if (r === 'moving') return;
        if (!c.pickup(j.src, j.amt, j.mat)) return FAIL;
        j.stage = 2;
      }
      if (j.stage === 2) {
        c.activity = 'Jde k ohništi';
        const r = walk(c, j, x, y, 2);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 3; j.made = 0;
      }
      if (j.stage === 3) {
        if (!c.carry || c.carry.type !== j.mat) return FAIL;
        c.activity = 'Vaří jídlo';
        c.face(x, y);
        j.progress += c.work('cook');
        c.workFrac = j.progress / 40;
        if (j.progress >= 40) {
          j.progress = 0;
          c.carry.n--;
          j.made++;
          // zkušený kuchař občas uvaří porci navíc
          if (U.chance(c.skills.cook.lvl * 0.02)) j.made++;
          if (c.carry.n <= 0) {
            c.carry = null;
            World.dropItem(c.tx, c.ty, 'meal', j.made);
            Game.stats.cooked += j.made;
            return DONE;
          }
        }
      }
    },

    haul(c, j) {
      const i = j.i;
      if (j.stage === 0) {
        const it = World.items[i];
        if (!it) return FAIL;
        const dest = findStockDest(it.type, c);
        if (dest < 0) { c.unreach.set(j.key, TimeSys.minutes + 20); return FAIL; }
        if (!Game.reserve('d' + dest, c)) return FAIL;
        const amt = Math.min(Game.availItem(i), Config.CARRY);
        if (amt <= 0) return FAIL;
        Game.reserveItem(i, amt, c);
        j.dest = dest; j.amt = amt; j.mat = it.type; j.stage = 1;
      }
      if (j.stage === 1) {
        c.activity = 'Nese do skladu: ' + ITEMS[j.mat].name.toLowerCase();
        const r = walk(c, j, ix(i), iy(i), 0);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        if (!c.pickup(i, j.amt, j.mat)) return FAIL;
        j.stage = 2;
      }
      if (j.stage === 2) {
        const r = walk(c, j, ix(j.dest), iy(j.dest), 0);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        if (c.carry) {
          const left = World.putItem(j.dest, c.carry.type, c.carry.n, c.carry.age || 0);
          if (left > 0) World.dropItem(c.tx, c.ty, c.carry.type, left, c.carry.age || 0);
          c.carry = null;
        }
        return DONE;
      }
    },

    /** Jídlo: dojít pro porci, vzít ji a sníst – u stolu, pokud je volná židle. */
    eat(c, j) {
      if (j.stage === 0) {
        const it = World.items[j.i];
        if (!it || (it.type !== 'meal' && it.type !== 'food' && it.type !== 'egg')) return FAIL;
        c.activity = 'Jde se najíst';
        const r = walk(c, j, ix(j.i), iy(j.i), 0, 'i' + j.i);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.food = it.type;
        if (!c.pickup(j.i, 1, it.type)) return FAIL;
        j.seat = findSeat(c);
        if (j.seat >= 0 && !Game.reserve('s' + j.seat, c)) j.seat = -1;
        j.stage = j.seat >= 0 ? 1 : 2;
      }
      if (j.stage === 1) {
        c.activity = 'Nese si jídlo ke stolu';
        const r = walk(c, j, ix(j.seat), iy(j.seat), 0, 's' + j.seat);
        if (r === 'moving') return;
        if (r === 'fail') j.seat = -1;
        j.stage = 2;
      }
      if (!c.carry || c.carry.type !== j.food) return FAIL;
      c.activity = (j.food === 'meal' ? 'Jí teplé jídlo' : 'Jí syrové potraviny') + (j.seat >= 0 ? ' u stolu' : '');
      j.progress++;
      c.workFrac = j.progress / 50;
      c.eating = true;
      if (j.progress >= 50) {
        c.carry = null;
        if (j.food === 'meal') {
          c.hunger = Math.min(100, c.hunger + 60);
          c.addThought('meal', 'Teplé jídlo', 6, 10);
        } else {
          c.hunger = Math.min(100, c.hunger + 32);
          c.addThought('raw', 'Jedl/a syrové jídlo', -6, 10);
        }
        if (j.seat >= 0) c.addThought('table', 'Jedl/a u stolu', 4, 10);
        return DONE;
      }
    },

    /** Hašení požáru – dělá ho každý bez ohledu na priority. */
    firefight(c, j) {
      const i = j.i;
      if (!Fire.burning(i)) return DONE;
      if (j.stage === 0) {
        c.activity = 'Běží hasit požár';
        const r = walk(c, j, ix(i), iy(i), 2, 'f' + i);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 1;
      }
      c.activity = 'Hasí požár';
      c.face(ix(i), iy(i));
      j.progress += c.work(null);
      c.workFrac = j.progress / 45;
      if (j.progress >= 45) { Fire.extinguish(i); return DONE; }
    },

    sleep(c, j) {
      if (j.stage === 0) {
        if (j.bed >= 0) {
          const s = World.struct[j.bed];
          if (!s || s.type !== 'bed') return FAIL;
          c.activity = 'Jde spát';
          const r = walk(c, j, ix(j.bed), iy(j.bed), 0);
          if (r === 'fail') { c.unreach.set('b' + j.bed, TimeSys.minutes + 120); return FAIL; }
          if (r === 'moving') return;
          s.owner = c.id;
        }
        j.stage = 1;
      }
      if (j.bed >= 0 && !World.struct[j.bed]) return FAIL;
      c.sleeping = true;
      c.activity = j.bed >= 0 ? 'Spí v posteli' : (j.collapse ? 'Zhroutil/a se vyčerpáním' : 'Spí na zemi');
      const rate = (j.bed >= 0 ? 100 / 7 : 100 / 9.5) * Config.HOURS_PER_TICK;
      c.energy = Math.min(100, c.energy + rate);
      const wake = (!TimeSys.isNight() && c.energy >= 97) || c.hunger < 12 || (c.energy >= 100 && TimeSys.hour >= 5 && TimeSys.hour < 22);
      if (wake) {
        if (j.bed >= 0) {
          const room = World.roomAt(j.bed);
          if (room && room.beds.length === 1) c.addThought('sleep', 'Vlastní ložnice', 9, 14);
          else if (room) c.addThought('sleep', 'Vyspal/a se pod střechou', 5, 14);
          else c.addThought('sleep', 'Postel pod širým nebem', 2, 14);
        } else c.addThought('sleep', 'Spal/a na zemi', -7, 14);
        return DONE;
      }
    },

    wander(c, j) {
      if (j.stage === 0) {
        let tx = c.tx, ty = c.ty;
        const home = World.start;
        const far = Math.hypot(c.tx - home.x, c.ty - home.y) > 18;
        for (let k = 0; k < 12; k++) {
          const bx = far ? home.x : c.tx, by = far ? home.y : c.ty;
          const x = bx + U.int(-5, 5), y = by + U.int(-5, 5);
          if (World.canWalk(x, y)) { tx = x; ty = y; break; }
        }
        j.tx = tx; j.ty = ty; j.stage = 1;
        j.wait = U.int(40, 120);
      }
      if (j.stage === 1) {
        c.activity = c.inBreak() ? 'Psychické zhroucení – bloumá' : 'Odpočívá';
        const r = walk(c, j, j.tx, j.ty, 0);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 2;
      }
      if (--j.wait <= 0) return DONE;
    },
  };

  /** Společná logika pro kácení, těžbu a sběr. */
  function gather(c, j, des, label, skill) {
    const i = j.i, o = World.obj[i];
    if (!o || o.des !== des) return FAIL;
    if (des === 'harvest' && !o.berries) return FAIL;
    const x = ix(i), y = iy(i);
    const def = OBJECTS[o.type];
    if (j.stage === 0) {
      c.activity = label;
      const r = walk(c, j, x, y, def.blocks ? 2 : 1);
      if (r === 'fail') return FAIL;
      if (r === 'moving') return;
      j.stage = 1;
    }
    c.activity = label;
    c.face(x, y);
    j.progress += c.work(skill);
    const need = def.work * (o.type === 'tree' ? (0.5 + o.size * 0.5) : 1);
    c.workFrac = j.progress / need;
    if (j.progress < need) return;
    if (o.type === 'tree') {
      World.removeObj(i);
      Fire.extinguish(i);
      Game.stats.chopped++;
      World.dropItem(x, y, 'wood', Math.round(10 * o.size + c.skills.chop.lvl * 0.15));
    } else if (o.type === 'rock') {
      World.removeObj(i);
      Game.stats.mined++;
      World.dropItem(x, y, 'stone', U.int(5, 7));
    } else if (o.type === 'ore') {
      // ložisko: ubývá zásoba, políčko zmizí až po vyčerpání
      const k = Math.min(Config.ORE_PER_MINE, o.amount);
      o.amount -= k;
      Game.stats.mined++;
      World.dropItem(c.tx, c.ty, 'ore', k);
      if (o.amount <= 0) World.removeObj(i);
    } else if (o.type === 'bush') {
      o.berries = false;
      o.regrow = Config.BUSH_REGROW_HOURS; // označení zůstává → po dorůstání se sklidí znovu
      World.dropItem(x, y, 'food', U.int(4, 6));
    }
    Game.onTileChanged(x, y);
    return DONE;
  }

  return { DONE, FAIL, drivers, findWork, findFood, hasFood, findBed, findFire, findSeat, nearestItem, anyItem, candidates };
})();
