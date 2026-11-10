'use strict';
/**
 * UI – DOM rozhraní: horní lišta (čas, počasí, zásoby, rychlost), panel kolonistů,
 * informační panel, spodní dotykové menu nástrojů, okno priorit a notifikace.
 */
const UI = {
  TABS: [
    { id: 'orders', label: 'Příkazy', icon: 'chop', tools: ['select', 'chop', 'mine', 'harvest', 'decon', 'cancel'] },
    { id: 'build', label: 'Stavba', icon: 'wall_wood', tools: ['wall_wood', 'wall_stone', 'door', 'floor_wood', 'floor_stone', 'bed', 'campfire', 'table', 'chair', 'chest', 'lamp'] },
    { id: 'prod', label: 'Výroba', icon: 'belt', tools: ['saw', 'furnace', 'research', 'belt', 'drill', 'autosaw', 'autofurnace', 'pole', 'waterwheel', 'windmill', 'boiler'],
      actions: [{ icon: 'research_btn', label: 'Výzkum', run: () => UI.openResearch() }, { icon: 'power_btn', label: 'Energie', run: () => UI.openPower() }] },
    { id: 'zones', label: 'Zóny', icon: 'zone_farm', tools: ['zone_stock', 'zone_farm', 'zone_clear'] },
    { id: 'work', label: 'Práce', icon: 'priorities', action: () => UI.openPriorities() },
    { id: 'menu', label: 'Menu', icon: 'menu', action: () => UI.openMenu() },
  ],
  tab: 'orders',
  icons: {},
  toastQ: [],

  $(id) { return document.getElementById(id); },
  el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  },
  icon(name) {
    if (!this.icons[name]) {
      const src = Sprites.icons[name] || Sprites.items[name] || Sprites.build[name];
      this.icons[name] = src ? Sprites.toURL(src, 3) : '';
    }
    return this.icons[name];
  },
  imgTag(name, cls = 'pix') { return `<img class="${cls}" src="${this.icon(name)}" alt="">`; },

  init() {
    // zásoby
    const res = this.$('resources');
    res.innerHTML = '';
    for (const k of ITEM_ORDER) {
      const chip = this.el('div', 'res', `${this.imgTag(k)}<span id="res-${k}">0</span>`);
      chip.title = ITEMS[k].name;
      if (k === 'plank' || k === 'ore' || k === 'iron') chip.classList.add('hidden');
      res.appendChild(chip);
    }
    const pw = this.el('div', 'res hidden', `${this.imgTag('power_btn')}<span id="res-power">0/0</span>`);
    pw.title = 'Energie: výroba / spotřeba';
    pw.onclick = () => this.openPower();
    res.appendChild(pw);
    const rs = this.el('div', 'res hidden', `${this.imgTag('research_btn')}<span id="res-research">0%</span>`);
    rs.title = 'Probíhající výzkum';
    rs.onclick = () => this.openResearch();
    res.appendChild(rs);
    // rychlost
    const sp = this.$('speed');
    sp.innerHTML = '';
    Config.SPEEDS.forEach((s) => {
      const b = this.el('button', 'spd', s === 0 ? '❚❚' : s + '×');
      b.title = s === 0 ? 'Pauza (mezerník)' : `Rychlost ${s}× (klávesa ${s})`;
      b.dataset.speed = s;
      b.onclick = () => Game.setSpeed(s);
      sp.appendChild(b);
    });
    this.buildColonistBar();
    this.buildTabs();
    this.setTab('orders');
    this.updateSpeed();
    this.$('hintClose').onclick = () => this.setTool('select');
    this.$('rotBtn').onclick = () => Game.rotate();
    this.$('confirmOk').onclick = () => Game.confirmPending();
    this.$('confirmNo').onclick = () => Game.setPending(null);
    this.$('undoBtn').onclick = () => Tools.undo();
    this.$('importFile').onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) Save.importFile(f, d => Main.boot(d), msg => this.toast(msg, 'warn'));
    };
    this.ready = true;
    this.updateUndo();
    this.update();
  },

  /** Po načtení jiné hry / nové kolonii obnovit části rozhraní závislé na stavu. */
  reset() {
    this.buildColonistBar();
    this.setTool('select');
    this.updateSpeed();
    this.updateUndo();
    this.updateInfo(true);
    this.update();
  },

  // ---------- Spodní menu ----------
  buildTabs() {
    const row = this.$('tabRow');
    row.innerHTML = '';
    for (const t of this.TABS) {
      const b = this.el('button', 'tab', `${this.imgTag(t.icon)}<span>${t.label}</span>`);
      b.dataset.tab = t.id;
      b.onclick = () => t.action ? t.action() : this.setTab(t.id);
      row.appendChild(b);
    }
  },
  setTab(id) {
    this.tab = id;
    for (const b of this.$('tabRow').children) b.classList.toggle('active', b.dataset.tab === id);
    const tab = this.TABS.find(t => t.id === id);
    const row = this.$('toolRow');
    row.innerHTML = '';
    for (const a of tab.actions || []) {
      const b = this.el('button', 'tool act', `${this.imgTag(a.icon)}<span class="tname">${a.label}</span>`);
      b.onclick = a.run;
      row.appendChild(b);
    }
    for (const tool of tab.tools) {
      const d = Tools.defs[tool];
      const locked = d.tech && !Research.has(d.tech);
      const cost = Tools.costText(tool);
      const b = this.el('button', 'tool' + (locked ? ' locked' : ''), `${this.imgTag(tool)}<span class="tname">${d.name}</span>` +
        (locked ? `<span class="tcost">🔒 ${TECHS[d.tech].name}</span>` : cost ? `<span class="tcost">${cost}</span>` : ''));
      b.dataset.tool = tool;
      b.onclick = () => {
        if (d.tech && !Research.has(d.tech)) { this.toast(`${d.name}: nejdřív vyzkoumej „${TECHS[d.tech].name}“ (Výroba → Výzkum).`, 'warn'); return; }
        this.setTool(Game.tool === tool && tool !== 'select' ? 'select' : tool);
      };
      row.appendChild(b);
    }
    this.markTool();
  },
  setTool(tool) {
    Game.tool = tool;
    Game.pending = null;
    Input.drag = null;
    this.markTool();
    if (tool !== 'select') {
      const d = Tools.defs[tool];
      this.$('hintText').innerHTML = `<b>${d.name}</b> – ${d.hint || ''}` + (d.build ? ` <i>Cena: ${Tools.costText(tool)}</i>` : '');
    }
    this.updateRotate();
    this.updateConfirm();
  },
  /** Tlačítko otočení stavby v nápovědě nástroje. */
  updateRotate() {
    const d = Tools.defs[Game.tool], b = this.$('rotBtn');
    b.classList.toggle('hidden', !(d && d.rot));
    b.textContent = '⟳ ' + ['→', '↓', '←', '↑'][Game.buildDir];
  },

  /** Lišta s potvrzením výběru (dotyk): náhled, počet políček, cena, Potvrdit / Zrušit. */
  updateConfirm() {
    const p = Game.pending;
    this.$('confirmBar').classList.toggle('hidden', !p);
    this.$('toolHint').classList.toggle('hidden', !!p || Game.tool === 'select');
    if (!p) return;
    const d = Tools.defs[p.tool];
    const n = Tools.countValid(p.tool, Tools.tilesFor(p.tool, p.x0, p.y0, p.x1, p.y1), p.dir);
    let t = `<b>${d.name}</b> `;
    if (n === 0) t += '– tady není co provést.';
    else {
      t += `×${n}`;
      if (d.build) {
        const lack = Tools.lacking(p.tool, n);
        t += ` · <i>${Tools.costText(p.tool, n)}</i>` + (lack.length ? ` <em>chybí ${lack.join(', ')}</em>` : '');
      }
    }
    this.$('confirmText').innerHTML = t;
    this.$('confirmOk').disabled = n === 0;
  },
  updateUndo() {
    const st = Tools.undoStack, b = this.$('undoBtn');
    b.classList.toggle('hidden', st.length === 0);
    if (st.length) b.title = `Vrátit: ${st[st.length - 1].name} ×${st[st.length - 1].n}`;
  },
  markTool() {
    for (const b of this.$('toolRow').children) b.classList.toggle('active', b.dataset.tool === Game.tool);
  },

  updateSpeed() {
    for (const b of this.$('speed').children) b.classList.toggle('active', +b.dataset.speed === Game.speed);
    document.body.classList.toggle('paused', Game.speed === 0);
  },

  // ---------- Kolonisté ----------
  buildColonistBar() {
    const bar = this.$('colonistBar');
    bar.innerHTML = '';
    for (const c of Game.colonists) {
      const card = this.el('div', 'ccard');
      card.innerHTML = `<img class="pix portrait" src="${Sprites.toURL(c.portrait, 4)}" alt="">
        <div class="cinfo"><div class="cname">${c.first}</div>
        <div class="mini"><i class="b-health"></i></div><div class="mini"><i class="b-food"></i></div><div class="mini"><i class="b-energy"></i></div><div class="mini"><i class="b-mood"></i></div></div>`;
      card.onclick = () => {
        if (Game.selected && Game.selected.c === c) Camera.follow = Camera.follow === c ? null : c;
        Game.select({ type: 'colonist', c });
        Camera.centerOn(c.x * Config.TILE, c.y * Config.TILE);
      };
      c.card = card;
      bar.appendChild(card);
    }
  },
  updateColonistBar() {
    for (const c of Game.colonists) {
      const card = c.card;
      if (!card) continue;
      card.querySelector('.b-health').style.width = c.health + '%';
      card.querySelector('.b-food').style.width = c.hunger + '%';
      card.querySelector('.b-energy').style.width = c.energy + '%';
      const m = card.querySelector('.b-mood');
      m.style.width = c.mood + '%';
      m.style.background = this.moodColor(c.mood);
      card.classList.toggle('sel', !!(Game.selected && Game.selected.c === c));
      card.classList.toggle('alert', c.hunger < 15 || c.energy < 10 || c.health < 50 || c.inBreak());
      card.title = `${c.name} – ${c.activity}`;
    }
  },
  moodColor(m) { return m < 25 ? '#e5534b' : m < 45 ? '#e3a23b' : m < 70 ? '#cfd65a' : '#6fd36f'; },
  moodLabel(m) { return m < 15 ? 'Na pokraji zhroucení' : m < 30 ? 'Nešťastný/á' : m < 45 ? 'Ve stresu' : m < 60 ? 'V pohodě' : m < 80 ? 'Spokojený/á' : 'Šťastný/á'; },

  // ---------- Informační panel ----------
  updateInfo(force) {
    const p = this.$('infoPanel');
    const s = Game.selected;
    if (!s) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    if (s.type === 'colonist') this.colonistInfo(p, s.c, force);
    else this.tileInfo(p, s.x, s.y);
  },
  bar(label, val, color) {
    return `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${U.clamp(val, 0, 100)}%;background:${color}"></i></div><b>${Math.round(val)}</b></div>`;
  },
  colonistInfo(p, c, force) {
    if (force || p.dataset.kind !== 'c' + c.id) {
      p.dataset.kind = 'c' + c.id;
      p.innerHTML = `<div class="phead"><img class="pix portrait" src="${Sprites.toURL(c.portrait, 4)}" alt="">
        <div><div class="ptitle">${c.name}</div><div class="psub">${c.age} let · ${c.trait.name} <small>(${c.trait.desc})</small></div></div>
        <button class="x" id="infoClose">✕</button></div>
        <div class="pact" id="pAct"></div>
        <div id="pNeeds"></div>
        <div class="psec">Dovednosti</div><div id="pSkills"></div>
        <div class="psec">Nálada – vlivy</div><div id="pThoughts" class="thoughts"></div>
        <div class="pbtns"><button id="pFollow">Sledovat</button><button id="pPrio">Priority práce</button></div>`;
      this.$('infoClose').onclick = () => Game.select(null);
      this.$('pFollow').onclick = () => { Camera.follow = Camera.follow === c ? null : c; };
      this.$('pPrio').onclick = () => this.openPriorities();
    }
    this.$('pAct').textContent = (c.carry ? `[${ITEMS[c.carry.type].name} ×${c.carry.n}] ` : '') + c.activity;
    this.$('pFollow').textContent = Camera.follow === c ? 'Nesledovat' : 'Sledovat';
    this.$('pNeeds').innerHTML =
      this.bar('Zdraví', c.health, c.health < 40 ? '#e5534b' : '#d9534f') +
      this.bar('Sytost', c.hunger, '#e3a23b') +
      this.bar('Energie', c.energy, '#58a6ff') +
      this.bar('Nálada', c.mood, this.moodColor(c.mood)) +
      `<div class="moodl">${this.moodLabel(c.mood)}</div>`;
    let sk = '';
    for (const k in SKILLS) {
      const s = c.skills[k];
      const pct = s.xp / c.xpNeed(s.lvl) * 100;
      sk += `<div class="skill"><span>${SKILLS[k]}</span><div class="sbar"><i style="width:${s.lvl / 20 * 100}%"></i><u style="width:${pct}%"></u></div><b>${s.lvl}</b></div>`;
    }
    this.$('pSkills').innerHTML = sk;
    this.$('pThoughts').innerHTML = c.moodFactors().map(f =>
      `<div class="th ${f.val >= 0 ? 'pos' : 'neg'}"><span>${f.label}</span><b>${f.val > 0 ? '+' : ''}${f.val}</b></div>`).join('');
  },
  tileInfo(p, x, y) {
    // panel s filtrem se nepřekresluje při každé aktualizaci (klepnutí by se ztrácela)
    const mach = World.struct[World.idx(x, y)] && BUILD[World.struct[World.idx(x, y)].type].machine;
    const key = 't' + x + ',' + y + ':' + World.itemVer + ':' + (mach ? Game.tickCount / 20 | 0 : TimeSys.minutes / 30 | 0);
    if (p.dataset.kind === key) return;
    p.dataset.kind = key;
    const i = World.idx(x, y);
    const ter = TERRAIN[World.terrain[i]];
    const rows = [];
    rows.push(['Terén', ter.name]);
    if (ter.fert > 0) rows.push(['Úrodnost', Math.round(ter.fert * 100) + ' %']);
    const o = World.obj[i];
    if (o) {
      let t = OBJECTS[o.type].name;
      if (o.type === 'bush') t += o.berries ? ' (zralé bobule)' : ' (dorůstá)';
      if (o.type === 'tree') t += ` (${Math.round(o.size * 100)} %)`;
      if (o.des) t += ' – ' + { chop: 'ke kácení', mine: 'k těžbě', harvest: 'ke sběru' }[o.des];
      rows.push(['Objekt', t]);
    }
    const st = World.struct[i];
    if (st) rows.push(['Stavba', BUILD[st.type].name + (st.decon ? ' (k bourání)' : '')]);
    let machineHtml = '';
    if (st && BUILD[st.type].machine) {
      const m = BUILD[st.type].machine;
      const list = (o) => Object.keys(o || {}).filter(k => o[k] >= 1).map(k => `${ITEMS[k].name} ${Math.floor(o[k])}`).join(', ') || '–';
      rows.push(['Stav', Machines.status(st) || '–']);
      if (m.recipe) {
        rows.push(['Recept', Object.keys(m.recipe.in).map(k => `${m.recipe.in[k]} ${ITEMS[k].name.toLowerCase()}`).join(' + ') + ' → ' + Object.keys(m.recipe.out).map(k => `${m.recipe.out[k]} ${ITEMS[k].name.toLowerCase()}`).join(', ')]);
        rows.push(['Zásobník', list(st.inv)]);
      }
      if (m.fuel) rows.push(['Palivo', list(st.inv) + (st.burn > 0 ? ` (hoří ještě ${Math.ceil(st.burn)} min)` : '')]);
      if (m.recipe || m.drill) rows.push(['Výstup', list(st.out)]);
      if (m.drill && World.obj[st.i]) rows.push(['Ložisko', `zbývá ${World.obj[st.i].amount} ks rudy`]);
      const net = Power.netOf.get(st.i);
      if (m.power) rows.push(['Energie', net ? `odběr ${m.power} ⚡, síť ${net.supply}/${net.demand} ⚡` : `potřebuje ${m.power} ⚡ – není v dosahu zdroje ani sloupu`]);
      else if (m.gen || m.pole) rows.push(['Síť', net ? `výroba ${net.supply} ⚡, spotřeba ${net.demand} ⚡, strojů ${net.users.length}` : '–']);
      if (m.manual && m.recipe) {
        const outType = Object.keys(m.recipe.out)[0];
        machineHtml = `<div class="psec">Vyrábět, dokud je ve skladu méně než</div>
          <div class="target"><button data-act="t-10">−10</button><b>${st.target} × ${ITEMS[outType].name.toLowerCase()}</b><button data-act="t10">+10</button></div>
          <div class="mnote">Teď máš ${World.counts[outType]}. Kolonisté s prací Řemeslo sem sami nosí suroviny.</div>`;
      }
    }
    if (World.floor[i]) rows.push(['Podlaha', BUILD[World.floor[i].type].name]);
    const bp = World.bp[i];
    if (bp) {
      const cost = BUILD[bp.type].cost;
      rows.push(['Plán', BUILD[bp.type].name]);
      rows.push(['Materiál', Object.keys(cost).map(m => `${ITEMS[m].name} ${bp.del[m] || 0}/${cost[m]}`).join(', ')]);
    }
    const cr = World.crops[i];
    if (cr) rows.push(['Brambory', cr.g >= 1 ? 'zralé ke sklizni' : `roste ${Math.round(cr.g * 100)} %`]);
    const it = World.items[i];
    if (it) {
      const fr = World.freshness(i);
      rows.push(['Předmět', `${ITEMS[it.type].name} ×${it.n}` + (fr >= 0 ? ` – čerstvost ${Math.round(fr * 100)} %` : '')]);
    }
    if (World.zone[i]) rows.push(['Zóna', World.zone[i] === 1 ? 'Sklad' : 'Pole']);
    const room = World.roomAt(i);
    if (room) rows.push(['Místnost', `pod střechou, ${room.tiles.length} políček` + (room.beds.length === 1 ? ', ložnice' : '') + (room.heat ? ', vytápěná' : '')]);
    else if (World.isRoofed(i)) rows.push(['Střecha', 'ano']);
    rows.push(['Teplota', Math.round(World.tempAt(i)) + ' °C']);
    if (Fire.burning(i)) rows.push(['Požár', 'hoří!']);
    // filtr skladu / truhly
    let filterHtml = '';
    if (World.isStock(i)) {
      const f = World.filter[i];
      filterHtml = `<div class="psec">Co se sem smí ukládat</div><div class="filters">` + ITEM_KEYS.map(k =>
        `<button class="fbtn ${World.allowed(i, k) ? 'on' : ''}" data-k="${k}">${this.imgTag(k)}<span>${ITEMS[k].name}</span></button>`).join('') +
        `</div><div class="pbtns"><button id="fAll">Vše</button><button id="fNone">Nic</button></div>
        <div class="mnote">${World.isChest(i) ? 'Platí pro tuto truhlu.' : 'Platí pro celý souvislý sklad.'} Co sem nepatří, kolonisté odnesou jinam.</div>`;
    }
    p.innerHTML = `<div class="phead"><div><div class="ptitle">${World.isChest(i) ? 'Truhla' : st && BUILD[st.type].machine ? BUILD[st.type].name : World.zone[i] === 1 ? 'Sklad' : 'Políčko'} ${x}, ${y}</div></div><button class="x" id="infoClose">✕</button></div>
      <table class="ttab">${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>${machineHtml}${filterHtml}`;
    this.$('infoClose').onclick = () => Game.select(null);
    // reaguje už na stisk – panel se průběžně překresluje a klepnutí by se mohlo ztratit
    p.onpointerdown = (e) => {
      const act = e.target.closest && e.target.closest('[data-act]');
      if (!act) return;
      const cur = World.struct[i];
      if (cur && cur.target !== undefined) {
        cur.target = U.clamp(cur.target + (act.dataset.act === 't10' ? 10 : -10), 0, 500);
        p.dataset.kind = '';
        this.tileInfo(p, x, y);
      }
    };
    if (filterHtml) {
      const region = World.stockRegion(i);
      const cur = () => (World.filter[i] & FILTER_CUSTOM) ? World.filter[i] : (FILTER_CUSTOM | (FILTER_CUSTOM - 1));
      const apply = (mask) => { World.setFilter(region, mask); this.tileInfo(p, x, y); };
      p.querySelectorAll('.fbtn').forEach(b => b.onclick = () => apply(cur() ^ ITEM_BIT[b.dataset.k]));
      this.$('fAll').onclick = () => apply(0);
      this.$('fNone').onclick = () => apply(FILTER_CUSTOM);
    }
  },

  // ---------- Okno priorit ----------
  openPriorities() {
    const m = this.$('modal');
    const render = () => {
      let h = `<div class="mbox wide"><div class="mhead"><b>Priority práce</b><button class="x" id="mClose">✕</button></div>
        <p class="mnote">Klepnutím měníš prioritu: <b class="p1">1</b> nejvyšší … <b class="p4">4</b> nejnižší, <b class="p0">–</b> nedělá. Číslo pod prioritou = úroveň dovednosti.</p>
        <div class="ptable"><table><tr><th></th>${WORK_TYPES.map(w => `<th><span class="full">${w.name}</span><span class="short">${w.short}</span></th>`).join('')}</tr>`;
      for (const c of Game.colonists) {
        h += `<tr><td class="pname"><img class="pix portrait sm" src="${Sprites.toURL(c.portrait, 3)}" alt="">${c.first}</td>`;
        for (const w of WORK_TYPES) {
          const v = c.priorities[w.id];
          const lvl = w.skill ? c.skills[w.skill].lvl : '';
          h += `<td><button class="prio p${v}" data-c="${c.id}" data-w="${w.id}">${v || '–'}</button><small>${lvl}</small></td>`;
        }
        h += '</tr>';
      }
      h += '</table></div></div>';
      m.innerHTML = h;
      m.classList.remove('hidden');
      this.$('mClose').onclick = () => m.classList.add('hidden');
      m.querySelectorAll('.prio').forEach(b => b.onclick = () => {
        const c = Game.colonistById(+b.dataset.c);
        const v = c.priorities[b.dataset.w];
        c.priorities[b.dataset.w] = v === 0 ? 1 : v >= 4 ? 0 : v + 1;
        render();
      });
    };
    m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
    render();
  },

  openMenu() {
    const m = this.$('modal');
    const render = () => {
      m.innerHTML = `<div class="mbox"><div class="mhead"><b>Menu</b><button class="x" id="mClose">✕</button></div>
        <div class="menu">
          <button id="mBack">Pokračovat ve hře</button>
          <button id="mSave">Uložit nyní</button>
          <button id="mExport">Exportovat hru do souboru</button>
          <button id="mImport">Importovat hru ze souboru</button>
          <button id="mAuto">Zrychlit čas, když všichni spí: <b class="${Game.autoFast ? 'on' : 'off'}">${Game.autoFast ? 'ZAP' : 'VYP'}</b></button>
          <button id="mHelp">Nápověda a ovládání</button>
          <button id="mNew">Nová kolonie (nová mapa)</button>
        </div><p class="mnote">Hra se ukládá automaticky každou herní hodinu do tohoto prohlížeče. Semínko mapy: ${Game.seed}</p></div>`;
      m.classList.remove('hidden');
      const close = () => m.classList.add('hidden');
      this.$('mClose').onclick = close;
      this.$('mBack').onclick = close;
      this.$('mSave').onclick = () => {
        close();
        if (Save.store()) this.toast('Hra uložena.', 'good');
        else this.toast('Uložení do prohlížeče selhalo – použij export do souboru.', 'warn');
      };
      this.$('mExport').onclick = () => { close(); Save.exportFile(); this.toast('Uložená hra se stahuje jako soubor.', 'good'); };
      this.$('mImport').onclick = () => { close(); this.$('importFile').click(); };
      this.$('mAuto').onclick = () => { Game.setAutoFast(!Game.autoFast); render(); };
      this.$('mHelp').onclick = () => this.openHelp();
      this.$('mNew').onclick = () => {
        if (confirm('Opravdu začít novou kolonii? Současná uložená hra bude přepsána.')) { Save.clear(); Main.boot(null); }
      };
    };
    m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
    render();
  },

  /** Úvodní dotaz: pokračovat z uložené hry, nebo začít znovu. */
  askContinue(saved) {
    const m = this.$('modal');
    const when = new Date(saved.savedAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    m.innerHTML = `<div class="mbox"><div class="mhead"><b>Kolonie</b></div>
      <p>Nalezena uložená hra: <b class="on">${saved.label}</b><br><span class="mnote">${saved.colonists.map(c => c.first).join(', ')} · uloženo ${when}</span></p>
      <div class="menu">
        <button id="mCont">Pokračovat</button>
        <button id="mNewGame">Nová kolonie</button>
      </div></div>`;
    m.classList.remove('hidden');
    m.onclick = null;
    this.$('mCont').onclick = () => Main.boot(saved);
    this.$('mNewGame').onclick = () => Main.boot(null);
  },

  openHelp(first) {
    const m = this.$('modal');
    m.innerHTML = `<div class="mbox help"><div class="mhead"><b>${first ? 'Vítej v kolonii!' : 'Nápověda'}</b><button class="x" id="mClose">✕</button></div>
      <div class="hbody">
      <p>Čtyři kolonisté ztroskotali v divočině. Postarej se, aby měli <b>jídlo</b>, <b>postele</b> a <b>střechu nad hlavou</b>. Kolonisté si práci berou sami podle svých <b>priorit</b> a dovedností – ty jen plánuješ.</p>
      <h4>Ovládání</h4>
      <ul>
        <li><b>Posun mapy:</b> táhni jedním prstem (s nástrojem Výběr) / pravé tlačítko myši / WASD.</li>
        <li><b>Zoom:</b> roztáhni dva prsty / kolečko myši.</li>
        <li><b>Výběr oblasti:</b> zvol nástroj ve spodním menu a táhni prstem přes mapu.</li>
        <li><b>Výběr kolonisty:</b> klepni na něj nebo na jeho kartu nahoře. Druhé klepnutí na kartu = sledování kamerou.</li>
        <li><b>Potvrzení:</b> po tažení prstem se ukáže náhled s cenou – potvrď ✔, nebo zruš ✕. Poslední akci vrátíš tlačítkem <b>↶ Zpět</b>.</li>
        <li><b>Čas:</b> ❚❚ pauza, 1× až 4× (klávesy mezerník, 1–4). V Menu lze zapnout zrychlení, když všichni spí.</li>
        <li><b>Ukládání:</b> automaticky každou herní hodinu; v Menu je export a import do souboru.</li>
      </ul>
      <h4>Jak začít</h4>
      <ol>
        <li><b>Příkazy → Kácet</b>: označ pár stromů – dřevo je potřeba na všechno. Kácení má vlastní prioritu i dovednost (Dřevorubectví).</li>
        <li><b>Stavba → Ohniště</b>: na něm se vaří teplé jídlo (lepší nálada).</li>
        <li><b>Zóny → Pole</b>: na úrodné půdě (tmavá hlína) rostou brambory rychleji.</li>
        <li><b>Stavba → Postel</b> pro každého kolonistu, kolem postav <b>zdi</b> a <b>dveře</b>.</li>
        <li><b>Příkazy → Těžit</b> skálu (kámen) a ložiska železné rudy (oranžové žilky).</li>
        <li><b>Výroba</b>: postav Pilu a Pec (prkna a železné pláty) a Výzkumný stůl – od třetího dne se vyplatí první stroje.</li>
      </ol>
      <h4>Automatizace</h4>
      <ul>
        <li><b>Dílny</b> (Výroba): pila řeže dřevo na prkna, pec taví rudu na železné pláty. Obsluhují je kolonisté s prací Řemeslo.</li>
        <li><b>Ložiska rudy</b> mají zásobu ${Config.ORE_AMOUNT} kusů – těžbou nezmizí hned.</li>
        <li><b>Výzkum</b>: postav výzkumný stůl a ve Výroba → Výzkum vyber technologii. Dokončení stromu je cíl hry.</li>
        <li><b>Stroje</b>: vrták, automatická pila a pec s podavačem berou suroviny ze sousedních políček nebo z pásu a výrobky kladou ve směru šipky. Směr otočíš tlačítkem ⟳ v nápovědě nástroje.</li>
        <li><b>Pásy</b>: táhni prstem ve směru, kterým mají vozit. Zatáčka = další pás jiným směrem.</li>
        <li><b>Energie</b>: vodní kolo (na mělké vodě), větrník a kotel na dřevo. Stroje musí být v dosahu zdroje nebo sloupu; přehled je ve Výroba → Energie.</li>
      </ul>
      <h4>Přežití</h4>
      <ul>
        <li><b>Zdraví:</b> dlouhé hladovění a vyčerpání ubírají zdraví a kolonista může zemřít. Když zemřou všichni, hra končí.</li>
        <li><b>Roční období:</b> jaro, léto, podzim a zima po ${Config.SEASON_DAYS} dnech. V zimě plodiny nerostou a keře neplodí – udělej zásoby.</li>
        <li><b>Kažení:</b> syrové potraviny se kazí rychleji než uvařené; pod střechou, v truhle a v chladu vydrží déle.</li>
        <li><b>Místnosti:</b> prostor uzavřený zdmi a dveřmi je pod střechou – neprší tam a ohniště ho vytopí. Vlastní ložnice (místnost s jednou postelí) zlepšuje náladu.</li>
        <li><b>Nábytek:</b> stůl se židlí vedle něj zlepší náladu při jídle. Klepnutím na sklad nebo truhlu nastavíš, co se tam smí ukládat.</li>
        <li><b>Události:</b> poutníci se přidávají ke kolonii, divočáci žerou pole (bdělý kolonista je zaplaší) a blesk může zapálit les – oheň se šíří po stromech a dřevěných stavbách.</li>
      </ul>
      <p>Hlídej ukazatele <b>zdraví</b>, <b>sytosti</b>, <b>energie</b> a <b>nálady</b>. Velmi nešťastný kolonista se může psychicky zhroutit a přestat pracovat.</p>
      </div><div class="menu"><button id="mBack">${first ? 'Začít hrát' : 'Zavřít'}</button></div></div>`;
    m.classList.remove('hidden');
    const close = () => m.classList.add('hidden');
    this.$('mClose').onclick = close;
    this.$('mBack').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
  },

  // ---------- Výzkum ----------
  openResearch() {
    const m = this.$('modal');
    const render = () => {
      const hasTable = World.structBy.research && World.structBy.research.size;
      let h = `<div class="mbox wide"><div class="mhead"><b>Výzkum</b><button class="x" id="mClose">✕</button></div>
        <p class="mnote">${hasTable ? 'Klepni na technologii, kterou mají kolonisté zkoumat (práce Výzkum u výzkumného stolu).' : '<b class="p1">Nejdřív postav Výzkumný stůl (Výroba).</b>'} Dokončení celého stromu je cílem hry.</p><div class="techs">`;
      for (const id in TECHS) {
        const t = TECHS[id];
        const done = Research.done.has(id), avail = Research.available(id), cur = Research.current === id;
        const pr = Research.progress(id);
        h += `<button class="tech ${done ? 'done' : avail ? 'avail' : 'lock'} ${cur ? 'cur' : ''}" data-id="${id}">
          <div class="tn">${done ? '✔ ' : cur ? '▶ ' : avail ? '' : '🔒 '}${t.name}<small>${done ? 'hotovo' : Math.floor(pr * t.cost) + ' / ' + t.cost}</small></div>
          <div class="td">${t.desc}${!done && !avail ? ' <i>Vyžaduje: ' + t.req.filter(r => !Research.done.has(r)).map(r => TECHS[r].name).join(', ') + '</i>' : ''}</div>
          <div class="bar"><i style="width:${pr * 100}%;background:${done ? '#6fd36f' : '#58a6ff'}"></i></div></button>`;
      }
      h += '</div></div>';
      m.innerHTML = h;
      m.classList.remove('hidden');
      this.$('mClose').onclick = () => m.classList.add('hidden');
      m.querySelectorAll('.tech.avail').forEach(b => b.onclick = () => { Research.setCurrent(b.dataset.id); render(); });
    };
    m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
    render();
  },

  // ---------- Přehled energie ----------
  openPower() {
    const m = this.$('modal');
    if (Power.dirty) Power.rebuild();
    let h = `<div class="mbox wide"><div class="mhead"><b>Energie</b><button class="x" id="mClose">✕</button></div>
      <p class="mnote">Celkem výroba <b class="on">${Power.supply} ⚡</b>, spotřeba <b class="${Power.demand > Power.supply ? 'p1' : 'on'}">${Power.demand} ⚡</b>. Zdroje a sloupy se propojí do ${Config.POWER_LINK} políček, stroj musí být do ${Config.POWER_REACH} políček od zdroje nebo sloupu. Při nedostatku běží stroje pomaleji, bez energie stojí.</p>`;
    if (!Power.nets.length) h += '<p>Zatím nemáš žádný zdroj energie. Vyzkoumej Vodní energii a postav vodní kolo na mělké vodě.</p>';
    Power.nets.forEach((net, k) => {
      const count = (arr) => { const c = {}; for (const s of arr) c[BUILD[s.type].name] = (c[BUILD[s.type].name] || 0) + 1; return Object.keys(c).map(n => `${c[n]}× ${n}`).join(', ') || '–'; };
      const g = net.gens[0] || net.poles[0];
      h += `<div class="net"><div class="tn">Síť ${k + 1}<small>${net.supply} / ${net.demand} ⚡ (${Math.round(net.factor * 100)} %)</small></div>
        <div class="bar"><i style="width:${Math.min(100, net.demand ? net.supply / net.demand * 100 : 100)}%;background:${net.factor < 1 ? '#e5534b' : '#6fd36f'}"></i></div>
        <div class="td">Zdroje: ${net.gens.map(s => `${BUILD[s.type].name} ${Power.output(s)} ⚡`).join(', ') || '–'}<br>Stroje: ${count(net.users)}${net.poles.length ? '<br>Sloupů: ' + net.poles.length : ''}</div>
        <button class="jump" data-x="${g.i % World.w}" data-y="${(g.i / World.w) | 0}">Ukázat na mapě</button></div>`;
    });
    h += '</div>';
    m.innerHTML = h;
    m.classList.remove('hidden');
    this.$('mClose').onclick = () => m.classList.add('hidden');
    m.querySelectorAll('.jump').forEach(b => b.onclick = () => { Camera.follow = null; Camera.centerTile(+b.dataset.x, +b.dataset.y); m.classList.add('hidden'); });
    m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
  },

  /** Vítězství – dokončený strom technologií. Hrát se dá dál. */
  victory() {
    const m = this.$('modal'), st = Game.stats;
    m.innerHTML = `<div class="mbox help"><div class="mhead"><b>Kolonie je soběstačná!</b></div>
      <div class="hbody"><p>Dokončil/a jsi celý výzkum ${TimeSys.day}. dne. Stroje teď pracují za kolonisty – cíl hry je splněn.</p>
      <table class="ttab">
        <tr><td>Kolonistů</td><td>${Game.colonists.length}</td></tr>
        <tr><td>Postavené stavby</td><td>${st.built}</td></tr>
        <tr><td>Výrobků ze strojů</td><td>${st.machined}</td></tr>
        <tr><td>Výrobků z dílen</td><td>${st.crafted}</td></tr>
      </table></div><div class="menu"><button id="mBack">Hrát dál</button></div></div>`;
    m.classList.remove('hidden');
    this.$('mBack').onclick = () => m.classList.add('hidden');
  },

  /** Konec hry – všichni kolonisté zemřeli. */
  gameOver() {
    const m = this.$('modal'), st = Game.stats;
    const days = TimeSys.day;
    m.innerHTML = `<div class="mbox help"><div class="mhead"><b>Kolonie zanikla</b></div>
      <div class="hbody">
      <p>Poslední kolonista zemřel ${days}. dne (${TimeSys.seasonName.toLowerCase()}, rok ${TimeSys.year}).</p>
      <table class="ttab">
        <tr><td>Přežité dny</td><td>${days}</td></tr>
        <tr><td>Postavené stavby</td><td>${st.built}</td></tr>
        <tr><td>Pokácené stromy</td><td>${st.chopped}</td></tr>
        <tr><td>Vytěžené skály</td><td>${st.mined}</td></tr>
        <tr><td>Sklizeno potravin</td><td>${st.harvested}</td></tr>
        <tr><td>Uvařená jídla</td><td>${st.cooked}</td></tr>
        <tr><td>Příchozí kolonisté</td><td>${st.joined}</td></tr>
      </table>
      <h4>Padlí</h4>
      <ul>${st.deaths.map(d => `<li>${d.name} – ${d.day}. den, ${d.cause}</li>`).join('')}</ul>
      </div><div class="menu"><button id="mNewGame">Nová kolonie</button></div></div>`;
    m.classList.remove('hidden');
    m.onclick = null;
    this.$('mNewGame').onclick = () => Main.boot(null);
  },

  // ---------- Notifikace ----------
  toast(msg, kind = 'info') {
    const box = this.$('toasts');
    if (!box) return;
    const t = this.el('div', 'toast ' + kind, msg);
    box.appendChild(t);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4800);
  },

  // ---------- Pravidelná aktualizace ----------
  update() {
    this.$('dayLabel').textContent = `Den ${TimeSys.day}`;
    this.$('timeLabel').textContent = TimeSys.timeStr();
    const d = TimeSys.daylight();
    this.$('sunIcon').textContent = d > 0.5 ? '☀️' : d > 0.05 ? '🌅' : '🌙';
    const wd = Weather.def;
    const temp = TimeSys.temp();
    this.$('weatherLabel').textContent = `${Weather.cur === 'clear' && d < 0.3 ? '✨' : (temp < 0 && wd.snowName ? '🌨️' : wd.icon)} ${temp < 0 && wd.snowName ? wd.snowName : wd.name}`;
    const sl = this.$('seasonLabel');
    sl.textContent = `${TimeSys.seasonName} ${Math.round(temp)}°C`;
    sl.className = 's' + TimeSys.season;
    const counts = World.countItems();
    for (const k of ITEM_ORDER) {
      const e = this.$('res-' + k);
      e.textContent = counts[k];
      // pokročilé suroviny se ukážou, až je kolonie poprvé získá
      if (counts[k] > 0) e.parentNode.classList.remove('hidden');
    }
    const pw = this.$('res-power');
    pw.parentNode.classList.toggle('hidden', !Power.nets.length);
    pw.textContent = `${Power.supply}/${Power.demand}`;
    pw.parentNode.classList.toggle('low', Power.demand > Power.supply);
    const rs = this.$('res-research');
    rs.parentNode.classList.toggle('hidden', !Research.current);
    if (Research.current) rs.textContent = Math.floor(Research.progress(Research.current) * 100) + '%';
    this.updateColonistBar();
    if (Game.selected) this.updateInfo(false);
  },
};
