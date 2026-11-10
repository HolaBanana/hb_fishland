'use strict';
/**
 * UI – DOM rozhraní: horní lišta (čas, počasí, zásoby, rychlost), panel kolonistů,
 * informační panel, spodní dotykové menu nástrojů, okno priorit a notifikace.
 */
const UI = {
  TABS: [
    { id: 'orders', label: 'Příkazy', icon: 'chop', tools: ['select', 'chop', 'mine', 'harvest', 'decon', 'cancel'] },
    { id: 'build', label: 'Stavba', icon: 'wall_wood', tools: ['wall_wood', 'wall_stone', 'door', 'floor_wood', 'floor_stone', 'bed', 'campfire', 'lamp'] },
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
      res.appendChild(chip);
    }
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
    for (const tool of tab.tools) {
      const d = Tools.defs[tool];
      const cost = Tools.costText(tool);
      const b = this.el('button', 'tool', `${this.imgTag(tool)}<span class="tname">${d.name}</span>` + (cost ? `<span class="tcost">${cost}</span>` : ''));
      b.dataset.tool = tool;
      b.onclick = () => this.setTool(Game.tool === tool && tool !== 'select' ? 'select' : tool);
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
    this.updateConfirm();
  },

  /** Lišta s potvrzením výběru (dotyk): náhled, počet políček, cena, Potvrdit / Zrušit. */
  updateConfirm() {
    const p = Game.pending;
    this.$('confirmBar').classList.toggle('hidden', !p);
    this.$('toolHint').classList.toggle('hidden', !!p || Game.tool === 'select');
    if (!p) return;
    const d = Tools.defs[p.tool];
    const n = Tools.countValid(p.tool, Tools.tilesFor(p.tool, p.x0, p.y0, p.x1, p.y1));
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
        <div class="mini"><i class="b-food"></i></div><div class="mini"><i class="b-energy"></i></div><div class="mini"><i class="b-mood"></i></div></div>`;
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
      card.querySelector('.b-food').style.width = c.hunger + '%';
      card.querySelector('.b-energy').style.width = c.energy + '%';
      const m = card.querySelector('.b-mood');
      m.style.width = c.mood + '%';
      m.style.background = this.moodColor(c.mood);
      card.classList.toggle('sel', !!(Game.selected && Game.selected.c === c));
      card.classList.toggle('alert', c.hunger < 15 || c.energy < 10 || c.inBreak());
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
    p.dataset.kind = 't';
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
    if (World.struct[i]) rows.push(['Stavba', BUILD[World.struct[i].type].name + (World.struct[i].decon ? ' (k bourání)' : '')]);
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
    if (it) rows.push(['Předmět', `${ITEMS[it.type].name} ×${it.n}`]);
    if (World.zone[i]) rows.push(['Zóna', World.zone[i] === 1 ? 'Sklad' : 'Pole']);
    p.innerHTML = `<div class="phead"><div><div class="ptitle">Políčko ${x}, ${y}</div></div><button class="x" id="infoClose">✕</button></div>
      <table class="ttab">${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`;
    this.$('infoClose').onclick = () => Game.select(null);
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
        <li><b>Příkazy → Těžit</b> skálu (kámen) a železnou rudu (oranžové žilky) na lampy.</li>
      </ol>
      <p>Hlídej ukazatele <b>sytosti</b>, <b>energie</b> a <b>nálady</b>. Velmi nešťastný kolonista se může psychicky zhroutit a přestat pracovat.</p>
      </div><div class="menu"><button id="mBack">${first ? 'Začít hrát' : 'Zavřít'}</button></div></div>`;
    m.classList.remove('hidden');
    const close = () => m.classList.add('hidden');
    this.$('mClose').onclick = close;
    this.$('mBack').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
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
    this.$('weatherLabel').textContent = `${Weather.cur === 'clear' && d < 0.3 ? '✨' : wd.icon} ${wd.name}`;
    const counts = World.countItems();
    for (const k of ITEM_ORDER) this.$('res-' + k).textContent = counts[k];
    this.updateColonistBar();
    if (Game.selected) this.updateInfo(false);
  },
};
