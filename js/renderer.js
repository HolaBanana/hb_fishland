'use strict';
/**
 * Renderer – vykreslování mapy, objektů, kolonistů, osvětlení (den/noc) a počasí.
 * Kreslí se v pixelech zařízení se zaokrouhlením na společnou mřížku → bez švů mezi políčky.
 */
const Renderer = {
  init(cv) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.time = 0;
    this.rain = [];
    this.splash = [];
    this.clouds = [];
    for (let k = 0; k < 14; k++) {
      this.clouds.push({ x: Math.random() * World.w * 16, y: Math.random() * World.h * 16, r: 90 + Math.random() * 130, s: 0.6 + Math.random() * 0.6 });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.light.width = Math.ceil(this.cv.width / 4);
    this.light.height = Math.ceil(this.cv.height / 4);
    Camera.resize(w, h);
  },

  // --- převody světových pixelů na pixely zařízení ---
  X(wx) { return Math.round(this.ox + wx * this.z); },
  Y(wy) { return Math.round(this.oy + wy * this.z); },
  img(im, wx, wy, ww, wh) {
    const x0 = this.X(wx), y0 = this.Y(wy);
    this.ctx.drawImage(im, x0, y0, this.X(wx + ww) - x0, this.Y(wy + wh) - y0);
  },
  /** Obrázek otočený o dir×90° (vejde se do stejného obdélníku; u lichého směru se prohodí rozměry). */
  imgRot(im, wx, wy, ww, wh, dir) {
    this.img(dir ? this.rotated(im, dir) : im, wx, wy, ww, wh);
  },
  /** Sprite otočený o dir×90° – předpočítá se jednou a uloží (rotace při každém snímku je drahá). */
  rotCache: new WeakMap(),
  rotated(im, dir) {
    let r = this.rotCache.get(im);
    if (!r) { r = []; this.rotCache.set(im, r); }
    if (!r[dir]) {
      if (!dir) return im;
      const c = document.createElement('canvas');
      c.width = dir & 1 ? im.height : im.width; c.height = dir & 1 ? im.width : im.height;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.translate(c.width / 2, c.height / 2);
      g.rotate(dir * Math.PI / 2);
      g.drawImage(im, -im.width / 2, -im.height / 2);
      r[dir] = c;
    }
    return r[dir];
  },
  /** Rozměr stavby ve světových pixelech podle otočení. */
  sizeOf(type, dir) {
    const sz = BUILD[type].size, TS = Config.TILE;
    if (!sz) return [TS, TS];
    return dir & 1 ? [sz[1] * TS, sz[0] * TS] : [sz[0] * TS, sz[1] * TS];
  },
  /** Sprite stavby včetně otočení (pás podle směru, větší stavby o 90°). */
  buildSprite(type, wx, wy, dir) {
    const def = BUILD[type], [fw, fh] = this.sizeOf(type, dir);
    if (def.machine && def.machine.belt) {
      const frame = def.machine.kind ? -1 : (Game.speed > 0 ? Math.floor(this.time * 6) % 3 : 0);
      this.img(this.beltSprite(type, dir, frame), wx, wy, fw, fh);
    } else if (def.size) this.imgRot(Sprites.build[type], wx, wy, fw, fh, dir & 1);
    else this.img(Sprites.build[type], wx, wy, fw, fh);
    if (def.rot && def.machine && !def.machine.belt) this.imgRot(Sprites.arrow, wx + 4, wy + 4, 8, 8, dir);
  },
  rect(wx, wy, ww, wh, col) {
    const x0 = this.X(wx), y0 = this.Y(wy);
    this.ctx.fillStyle = col;
    this.ctx.fillRect(x0, y0, this.X(wx + ww) - x0, this.Y(wy + wh) - y0);
  },

  draw(dt) {
    const ctx = this.ctx, TS = Config.TILE;
    this.time += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);

    this.z = Camera.zoom * this.dpr;
    this.ox = Math.round(this.cv.width / 2 - Camera.x * this.z);
    this.oy = Math.round(this.cv.height / 2 - Camera.y * this.z);
    const tz = TS * this.z;
    const tx0 = Math.max(0, Math.floor(-this.ox / tz) - 1);
    const ty0 = Math.max(0, Math.floor(-this.oy / tz) - 1);
    const tx1 = Math.min(World.w - 1, Math.ceil((this.cv.width - this.ox) / tz));
    const ty1 = Math.min(World.h - 1, Math.ceil((this.cv.height - this.oy) / tz));
    this.view = { tx0, ty0, tx1, ty1 };

    // 1) terén
    const sx = tx0 * TS, sy = ty0 * TS, sw = (tx1 - tx0 + 1) * TS, sh = (ty1 - ty0 + 1) * TS;
    const dx0 = this.X(sx), dy0 = this.Y(sy);
    ctx.drawImage(Sprites.terrain, sx, sy, sw, sh, dx0, dy0, this.X(sx + sw) - dx0, this.Y(sy + sh) - dy0);

    // sněhová pokrývka (jen venku – podlahy a místnosti se kreslí přes ni)
    if (Weather.snow > 0.02) {
      ctx.fillStyle = `rgba(236,242,250,${Weather.snow * 0.5})`;
      ctx.fillRect(dx0, dy0, this.X(sx + sw) - dx0, this.Y(sy + sh) - dy0);
    }
    this.drawGround(tx0, ty0, tx1, ty1);
    this.drawRows(tx0, ty0, tx1, ty1);
    this.drawOverlays(tx0, ty0, tx1, ty1);
    this.drawClouds();
    this.drawLighting();
    this.drawWeather(dt);
    this.drawLabels();
    this.drawPreview();
  },

  // ---------- Vrstva země: vodní lesk, zóny, podlahy, pole, předměty ----------
  drawGround(tx0, ty0, tx1, ty1) {
    const ctx = this.ctx, TS = Config.TILE, W = World.w, t = this.time;
    const showGrid = Game.tool !== 'select';
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const i = y * W + x, wx = x * TS, wy = y * TS;
        const ter = World.terrain[i];
        if ((ter === T.WATER || ter === T.SHALLOW) && Camera.zoom > 1.4 && World.variant[i] % 3 === 0) {
          const h = U.hash2(x, y, 3);
          const a = Math.sin(t * 1.6 + h * 12);
          if (a > 0.6) this.rect(wx + 2 + h * 9, wy + 3 + (h * 37 % 9), 4, 1, `rgba(200,230,255,${(a - 0.6) * 0.8})`);
        }
        const z = World.zone[i];
        if (z === 2) {
          if (!World.crops[i]) this.rect(wx, wy, TS, TS, 'rgba(120,200,80,0.16)');
        } else if (z === 3) this.rect(wx, wy, TS, TS, 'rgba(200,230,140,0.13)');
        const fl = World.floor[i];
        if (fl) this.img(Sprites.build[fl.type], wx, wy, TS, TS);
        if (z === 1) this.rect(wx, wy, TS, TS, 'rgba(240,200,90,0.16)');
        const cr = World.crops[i];
        if (cr) {
          this.img(Sprites.tilled, wx, wy, TS, TS);
          const st = cr.g >= 1 ? 3 : cr.g > 0.6 ? 2 : cr.g > 0.25 ? 1 : 0;
          this.img(Sprites.crop[st], wx, wy, TS, TS);
        }
        const bp = World.bp[i];
        if (bp && BUILD[bp.type].layer === 'floor') this.drawBlueprint(bp, wx, wy);
        const st = World.struct[i];
        const sm = st && BUILD[st.type].machine;
        if (sm && (sm.belt || sm.rail || sm.stop)) {
          if (sm.belt) this.buildSprite(st.type, wx, wy, st.dir);
          else {
            // kolej se natočí podle sousedních kolejí
            const vert = (Carts.isTrack(i - W) || Carts.isTrack(i + W)) && !(Carts.isTrack(i - 1) || Carts.isTrack(i + 1));
            this.imgRot(Sprites.build[st.type], wx, wy, TS, TS, vert ? 1 : 0);
            if (sm.stop) this.rect(wx + 5, wy + 6, 6, 4, st.unload ? '#ff8a4c' : '#7ee07e');
          }
          if (sm.kind === 'sorter' && st.filter) this.img(Sprites.items[st.filter], wx + 4, wy + 4, 8, 8);
          if (st.decon) this.img(Sprites.des.decon, wx + 4, wy + 4, 8, 8);
        }
        if (showGrid) {
          this.rect(wx, wy, TS, 0.5 / Camera.zoom * 1.2, 'rgba(255,255,255,0.07)');
          this.rect(wx, wy, 0.5 / Camera.zoom * 1.2, TS, 'rgba(255,255,255,0.07)');
        }
      }
    }
    // vrstva znečištění
    if (Pollution.show) {
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const p = Pollution.grid[y * W + x];
        if (p > 0.02) this.rect(x * TS, y * TS, TS, TS, `rgba(150,60,170,${Math.min(0.75, p * 0.8)})`);
      }
    }
    // okraje zón
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const i = y * W + x, z = World.zone[i];
      if (!z) continue;
      const col = z === 1 ? 'rgba(250,210,100,0.75)' : z === 2 ? 'rgba(140,220,100,0.6)' : 'rgba(230,240,170,0.6)';
      const wx = x * TS, wy = y * TS, th = 1;
      if (y === 0 || World.zone[i - W] !== z) this.rect(wx, wy, TS, th, col);
      if (y === World.h - 1 || World.zone[i + W] !== z) this.rect(wx, wy + TS - th, TS, th, col);
      if (x === 0 || World.zone[i - 1] !== z) this.rect(wx, wy, th, TS, col);
      if (x === World.w - 1 || World.zone[i + 1] !== z) this.rect(wx + TS - th, wy, th, TS, col);
    }
    // předměty
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const fs = Math.round(U.clamp(5.5 * this.z, 9, 19 * this.dpr));
    ctx.font = `${fs}px VT323, monospace`;
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const it = World.items[y * W + x];
      if (!it) continue;
      let wx = x * TS, wy = y * TS;
      const bs = World.struct[y * W + x];
      if (bs && BUILD[bs.type].machine && BUILD[bs.type].machine.belt) {
        if (bs.type === 'tunnel') continue;   // pod zemí není vidět
        // hromádka na pásu plynule klouže ve směru pásu
        const ph = Game.speed > 0 ? (Game.tickCount % Config.BELT_PERIOD) / Config.BELT_PERIOD - 0.5 : 0;
        this.img(Sprites.items[it.type], wx + 3 + DIRS4[bs.dir][0] * ph * TS, wy + 2 + DIRS4[bs.dir][1] * ph * TS, 10, 10);
        continue;
      }
      if (bs && BUILD[bs.type].storage) continue;   // obsah truhly není vidět
      this.img(Sprites.items[it.type], wx + 1, wy, 14, 14);
      if (Camera.zoom >= 2.2) {
        const s = String(it.n);
        const px = this.X(wx + TS - 0.5), py = this.Y(wy + TS + 0.5);
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillText(s, px + 1, py + 1);
        ctx.fillStyle = '#fff';
        ctx.fillText(s, px, py);
      }
    }
  },

  drawBlueprint(bp, wx, wy) {
    const TS = Config.TILE, ctx = this.ctx;
    const [fw, fh] = this.sizeOf(bp.type, bp.dir || 0);
    ctx.globalAlpha = 0.45;
    this.buildSprite(bp.type, wx, wy, bp.dir || 0);
    ctx.globalAlpha = 1;
    this.rect(wx, wy, fw, fh, 'rgba(80,160,255,0.28)');
    const x0 = this.X(wx), y0 = this.Y(wy);
    ctx.strokeStyle = 'rgba(140,200,255,0.9)';
    ctx.lineWidth = Math.max(1, this.z * 0.6);
    ctx.setLineDash([this.z * 2, this.z * 2]);
    ctx.strokeRect(x0 + 1, y0 + 1, this.X(wx + fw) - x0 - 2, this.Y(wy + fh) - y0 - 2);
    ctx.setLineDash([]);
    // dodaný materiál
    const cost = BUILD[bp.type].cost;
    let tot = 0, del = 0;
    for (const m in cost) { tot += cost[m]; del += Math.min(cost[m], bp.del[m] || 0); }
    if (del < tot) {
      this.rect(wx + 2, wy + TS - 3, 12, 2, 'rgba(0,0,0,0.6)');
      this.rect(wx + 2, wy + TS - 3, 12 * del / tot, 2, '#8fd0ff');
    }
  },

  // ---------- Řádkové vykreslení (správné překrývání stromů, zdí, kolonistů) ----------
  // ---------- Mezipaměť přírodních objektů (stromy, keře, skály) ----------
  // Při oddálení se kreslí po blocích 16×16 políček předkreslených do plátna;
  // blok se překreslí jen po změně (pokácení, vytěžení, růst stromu, bobule).
  CHUNK: 16,
  CHUNK_MAX: 140,
  chunks: new Map(),
  clearChunks() { this.chunks = new Map(); },
  dirtyTile(i) {
    const C = this.CHUNK, x = i % World.w, y = (i / World.w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = Math.floor((x + dx) / C), cy = Math.floor((y + dy) / C);
      const c = this.chunks.get(cx + ',' + cy);
      if (c) c.dirty = true;
    }
  },
  chunkCanvas(cx, cy, k) {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (c && c.k === k && !c.dirty) { this.chunks.delete(key); this.chunks.set(key, c); return c; }
    const TS = Config.TILE, C = this.CHUNK, mx = 4, mt = 16, mb = 4;
    const ww = C * TS + mx * 2, wh = C * TS + mt + mb;
    if (!c || c.k !== k) {
      c = { cv: document.createElement('canvas'), k, wx: cx * C * TS - mx, wy: cy * C * TS - mt, ww, wh };
      c.cv.width = Math.ceil(ww * k); c.cv.height = Math.ceil(wh * k);
    }
    const g = c.cv.getContext('2d');
    g.clearRect(0, 0, c.cv.width, c.cv.height);
    g.imageSmoothingEnabled = false;
    // vykreslit objekty bloku přes běžné kreslicí funkce do plátna bloku
    const save = [this.ctx, this.ox, this.oy, this.z];
    this.ctx = g; this.z = k; this.ox = -c.wx * k; this.oy = -c.wy * k;
    const W = World.w;
    for (let y = cy * C; y < Math.min(World.h, (cy + 1) * C); y++) for (let x = cx * C; x < Math.min(World.w, (cx + 1) * C); x++) {
      const o = World.obj[y * W + x];
      if (o) this.drawObj(o, y * W + x, x, y, x * TS, y * TS);
    }
    [this.ctx, this.ox, this.oy, this.z] = save;
    c.dirty = false;
    this.chunks.delete(key); this.chunks.set(key, c);
    while (this.chunks.size > this.CHUNK_MAX) this.chunks.delete(this.chunks.keys().next().value);
    return c;
  },
  drawChunks(tx0, ty0, tx1, ty1) {
    const C = this.CHUNK, k = this.z >= 1 ? 1 : 0.5;
    const cy0 = Math.floor(ty0 / C), cy1 = Math.floor(Math.min(World.h - 1, ty1 + 1) / C);
    const cx0 = Math.floor(tx0 / C), cx1 = Math.floor(tx1 / C);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.chunkCanvas(cx, cy, k);
      const x0 = this.X(c.wx), y0 = this.Y(c.wy);
      this.ctx.drawImage(c.cv, x0, y0, this.X(c.wx + c.ww) - x0, this.Y(c.wy + c.wh) - y0);
    }
  },

  drawRows(tx0, ty0, tx1, ty1) {
    const TS = Config.TILE, W = World.w;
    // oddáleno: přírodní objekty z mezipaměti, pořadí s kolonisty není při malém měřítku poznat
    const cached = Camera.zoom < 2.2;
    if (cached) this.drawChunks(tx0, ty0, tx1, ty1);
    const byRow = new Map();
    for (const c of Game.colonists) {
      const r = Math.floor(c.y);
      if (!byRow.has(r)) byRow.set(r, []);
      byRow.get(r).push(c);
    }
    const yEnd = Math.min(World.h - 1, ty1 + 2);
    for (let y = ty0; y <= yEnd; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const i = y * W + x, wx = x * TS, wy = y * TS;
        const o = World.obj[i];
        if (o && !cached) this.drawObj(o, i, x, y, wx, wy);
        const s = World.struct[i];
        if (s && s.i === i && !(BUILD[s.type].machine && (BUILD[s.type].machine.belt || BUILD[s.type].machine.rail || BUILD[s.type].machine.stop))) this.drawStruct(s, i, x, y, wx, wy);
        const bp = World.bp[i];
        if (bp && bp.i === i && BUILD[bp.type].layer === 'struct') this.drawBlueprint(bp, wx, wy);
      }
      for (const c of Carts.list) if (Math.floor(c.y) === y) {
        this.img(Sprites.cart, c.x * TS - 7, c.y * TS - 7, 14, 12);
        if (c.cargo) this.img(Sprites.items[c.cargo.type], c.x * TS - 4, c.y * TS - 10, 8, 8);
      }
      for (const a of Animals.list) if (Math.floor(a.y) === y) this.drawAnimal(a);
      for (const r of Combat.raiders) if (Math.floor(r.y) === y) this.drawRaider(r);
      const cs = byRow.get(y);
      if (cs) { cs.sort((a, b) => a.y - b.y); for (const c of cs) this.drawColonist(c); }
    }
    // stopy výstřelů
    if (Game.shots.length) {
      const ctx = this.ctx;
      ctx.lineWidth = Math.max(1, this.z * 0.6);
      for (const s of Game.shots) {
        ctx.strokeStyle = s.col || '#fff';
        ctx.globalAlpha = Math.min(1, s.t / 5);
        ctx.beginPath(); ctx.moveTo(this.X(s.x0 * TS), this.Y(s.y0 * TS)); ctx.lineTo(this.X(s.x1 * TS), this.Y(s.y1 * TS)); ctx.stroke();
        s.t--;
      }
      ctx.globalAlpha = 1;
      Game.shots = Game.shots.filter(s => s.t > 0);
    }
    // plameny požárů
    for (const i of Fire.tiles.keys()) {
      const x = i % W, y = (i / W) | 0;
      if (x < tx0 || x > tx1 || y < ty0 || y > ty1) continue;
      this.drawFlame(x * TS + 5, y * TS + 12); this.drawFlame(x * TS + 11, y * TS + 9); this.drawFlame(x * TS + 8, y * TS + 14);
    }
  },

  drawRaider(r) {
    const TS = Config.TILE, ctx = this.ctx, wx = r.x * TS, wy = r.y * TS;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(this.X(wx), this.Y(wy + 4), 5 * this.z, 2 * this.z, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = Math.max(1, this.z * 0.5);
    ctx.beginPath(); ctx.ellipse(this.X(wx), this.Y(wy + 4), 6.5 * this.z, 2.8 * this.z, 0, 0, Math.PI * 2); ctx.stroke();
    const spr = Sprites.raider();
    const frame = r.moving ? 1 + (Math.floor(r.animT * 3.2) % 2) : (r.cd > 30 ? 1 : 0);
    this.img(spr[r.dir][frame], wx - 8, wy - 12, 16, 16);
    if (r.hp < r.maxHp) {
      this.rect(wx - 6, wy - 15, 12, 2, 'rgba(0,0,0,0.65)');
      this.rect(wx - 6, wy - 15, 12 * Math.max(0, r.hp / r.maxHp), 2, '#ff5a4a');
    }
  },
  drawAnimal(a) {
    const TS = Config.TILE, ctx = this.ctx;
    const spr = Sprites.animals[a.type];
    if (!spr) return;
    const wx = a.x * TS, wy = a.y * TS;
    const moving = a.path && a.pathI < a.path.length;
    const f = moving ? Math.floor(a.animT * 4) % 2 : (a.state === 'eat' && Math.sin(this.time * 6) > 0 ? 1 : 0);
    const im = spr[a.dir === 'right' ? 'right' : 'left'][f];
    const w = im.width, h = im.height;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(this.X(wx), this.Y(wy + 4), w * 0.38 * this.z, 1.8 * this.z, 0, 0, Math.PI * 2);
    ctx.fill();
    this.img(im, wx - w / 2, wy + 5 - h, w, h);
    if (a.hunt) this.img(Sprites.icons.hunt, wx - 4, wy - h - 4, 8, 8);
    else if (a.type === 'sheep' && a.prod >= 1) this.rect(wx - 1, wy - h + 2, 2, 2, '#ffd35a');
    if (Game.selected && Game.selected.a === a) {
      ctx.strokeStyle = '#ffe36e'; ctx.lineWidth = Math.max(1.5, this.z * 0.7);
      ctx.beginPath(); ctx.ellipse(this.X(wx), this.Y(wy + 4), (w * 0.5 + 1) * this.z, 3 * this.z, 0, 0, Math.PI * 2); ctx.stroke();
    }
  },

  drawObj(o, i, x, y, wx, wy) {
    const TS = Config.TILE, v = World.variant[i];
    if (o.type === 'tree') {
      const spr = Sprites.trees[v % Sprites.trees.length];
      const sc = o.size;
      const w = 20 * sc, h = 28 * sc;
      // lehké pohupování ve větru
      this.img(spr, wx + 8 - w / 2, wy + TS + 2 - h, w, h);
    } else if (o.type === 'bush') {
      this.img(o.berries ? Sprites.bush : Sprites.bushEmpty, wx, wy, TS, TS);
    } else {
      const arr = o.type === 'ore' ? Sprites.ores : Sprites.rocks;
      this.img(arr[v % arr.length], wx, wy, TS, TS);
      const isRock = (xx, yy) => { if (!World.inb(xx, yy)) return true; const q = World.obj[yy * World.w + xx]; return !!q && (q.type === 'rock' || q.type === 'ore'); };
      if (!isRock(x, y - 1)) { this.rect(wx, wy, TS, 2, 'rgba(200,196,188,0.55)'); }
      if (!isRock(x, y + 1)) { this.rect(wx, wy + TS - 4, TS, 4, 'rgba(40,36,34,0.55)'); this.rect(wx, wy + TS, TS, 3, 'rgba(0,0,0,0.25)'); }
      if (!isRock(x - 1, y)) this.rect(wx, wy, 1.5, TS, 'rgba(60,56,52,0.6)');
      if (!isRock(x + 1, y)) this.rect(wx + TS - 1.5, wy, 1.5, TS, 'rgba(40,36,34,0.6)');
    }
  },

  drawStruct(s, i, x, y, wx, wy) {
    const TS = Config.TILE, def = BUILD[s.type];
    if (def.wall) {
      const isWall = (xx, yy) => { if (!World.inb(xx, yy)) return false; const q = World.struct[yy * World.w + xx]; return !!q && (BUILD[q.type].wall || BUILD[q.type].door); };
      const mask = (isWall(x, y - 1) ? 1 : 0) | (isWall(x + 1, y) ? 2 : 0) | (isWall(x, y + 1) ? 4 : 0) | (isWall(x - 1, y) ? 8 : 0);
      this.img(this.wallSprite(s.type, mask), wx, wy, TS, TS + 3);
    } else if (def.door) {
      const open = Game.colonists.some(c => Math.abs(c.x - (x + 0.5)) < 1 && Math.abs(c.y - (y + 0.5)) < 1);
      this.img(open ? Sprites.build.door_open : Sprites.build[s.type], wx, wy, TS, TS);
    } else if (s.type === 'campfire') {
      this.img(Sprites.build.campfire, wx, wy, TS, TS);
      this.drawFlame(wx + 8, wy + 9);
    } else if (def.machine) {
      this.drawMachine(s, def, wx, wy);
    } else {
      this.img(Sprites.build[s.type], wx, wy, TS, TS);
    }
    if (s.decon) this.img(Sprites.des.decon, wx + 4, wy + 4, 8, 8);
  },

  /** Dílny, stroje a zdroje energie: animace chodu, šipka výstupu, stavové ikony. */
  drawMachine(s, def, wx, wy) {
    const m = def.machine, ctx = this.ctx, t = this.time;
    const run = Game.speed > 0;
    const active = run && (s.on || (s.used !== undefined && Game.tickCount - s.used < 6));
    const shake = active && (m.recipe || m.drill) && Math.sin(t * 45) > 0 ? 0.5 : 0;
    this.buildSprite(s.type, wx, wy + shake, s.dir);
    const [fw, fh] = this.sizeOf(s.type, s.dir);
    if (m.gen === 'water') {
      // lopatky kola
      const out = Power.output(s) > 0 && run;
      const a0 = out ? t * 1.6 : 0.3;
      for (let k = 0; k < 8; k++) {
        const a = a0 + k * Math.PI / 4;
        const px = wx + 8 + Math.cos(a) * 6, py = wy + 7 + Math.sin(a) * 6;
        this.rect(px - 1.2, py - 1.2, 2.4, 2.4, k & 1 ? '#b98a56' : '#8a5a30');
        this.rect(wx + 8 + Math.cos(a) * 3 - 0.5, wy + 7 + Math.sin(a) * 3 - 0.5, 1, 1, '#6e4626');
      }
      this.rect(wx + 7, wy + 6, 2, 2, '#3c3e46');
    } else if (m.gen === 'wind') {
      const sp = run ? Power.output(s) / m.supply : 0;
      s.spin = (s.spin || 0) + sp * 0.12;
      const cx = this.X(wx + 16), cy = this.Y(wy + 10), L = 14 * this.z;
      ctx.lineCap = 'butt';
      for (let k = 0; k < 4; k++) {
        const a = s.spin + k * Math.PI / 2;
        ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 3.2 * this.z;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 2 * this.z, cy + Math.sin(a) * 2 * this.z); ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); ctx.stroke();
        ctx.strokeStyle = '#6e4626'; ctx.lineWidth = 0.9 * this.z;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); ctx.stroke();
      }
      this.rect(wx + 15, wy + 9, 2, 2, '#3c3e46');
    }
    // kouř z komínů
    if (active && (s.type === 'furnace' || s.type === 'autofurnace' || s.type === 'boiler')) {
      const cx = s.type === 'boiler' ? wx + 23 : wx + 8;
      for (let k = 0; k < 4; k++) {
        const p = (t * 0.5 + k / 4) % 1;
        this.rect(cx + Math.sin(k * 3 + t) * 2 + p * 4, wy - 2 - p * 14, 2 + p * 2, 2 + p * 2, `rgba(90,90,96,${0.5 * (1 - p)})`);
      }
    }
    // postup výroby
    if (s.prog > 0 && (m.recipe || m.drill) && (active || s.prog < 1)) {
      this.rect(wx + 2, wy + fh - 3, fw - 4, 2, 'rgba(0,0,0,0.6)');
      this.rect(wx + 2, wy + fh - 3, (fw - 4) * U.clamp(s.prog, 0, 1), 2, '#7ee07e');
    }
    if (m.turret && s.aim !== undefined) {
      // hlaveň míří na poslední cíl
      const cx = wx + 8, cy = wy + 6.5;
      for (let k = 2; k < 8; k++) this.rect(cx + Math.cos(s.aim) * k - 0.8, cy + Math.sin(s.aim) * k - 0.8, 1.6, 1.6, '#3c3e46');
    }
    // poškození nájezdníky
    if (s.hp !== undefined && s.hp < Combat.hpOf(s)) {
      this.rect(wx + 2, wy + 1, fw - 4, 1.5, 'rgba(0,0,0,0.6)');
      this.rect(wx + 2, wy + 1, (fw - 4) * Math.max(0, s.hp / Combat.hpOf(s)), 1.5, '#ff8a4c');
    }
    // stavové ikony
    let icon = null, col = '#ff6b5e';
    if (s.broken) icon = '🔧';
    else if (m.power && s.want && !s.on) icon = '⚡';
    else if (m.gen === 'boiler' && !(s.burn > 0) && !(s.inv.wood >= 1)) { icon = '!'; col = '#ffb347'; }
    else if (m.turret && !(s.inv.ammo >= 1)) { icon = '!'; col = '#ffb347'; }
    if (icon && Math.sin(t * 5) > -0.3) this.img(this.iconSprite(icon, col), wx + fw / 2 - 5, wy + fh / 2 - 7, 10, 10);
  },
  /** Stavová ikona stroje předkreslená do obrázku (text na plátně je drahý). */
  iconCache: {},
  iconSprite(icon, col) {
    const key = icon + col;
    if (this.iconCache[key]) return this.iconCache[key];
    const c = document.createElement('canvas'), S = 40;
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, 0, S, S);
    g.font = `bold ${S - 4}px VT323, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = col; g.fillText(icon, S / 2, S / 2 + 1);
    return (this.iconCache[key] = c);
  },

  /** Zeď se stíny a světly podle sousedních zdí – 16 variant na materiál, předkreslené. */
  wallCache: {},
  wallSprite(type, mask) {
    const key = type + mask;
    if (this.wallCache[key]) return this.wallCache[key];
    const c = document.createElement('canvas');
    c.width = 16; c.height = 19;
    const g = c.getContext('2d');
    g.drawImage(Sprites.build[type], 0, 0);
    const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    if (!(mask & 4)) { r(0, 12, 16, 4, 'rgba(0,0,0,0.35)'); r(0, 16, 16, 3, 'rgba(0,0,0,0.22)'); }
    if (!(mask & 1)) r(0, 0, 16, 1.5, 'rgba(255,255,255,0.25)');
    if (!(mask & 8)) r(0, 0, 1, 16, 'rgba(0,0,0,0.3)');
    if (!(mask & 2)) r(15, 0, 1, 16, 'rgba(0,0,0,0.3)');
    return (this.wallCache[key] = c);
  },
  /** Pás se šipkou v jedné fázi animace a jednom směru – předkreslené. */
  beltCache: {},
  beltSprite(type, dir, frame) {
    const key = type + dir + '_' + frame;
    if (this.beltCache[key]) return this.beltCache[key];
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const g = c.getContext('2d');
    g.drawImage(this.rotated(Sprites.build[type], dir) || Sprites.build[type], 0, 0);
    if (frame >= 0) g.drawImage(dir ? this.rotated(Sprites.beltArrow[frame], dir) : Sprites.beltArrow[frame], 0, 0);
    return (this.beltCache[key] = c);
  },

  drawFlame(cx, cy) {
    const t = this.time * 9;
    const cols = ['#ff5a1f', '#ff9a2e', '#ffd257', '#fff3b0'];
    for (let k = 0; k < 7; k++) {
      const off = (k - 3) * 1.1;
      const hgt = 3 + Math.abs(Math.sin(t * 0.7 + k * 1.7)) * 4 * (1 - Math.abs(k - 3) / 4.5);
      this.rect(cx + off - 0.5, cy - hgt, 1.2, hgt, cols[0]);
      this.rect(cx + off * 0.7 - 0.5, cy - hgt * 0.7, 1, hgt * 0.7, cols[1]);
      if (Math.abs(k - 3) < 2) this.rect(cx + off * 0.5 - 0.5, cy - hgt * 0.45, 1, hgt * 0.45, cols[2]);
    }
    this.rect(cx - 0.5, cy - 2, 1, 1.5, cols[3]);
    // jiskry
    for (let k = 0; k < 3; k++) {
      const p = (this.time * 0.8 + k / 3) % 1;
      this.rect(cx + Math.sin(k * 5 + this.time * 3) * 3, cy - 6 - p * 12, 0.8, 0.8, `rgba(255,200,90,${1 - p})`);
    }
  },

  drawColonist(c) {
    const TS = Config.TILE, ctx = this.ctx;
    const wx = c.x * TS, wy = c.y * TS;
    const sel = Game.selected && Game.selected.c === c;
    // stín
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(this.X(wx), this.Y(wy + 4), 5 * this.z, 2 * this.z, 0, 0, Math.PI * 2);
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = '#ffe36e';
      ctx.lineWidth = Math.max(1.5, this.z * 0.7);
      ctx.beginPath();
      ctx.ellipse(this.X(wx), this.Y(wy + 4), 7 * this.z, 3.2 * this.z, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (c.sleeping) {
      const x0 = this.X(wx), y0 = this.Y(wy + 1);
      ctx.save();
      ctx.translate(x0, y0);
      ctx.rotate(-Math.PI / 2);
      const s = Math.round(16 * this.z);
      ctx.drawImage(c.sprites.down[0], -s / 2, -s / 2, s, s);
      ctx.restore();
      // blanket na posteli
      const i = World.idx(c.tx, c.ty);
      if (World.struct[i] && World.struct[i].type === 'bed') this.rect(c.tx * TS + 2, c.ty * TS + 7, 12, 8, 'rgba(62,98,168,0.95)');
      const p = (this.time * 0.6) % 1;
      ctx.fillStyle = `rgba(255,255,255,${1 - p})`;
      ctx.font = `${Math.round(5 * this.z)}px VT323, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('z', this.X(wx + 3 + p * 4), this.Y(wy - 6 - p * 8));
      ctx.fillText('Z', this.X(wx + 6 + p * 5), this.Y(wy - 11 - p * 9));
      return;
    }
    let frame = 0, bob = 0;
    if (c.moving) { frame = 1 + (Math.floor(c.animT * 3.2) % 2); bob = frame === 1 ? -0.5 : 0; }
    const working = c.working && !c.moving;
    if (working) bob = Math.sin(this.time * 14) > 0 ? -0.6 : 0;
    this.img(c.sprites[c.dir][frame], wx - 8, wy - 12 + bob, 16, 16);
    if (working) {
      const sw = Math.sin(this.time * 14);
      const hx = c.dir === 'left' ? wx - 7 : c.dir === 'right' ? wx + 4 : wx + 3;
      this.rect(hx, wy - 5 - sw * 2, 1.2, 4, '#8a5a30');
      this.rect(hx - 1, wy - 6 - sw * 2, 3, 1.5, '#c9ccd4');
    }
    if (c.carry) this.img(Sprites.items[c.carry.type], wx - 4, wy - 17, 8, 8);
    if (c.workFrac >= 0 && (c.working || c.eating)) {
      this.rect(wx - 7, wy - 16 - (c.carry ? 6 : 0), 14, 2.2, 'rgba(0,0,0,0.65)');
      this.rect(wx - 6.5, wy - 15.6 - (c.carry ? 6 : 0), 13 * U.clamp(c.workFrac, 0, 1), 1.4, c.eating ? '#ffb347' : '#7ee07e');
    }
    if (c.inBreak()) {
      ctx.fillStyle = '#ff6060';
      ctx.font = `bold ${Math.round(7 * this.z)}px VT323, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('!', this.X(wx), this.Y(wy - 15));
    }
  },

  // ---------- Označení, výběr ----------
  drawOverlays(tx0, ty0, tx1, ty1) {
    const TS = Config.TILE;
    for (const i of World.desSet) {
      const x = i % World.w, y = (i / World.w) | 0;
      if (x < tx0 || x > tx1 || y < ty0 || y > ty1) continue;
      const o = World.obj[i];
      if (!o || !o.des) continue;
      const wx = x * TS, wy = y * TS;
      if (o.des === 'harvest' && !o.berries) { this.ctx.globalAlpha = 0.4; }
      this.rect(wx + 4, wy + 4, 8, 8, 'rgba(0,0,0,0.35)');
      this.img(Sprites.des[o.des], wx + 3.5, wy + 3.5, 9, 9);
      this.ctx.globalAlpha = 1;
    }
    for (const i of World.deconSet) {
      const x = i % World.w, y = (i / World.w) | 0;
      if (World.floor[i] && World.floor[i].decon && !World.struct[i]) this.img(Sprites.des.decon, x * TS + 4, y * TS + 4, 8, 8);
    }
    const s = Game.selected;
    if (s && s.type === 'tile') {
      const ctx = this.ctx, x0 = this.X(s.x * TS), y0 = this.Y(s.y * TS);
      ctx.strokeStyle = '#ffe36e';
      ctx.lineWidth = Math.max(2, this.z * 0.8);
      ctx.strokeRect(x0, y0, this.X((s.x + 1) * TS) - x0, this.Y((s.y + 1) * TS) - y0);
    }
  },

  // ---------- Náhled tažení nástroje ----------
  drawPreview() {
    const tool = Game.tool;
    if (tool === 'select') return;
    const d = Tools.defs[tool];
    let tiles = null;
    // tažený výběr, nebo výběr čekající na potvrzení
    const sel = Input.drag || (Game.pending && Game.pending.tool === tool ? Game.pending : null);
    if (sel) tiles = Tools.tilesFor(tool, sel.x0, sel.y0, sel.x1, sel.y1);
    else if (Input.hover && World.inb(Input.hover.x, Input.hover.y)) tiles = [World.idx(Input.hover.x, Input.hover.y)];
    if (!tiles) return;
    const TS = Config.TILE, ctx = this.ctx;
    let ok = 0;
    const dir = sel ? (sel.dir !== undefined ? sel.dir : Tools.dirFor(tool, sel.x0, sel.y0, sel.x1, sel.y1)) : Game.buildDir;
    for (const i of tiles) {
      const x = i % World.w, y = (i / World.w) | 0, wx = x * TS, wy = y * TS;
      const valid = d.valid(i, dir);
      if (valid) ok++;
      let fw = TS, fh = TS;
      if (d.build) {
        [fw, fh] = this.sizeOf(d.build, dir);
        if (valid) {
          ctx.globalAlpha = 0.6;
          this.buildSprite(d.build, wx, wy, dir);
          ctx.globalAlpha = 1;
        }
      }
      this.rect(wx, wy, fw, fh, valid ? 'rgba(120,230,140,0.30)' : 'rgba(255,80,80,0.25)');
    }
    if (sel) {
      const dr = sel;
      const ax = Math.min(dr.x0, dr.x1), ay = Math.min(dr.y0, dr.y1), bx = Math.max(dr.x0, dr.x1), by = Math.max(dr.y0, dr.y1);
      const x0 = this.X(ax * TS), y0 = this.Y(ay * TS);
      ctx.strokeStyle = Input.drag ? 'rgba(255,255,255,0.85)' : '#ffd35a';
      ctx.lineWidth = 2 * this.dpr;
      ctx.strokeRect(x0, y0, this.X((bx + 1) * TS) - x0, this.Y((by + 1) * TS) - y0);
      const label = `${bx - ax + 1}×${by - ay + 1}  ✔ ${ok}` + (d.build ? `  (${Tools.costText(tool, ok)})` : '');
      ctx.font = `${Math.round(18 * this.dpr)}px VT323, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(20,16,12,0.85)';
      ctx.fillRect(x0, y0 - 22 * this.dpr, tw + 10 * this.dpr, 20 * this.dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x0 + 5 * this.dpr, y0 - 4 * this.dpr);
    }
  },

  // ---------- Stíny mraků ----------
  drawClouds() {
    const a = Weather.cloud * 0.16;
    if (a < 0.01) return;
    const ctx = this.ctx, mw = World.w * 16, mh = World.h * 16;
    for (const c of this.clouds) {
      c.x += Weather.wind * c.s * 0.25 * Game.speed;
      c.y += 0.05 * c.s * Game.speed;
      if (c.x > mw + c.r) c.x = -c.r; if (c.x < -c.r) c.x = mw + c.r;
      if (c.y > mh + c.r) c.y = -c.r;
      const x = this.X(c.x), y = this.Y(c.y), r = c.r * this.z;
      if (x + r < 0 || y + r < 0 || x - r > this.cv.width || y - r > this.cv.height) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(10,14,30,${a})`);
      g.addColorStop(1, 'rgba(10,14,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  },

  // ---------- Den a noc ----------
  lightSources() {
    const out = [];
    for (const i of World.lights) {
      const s = World.struct[i];
      const def = s && BUILD[s.type];
      if (def && def.light) out.push({ x: (i % World.w) + 0.5, y: ((i / World.w) | 0) + 0.5, r: def.light, fire: s.type === 'campfire' });
    }
    for (const i of Fire.tiles.keys()) out.push({ x: (i % World.w) + 0.5, y: ((i / World.w) | 0) + 0.5, r: 4.5, fire: true });
    return out;
  },
  drawLighting() {
    const ctx = this.ctx, W = this.cv.width, Hh = this.cv.height;
    const day = TimeSys.daylight();
    const dark = U.clamp((1 - day) * 0.87 + Weather.cloud * 0.1 + Weather.rain * 0.08, 0, 0.88);
    const dusk = TimeSys.dusk();
    if (dusk > 0.01) {
      ctx.fillStyle = `rgba(255,120,40,${0.13 * dusk})`;
      ctx.fillRect(0, 0, W, Hh);
    }
    if (dark < 0.02) return;
    const L = this.lctx, lw = this.light.width, lh = this.light.height, k = lw / W;
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, lw, lh);
    L.fillStyle = `rgba(6,10,32,${dark})`;
    L.fillRect(0, 0, lw, lh);
    L.globalCompositeOperation = 'destination-out';
    const TS = Config.TILE;
    const lights = this.lightSources();
    for (const l of lights) {
      const flick = l.fire ? 1 + Math.sin(this.time * 7 + l.x) * 0.04 + Math.sin(this.time * 13) * 0.03 : 1;
      const x = this.X(l.x * TS) * k, y = this.Y(l.y * TS) * k, r = l.r * TS * this.z * k * flick;
      const g = L.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = g;
      L.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (const c of Game.colonists) {
      const x = this.X(c.x * TS) * k, y = this.Y(c.y * TS) * k, r = 2.2 * TS * this.z * k;
      const g = L.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      L.fillStyle = g;
      L.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.light, 0, 0, W, Hh);
    ctx.imageSmoothingEnabled = false;
    // teplá záře ohně
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const x = this.X(l.x * TS), y = this.Y(l.y * TS), r = l.r * 0.8 * TS * this.z;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = (l.fire ? 0.28 : 0.18) * dark;
      g.addColorStop(0, l.fire ? `rgba(255,150,50,${a})` : `rgba(255,220,140,${a})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  // ---------- Počasí ----------
  drawWeather(dt) {
    const ctx = this.ctx, W = this.cv.width, Hh = this.cv.height;
    const simDt = dt * Math.max(Game.speed, 0.05);
    const want = Math.floor(Weather.rain * (W * Hh) / (this.dpr * this.dpr) / 2600);
    while (this.rain.length < want) this.rain.push(this.newDrop(true));
    if (this.rain.length > want) this.rain.length = want;
    const snowing = TimeSys.temp() < 0;
    if (this.rain.length && snowing) {
      // sníh: pomalé bílé vločky
      ctx.fillStyle = 'rgba(245,248,255,0.85)';
      const sz = Math.max(2, 2 * this.dpr);
      for (const d of this.rain) {
        d.y += d.v * 0.16 * simDt * this.dpr;
        d.x += (Weather.wind * 60 + Math.sin(d.y * 0.02 + d.l) * 20) * simDt * this.dpr;
        if (d.y > this.cv.height + 10) { Object.assign(d, this.newDrop(false)); }
        ctx.fillRect(d.x, d.y, sz, sz);
      }
    } else if (this.rain.length) {
      const wind = Weather.wind * 0.35;
      ctx.strokeStyle = 'rgba(180,200,240,0.5)';
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.beginPath();
      for (const d of this.rain) {
        d.y += d.v * simDt * this.dpr;
        d.x += d.v * wind * simDt * this.dpr;
        if (d.y > d.end) {
          if (this.splash.length < 200) this.splash.push({ x: d.x, y: d.y, t: 0 });
          Object.assign(d, this.newDrop(false));
        }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.l * wind, d.y - d.l);
      }
      ctx.stroke();
    }
    if (this.splash.length) {
      ctx.fillStyle = 'rgba(200,220,255,0.55)';
      for (const s of this.splash) {
        s.t += simDt * 6;
        const r = s.t * 3 * this.dpr;
        ctx.fillRect(s.x - r, s.y, 1 * this.dpr, 1 * this.dpr);
        ctx.fillRect(s.x + r, s.y, 1 * this.dpr, 1 * this.dpr);
      }
      this.splash = this.splash.filter(s => s.t < 1);
    }
    if (Weather.rain > 0.05) {
      ctx.fillStyle = `rgba(60,70,90,${Weather.rain * 0.12})`;
      ctx.fillRect(0, 0, W, Hh);
    }
    if (Weather.fog > 0.02) {
      ctx.fillStyle = `rgba(200,206,214,${Weather.fog * 0.28})`;
      ctx.fillRect(0, 0, W, Hh);
      for (let k = 0; k < 5; k++) {
        const x = ((this.time * 12 * (k + 1) + k * 400) % (W + 800)) - 400, y = (Hh / 5) * k + Hh / 10;
        const r = 380 * this.dpr;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(220,226,232,${Weather.fog * 0.25})`);
        g.addColorStop(1, 'rgba(220,226,232,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    if (Weather.flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${Weather.flash * 0.55})`;
      ctx.fillRect(0, 0, W, Hh);
    }
  },
  newDrop(anyY) {
    const W = this.cv.width, Hh = this.cv.height;
    const y = anyY ? Math.random() * Hh : -20;
    const R = Math.random;   // vykreslování nesmí spotřebovávat herní náhodu
    return { x: R() * (W + 200) - 100, y, v: 700 + R() * 300, l: (8 + R() * 6) * this.dpr, end: y + 80 + R() * (Hh - 80) };
  },

  // ---------- Jmenovky ----------
  drawLabels() {
    const ctx = this.ctx, TS = Config.TILE;
    const show = Camera.zoom >= 1.7;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(15 * this.dpr)}px VT323, monospace`;
    for (const c of Game.colonists) {
      const sel = Game.selected && Game.selected.c === c;
      if (!show && !sel) continue;
      const x = this.X(c.x * TS), y = this.Y(c.y * TS + 5);
      const t = c.first;
      const w = ctx.measureText(t).width + 8 * this.dpr;
      ctx.fillStyle = sel ? 'rgba(80,60,10,0.85)' : 'rgba(15,12,10,0.65)';
      ctx.fillRect(x - w / 2, y, w, 15 * this.dpr);
      ctx.fillStyle = sel ? '#ffe36e' : '#f0e8d8';
      ctx.fillText(t, x, y + 1 * this.dpr);
    }
  },
};
