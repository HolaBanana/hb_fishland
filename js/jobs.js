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
  function walk(c, j, x, y, mode) {
    const key = j.stage + ':' + x + ',' + y + ',' + mode;
    if (j.walkKey !== key) {
      j.walkKey = key;
      if (!c.pathTo(x, y, mode)) {
        c.unreach.set(j.key || ('t' + World.idx(x, y)), TimeSys.minutes + 90);
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
      if (Game.availItem(i) < minAvail) continue;
      if ((c.unreach.get('i' + i) || 0) > TimeSys.minutes) continue;
      const d = Math.abs(ix(i) - c.tx) + Math.abs(iy(i) - c.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function anyItem(type) {
    for (const i of World.itemSet) {
      const it = World.items[i];
      if (it && it.type === type && Game.availItem(i) > 0) return true;
    }
    return false;
  }

  function findStockDest(type, c) {
    let best = -1, bs = Infinity;
    for (const i of World.stockTiles) {
      if (!World.canHoldItem(i) || Game.isReserved('d' + i, c)) continue;
      const it = World.items[i];
      if (it && (it.type !== type || it.n >= Config.STACK)) continue;
      let s = Math.abs(ix(i) - c.tx) + Math.abs(iy(i) - c.ty);
      if (it) s -= 6; // přednostně doplnit existující hromádku
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  }
  function hasStockSpace(type) {
    for (const i of World.stockTiles) {
      if (!World.canHoldItem(i) || Game.isReserved('d' + i)) continue;
      const it = World.items[i];
      if (!it || (it.type === type && it.n < Config.STACK)) return true;
    }
    return false;
  }

  function findFood(c) {
    let i = nearestItem(['meal'], c);
    if (i < 0) i = nearestItem(['food'], c);
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

  // ---------- Generátory kandidátů podle pracovních typů ----------
  const candidates = {
    cook(c) {
      const counts = World.countItems();
      if (counts.meal >= Game.colonists.length * 4 || !anyItem('food')) return [];
      return World.structsOfType('campfire')
        .filter(i => !World.struct[i].decon)
        .map(i => ({ type: 'cook', i, key: 'o' + i }));
    },
    build(c) {
      const out = [];
      for (const i of World.bpSet) {
        const m = World.bpMissing(i);
        if (m && !anyItem(m)) continue;
        // na políčku blokující stavby nesmí ležet jiný kolonista (kromě něj samého)
        out.push({ type: 'build', i, key: 'o' + i });
      }
      for (const i of World.deconSet) out.push({ type: 'decon', i, key: 'o' + i });
      return out;
    },
    grow(c) {
      const out = [];
      const day = TimeSys.daylight() > 0.2;
      for (const i of World.farmTiles) {
        const cr = World.crops[i];
        if (cr && cr.g >= 1) out.push({ type: 'harvest', i, key: 'o' + i });
        else if (day && World.canSow(i)) out.push({ type: 'sow', i, key: 'o' + i });
      }
      for (const i of World.desSet) {
        const o = World.obj[i];
        if (o && o.des === 'harvest' && o.berries) out.push({ type: 'pick', i, key: 'o' + i });
      }
      return out;
    },
    mine(c) {
      const out = [];
      for (const i of World.desSet) {
        const o = World.obj[i];
        if (!o) continue;
        if (o.des === 'chop') out.push({ type: 'chop', i, key: 'o' + i });
        else if (o.des === 'mine') out.push({ type: 'mine', i, key: 'o' + i });
      }
      return out;
    },
    haul(c) {
      const out = [];
      const space = {};
      for (const i of World.itemSet) {
        if (World.zone[i] === 1) continue;
        const it = World.items[i];
        if (!it || Game.availItem(i) <= 0) continue;
        if (space[it.type] === undefined) space[it.type] = hasStockSpace(it.type);
        if (!space[it.type]) continue;
        out.push({ type: 'haul', i, key: 'i' + i });
      }
      return out;
    },
  };

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
    chop(c, j) { return gather(c, j, 'chop', 'Kácí strom', 'mine'); },
    mine(c, j) { return gather(c, j, 'mine', 'Těží', 'mine'); },
    pick(c, j) { return gather(c, j, 'harvest', 'Sbírá bobule', 'grow'); },

    build(c, j) {
      const i = j.i, bp = World.bp[i];
      if (!bp) return FAIL;
      const def = BUILD[bp.type];
      const bx = ix(i), by = iy(i), mode = def.blocks ? 2 : 1;
      if (j.stage === 0) {
        const m = World.bpMissing(i);
        if (!m) { j.stage = 3; return; }
        j.mat = m;
        if (c.carry && c.carry.type === m) { j.stage = 2; return; }
        const src = nearestItem([m], c);
        if (src < 0) return FAIL;
        const amt = Math.min(World.bpNeed(i, m), Game.availItem(src), Config.CARRY);
        Game.reserveItem(src, amt, c);
        j.src = src; j.amt = amt; j.stage = 1;
        c.activity = 'Nese materiál (' + ITEMS[m].name.toLowerCase() + ')';
      }
      if (j.stage === 1) {
        const r = walk(c, j, ix(j.src), iy(j.src), 0);
        if (r === 'fail') { c.unreach.set('i' + j.src, TimeSys.minutes + 60); return FAIL; }
        if (r === 'moving') return;
        if (!c.pickup(j.src, j.amt, j.mat)) return FAIL;
        j.stage = 2;
      }
      if (j.stage === 2) {
        c.activity = 'Nese materiál na stavbu';
        const r = walk(c, j, bx, by, mode);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        if (c.carry && c.carry.type === j.mat) {
          const give = Math.min(World.bpNeed(i, j.mat), c.carry.n);
          bp.del[j.mat] = (bp.del[j.mat] || 0) + give;
          c.carry.n -= give;
          if (c.carry.n <= 0) c.carry = null;
        }
        if (World.bpMissing(i)) { j.stage = 0; return; }
        j.stage = 4;
        return;
      }
      if (j.stage === 3) {
        c.activity = 'Jde stavět: ' + def.name.toLowerCase();
        const r = walk(c, j, bx, by, mode);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 4;
      }
      if (j.stage === 4) {
        if (def.blocks && c.tx === bx && c.ty === by) { j.stage = 3; j.walkKey = null; return; }
        c.activity = 'Staví: ' + def.name.toLowerCase();
        c.face(bx, by);
        j.progress += c.work('build');
        c.workFrac = j.progress / def.work;
        bp.progress = c.workFrac;
        if (j.progress >= def.work) {
          // zkontrolovat, zda na blokující stavbě nestojí kolonista
          World.completeBlueprint(i);
          Game.onTileChanged(bx, by);
          if (c.carry) { World.dropItem(c.tx, c.ty, c.carry.type, c.carry.n); c.carry = null; }
          return DONE;
        }
      }
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
        World.crops[i] = { g: 0 };
        World.cropSet.add(i);
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
        World.crops[i] = null;
        World.cropSet.delete(i);
        const yieldN = Math.round(6 * (0.85 + c.skills.grow.lvl * 0.04));
        World.dropItem(x, y, 'food', yieldN);
        return DONE;
      }
    },

    cook(c, j) {
      const i = j.i, s = World.struct[i];
      if (!s || s.type !== 'campfire' || s.decon) return FAIL;
      const x = ix(i), y = iy(i);
      if (j.stage === 0) {
        if (c.carry && c.carry.type === 'food') { j.stage = 2; }
        else {
          const src = nearestItem(['food'], c);
          if (src < 0) return FAIL;
          const amt = Math.min(Game.availItem(src), 4);
          Game.reserveItem(src, amt, c);
          j.src = src; j.amt = amt; j.stage = 1;
        }
      }
      if (j.stage === 1) {
        c.activity = 'Nese suroviny k ohništi';
        const r = walk(c, j, ix(j.src), iy(j.src), 0);
        if (r === 'fail') { c.unreach.set('i' + j.src, TimeSys.minutes + 60); return FAIL; }
        if (r === 'moving') return;
        if (!c.pickup(j.src, j.amt, 'food')) return FAIL;
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
        if (!c.carry || c.carry.type !== 'food') return FAIL;
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
        if (dest < 0) return FAIL;
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
          const left = World.putItem(j.dest, c.carry.type, c.carry.n);
          if (left > 0) World.dropItem(c.tx, c.ty, c.carry.type, left);
          c.carry = null;
        }
        return DONE;
      }
    },

    eat(c, j) {
      const i = j.i;
      const it = World.items[i];
      if (!it || (it.type !== 'meal' && it.type !== 'food')) return FAIL;
      if (j.stage === 0) {
        c.activity = 'Jde se najíst';
        const r = walk(c, j, ix(i), iy(i), 0);
        if (r === 'fail') return FAIL;
        if (r === 'moving') return;
        j.stage = 1;
      }
      c.activity = it.type === 'meal' ? 'Jí teplé jídlo' : 'Jí syrové potraviny';
      j.progress++;
      c.workFrac = j.progress / 50;
      c.eating = true;
      if (j.progress >= 50) {
        const type = it.type;
        Game.releaseItemRes(c, i);
        if (!World.takeItem(i, 1)) return FAIL;
        if (type === 'meal') {
          c.hunger = Math.min(100, c.hunger + 60);
          c.addThought('meal', 'Teplé jídlo', 6, 10);
        } else {
          c.hunger = Math.min(100, c.hunger + 32);
          c.addThought('raw', 'Jedl/a syrové jídlo', -6, 10);
        }
        return DONE;
      }
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
        if (j.bed >= 0) c.addThought('sleep', 'Vyspal/a se v posteli', 4, 14);
        else c.addThought('sleep', 'Spal/a na zemi', -7, 14);
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
      World.dropItem(x, y, 'wood', Math.round(10 * o.size + c.skills.mine.lvl * 0.15));
    } else if (o.type === 'rock') {
      World.removeObj(i);
      World.dropItem(x, y, 'stone', U.int(5, 7));
    } else if (o.type === 'ore') {
      World.removeObj(i);
      World.dropItem(x, y, 'iron', U.int(4, 6));
      if (U.chance(0.5)) World.dropItem(x, y, 'stone', 2);
    } else if (o.type === 'bush') {
      o.berries = false;
      o.regrow = Config.BUSH_REGROW_HOURS; // označení zůstává → po dorůstání se sklidí znovu
      World.dropItem(x, y, 'food', U.int(4, 6));
    }
    Game.onTileChanged(x, y);
    return DONE;
  }

  return { DONE, FAIL, drivers, findWork, findFood, findBed, nearestItem, anyItem, candidates };
})();
