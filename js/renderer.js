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
      this.clouds.push({ x: U.rand() * World.w * 16, y: U.rand() * World.h * 16, r: U.range(90, 220), s: U.range(0.6, 1.2) });
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
        if ((ter === T.WATER || ter === T.SHALLOW) && Camera.zoom > 1.4) {
          const h = U.hash2(x, y, 3);
          const a = Math.sin(t * 1.6 + h * 12);
          if (a > 0.6) this.rect(wx + 2 + h * 9, wy + 3 + (h * 37 % 9), 4, 1, `rgba(200,230,255,${(a - 0.6) * 0.8})`);
        }
        const z = World.zone[i];
        if (z === 2) {
          if (!World.crops[i]) this.rect(wx, wy, TS, TS, 'rgba(120,200,80,0.16)');
        }
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
        if (showGrid) {
          this.rect(wx, wy, TS, 0.5 / Camera.zoom * 1.2, 'rgba(255,255,255,0.07)');
          this.rect(wx, wy, 0.5 / Camera.zoom * 1.2, TS, 'rgba(255,255,255,0.07)');
        }
      }
    }
    // okraje zón
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const i = y * W + x, z = World.zone[i];
      if (!z) continue;
      const col = z === 1 ? 'rgba(250,210,100,0.75)' : 'rgba(140,220,100,0.6)';
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
      const wx = x * TS, wy = y * TS;
      this.img(Sprites.items[it.type], wx + 1, wy, 14, 14);
      if (Camera.zoom >= 1.6) {
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
    ctx.globalAlpha = 0.45;
    this.img(Sprites.build[bp.type], wx, wy, TS, TS);
    ctx.globalAlpha = 1;
    this.rect(wx, wy, TS, TS, 'rgba(80,160,255,0.28)');
    const x0 = this.X(wx), y0 = this.Y(wy);
    ctx.strokeStyle = 'rgba(140,200,255,0.9)';
    ctx.lineWidth = Math.max(1, this.z * 0.6);
    ctx.setLineDash([this.z * 2, this.z * 2]);
    ctx.strokeRect(x0 + 1, y0 + 1, this.X(wx + TS) - x0 - 2, this.Y(wy + TS) - y0 - 2);
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
  drawRows(tx0, ty0, tx1, ty1) {
    const TS = Config.TILE, W = World.w;
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
        if (o) this.drawObj(o, i, x, y, wx, wy);
        const s = World.struct[i];
        if (s) this.drawStruct(s, i, x, y, wx, wy);
        const bp = World.bp[i];
        if (bp && BUILD[bp.type].layer === 'struct') this.drawBlueprint(bp, wx, wy);
      }
      const cs = byRow.get(y);
      if (cs) { cs.sort((a, b) => a.y - b.y); for (const c of cs) this.drawColonist(c); }
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
      this.img(Sprites.build[s.type], wx, wy, TS, TS);
      const isWall = (xx, yy) => { if (!World.inb(xx, yy)) return false; const q = World.struct[yy * World.w + xx]; return !!q && (BUILD[q.type].wall || BUILD[q.type].door); };
      if (!isWall(x, y + 1)) { this.rect(wx, wy + TS - 4, TS, 4, 'rgba(0,0,0,0.35)'); this.rect(wx, wy + TS, TS, 3, 'rgba(0,0,0,0.22)'); }
      if (!isWall(x, y - 1)) this.rect(wx, wy, TS, 1.5, 'rgba(255,255,255,0.25)');
      if (!isWall(x - 1, y)) this.rect(wx, wy, 1, TS, 'rgba(0,0,0,0.3)');
      if (!isWall(x + 1, y)) this.rect(wx + TS - 1, wy, 1, TS, 'rgba(0,0,0,0.3)');
    } else if (s.type === 'door') {
      const open = Game.colonists.some(c => Math.abs(c.x - (x + 0.5)) < 1 && Math.abs(c.y - (y + 0.5)) < 1);
      this.img(open ? Sprites.build.door_open : Sprites.build.door, wx, wy, TS, TS);
    } else if (s.type === 'campfire') {
      this.img(Sprites.build.campfire, wx, wy, TS, TS);
      this.drawFlame(wx + 8, wy + 9);
    } else {
      this.img(Sprites.build[s.type], wx, wy, TS, TS);
    }
    if (s.decon) this.img(Sprites.des.decon, wx + 4, wy + 4, 8, 8);
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
    for (const i of tiles) {
      const x = i % World.w, y = (i / World.w) | 0, wx = x * TS, wy = y * TS;
      const valid = d.valid(i);
      if (valid) ok++;
      if (d.build && valid) {
        ctx.globalAlpha = 0.6;
        this.img(Sprites.build[d.build], wx, wy, TS, TS);
        ctx.globalAlpha = 1;
      }
      this.rect(wx, wy, TS, TS, valid ? 'rgba(120,230,140,0.30)' : 'rgba(255,80,80,0.25)');
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
    if (this.rain.length) {
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
    const y = anyY ? U.rand() * Hh : -20;
    return { x: U.rand() * (W + 200) - 100, y, v: U.range(700, 1000), l: U.range(8, 14) * this.dpr, end: y + U.range(80, Hh) };
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
