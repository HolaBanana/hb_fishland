'use strict';
/**
 * Sprites – veškerá pixel-art grafika generovaná kódem (žádné externí obrázky).
 */
const Sprites = (() => {
  const S = { obj: {}, items: {}, build: {}, crop: [], des: {}, icons: {} };

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /** Kreslení po pixelech do ImageData. */
  function paint(w, h, fn) {
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const d = img.data;
    const set = (x, y, col, a) => {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= w || y >= h || !col) return;
      const k = (y * w + x) * 4;
      const alpha = a !== undefined ? a : (col[3] !== undefined ? col[3] : 255);
      if (alpha < 255 && d[k + 3] > 0) {
        const t = alpha / 255;
        d[k] = d[k] * (1 - t) + col[0] * t; d[k + 1] = d[k + 1] * (1 - t) + col[1] * t; d[k + 2] = d[k + 2] * (1 - t) + col[2] * t;
        d[k + 3] = Math.max(d[k + 3], alpha);
      } else {
        d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = alpha;
      }
    };
    const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[(y * w + x) * 4 + 3];
    const rect = (x, y, rw, rh, col, a) => { for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) set(xx, yy, col, a); };
    fn(set, get, rect, w, h);
    g.putImageData(img, 0, 0);
    return c;
  }

  /** Obrys kolem neprůhledných pixelů. */
  function outline(c, col = [26, 20, 16], minA = 200) {
    const g = c.getContext('2d');
    const w = c.width, h = c.height;
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[(y * w + x) * 4 + 3];
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (a(x, y) > 0) continue;
      if (a(x - 1, y) >= minA || a(x + 1, y) >= minA || a(x, y - 1) >= minA || a(x, y + 1) >= minA) add.push((y * w + x) * 4);
    }
    for (const k of add) { d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c;
  }

  const H = U.hash2;
  const pickPal = (pal, v) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(v * pal.length)))];

  // ============ TERÉN (jedno velké plátno s plynulými přechody) ============
  const PAL = {
    water:   [[30, 62, 112], [36, 72, 126], [42, 82, 138], [36, 70, 124]],
    shallow: [[60, 116, 146], [68, 128, 154], [76, 140, 162], [64, 122, 150]],
    sand:    [[196, 170, 118], [208, 184, 132], [218, 196, 144], [204, 178, 126]],
    grass:   [[70, 112, 48], [80, 124, 54], [90, 136, 60], [100, 146, 66], [84, 128, 56]],
    soil:    [[72, 54, 34], [82, 62, 38], [92, 70, 44], [78, 58, 36]],
    dirt:    [[120, 94, 62], [132, 104, 70], [142, 114, 78], [126, 98, 66]],
    gravel:  [[100, 96, 90], [112, 108, 100], [124, 118, 110], [106, 102, 96]],
  };

  function buildTerrain() {
    const TS = Config.TILE, W = World.w * TS, Hh = World.h * TS;
    const c = canvas(W, Hh);
    const g = c.getContext('2d');
    const img = g.createImageData(W, Hh);
    const d = img.data;
    const seed = World.seed;
    const tAt = (x, y) => {
      x = x < 0 ? 0 : x >= World.w ? World.w - 1 : x;
      y = y < 0 ? 0 : y >= World.h ? World.h - 1 : y;
      return World.terrain[y * World.w + x];
    };
    for (let py = 0; py < Hh; py++) {
      for (let px = 0; px < W; px++) {
        // posun vzorkování → zubaté, přirozené okraje mezi terény
        const n1 = U.noise(px / 7, py / 7, seed + 11), n2 = U.noise(px / 7, py / 7, seed + 23);
        const jx = (n1 - 0.5) * 11 + (H(px, py, seed + 1) - 0.5) * 3;
        const jy = (n2 - 0.5) * 11 + (H(px, py, seed + 2) - 0.5) * 3;
        const t = tAt(Math.floor((px + jx) / TS), Math.floor((py + jy) / TS));
        const hsh = H(px, py, seed);
        const nn = U.noise(px / 9, py / 9, seed + 31);
        let col;
        switch (t) {
          case T.WATER: {
            const band = Math.sin(px * 0.18 + py * 0.07 + nn * 7);
            col = pickPal(PAL.water, nn * 0.7 + hsh * 0.3);
            if (band > 0.93) col = [64, 108, 164];
            break;
          }
          case T.SHALLOW: {
            const band = Math.sin(px * 0.2 + py * 0.05 + nn * 6);
            col = pickPal(PAL.shallow, nn * 0.7 + hsh * 0.3);
            if (band > 0.9) col = [104, 166, 182];
            if (hsh > 0.985) col = [170, 156, 112];
            break;
          }
          case T.SAND:
            col = pickPal(PAL.sand, nn * 0.6 + hsh * 0.4);
            if (hsh > 0.97) col = [168, 144, 100];
            break;
          case T.GRASS: {
            col = pickPal(PAL.grass, nn * 0.65 + hsh * 0.35);
            const b = H(px, py >> 1, seed + 7);
            if (b > 0.94) col = [112, 160, 74];
            else if (b < 0.05) col = [58, 96, 40];
            if (hsh > 0.996) col = [220, 210, 90]; // kvítek
            else if (hsh > 0.993) col = [230, 230, 240];
            break;
          }
          case T.SOIL:
            col = pickPal(PAL.soil, nn * 0.6 + hsh * 0.4);
            if (hsh > 0.93) col = H(px >> 1, py >> 1, seed + 4) > 0.5 ? [86, 126, 52] : [70, 108, 44];
            else if (hsh < 0.03) col = [60, 42, 28];
            break;
          case T.DIRT:
            col = pickPal(PAL.dirt, nn * 0.6 + hsh * 0.4);
            if (hsh > 0.98) col = [100, 132, 64];
            else if (hsh < 0.025) col = [100, 78, 52];
            break;
          default: // GRAVEL
            col = pickPal(PAL.gravel, nn * 0.55 + hsh * 0.45);
            if (hsh > 0.95) col = [144, 138, 128];
            else if (hsh < 0.04) col = [80, 76, 72];
        }
        const k = (py * W + px) * 4;
        d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    S.terrain = c;
  }

  // ============ PŘÍRODNÍ OBJEKTY ============
  function makeTree(seed, kind) {
    return outline(paint(20, 28, (set, get, rect) => {
      // stín
      for (let y = 23; y < 28; y++) for (let x = 3; x < 17; x++) {
        const dx = (x - 10) / 7, dy = (y - 25.5) / 2.4;
        if (dx * dx + dy * dy < 1) set(x, y, [0, 0, 0], 70);
      }
      // kmen
      for (let y = 15; y < 26; y++) {
        set(9, y, [70, 46, 28]); set(10, y, [96, 64, 38]); set(11, y, [84, 56, 32]);
      }
      set(8, 25, [70, 46, 28]); set(12, 25, [70, 46, 28]);
      if (kind === 'pine') {
        const pal = [[24, 62, 44], [34, 82, 56], [46, 102, 66], [64, 124, 78]];
        for (let tier = 0; tier < 4; tier++) {
          const top = 1 + tier * 5, bottom = top + 8;
          for (let y = top; y < bottom; y++) {
            const half = 1 + (y - top) * (1.0 + tier * 0.18);
            for (let x = Math.floor(10 - half); x <= Math.ceil(10 - 1 + half); x++) {
              const edge = Math.abs(x - 9.5) > half - 1.2;
              const lv = 0.45 + (9.5 - x) / 14 - (y - top) / 20 + (H(x, y, seed) - 0.5) * 0.3;
              set(x, y, edge ? pal[0] : pickPal(pal, lv));
            }
          }
        }
      } else {
        const hue = H(1, 2, seed);
        const base = hue < 0.33 ? [[34, 74, 34], [50, 98, 40], [70, 122, 50], [98, 150, 64], [128, 176, 80]]
          : hue < 0.66 ? [[40, 78, 30], [60, 104, 36], [84, 130, 44], [112, 156, 56], [140, 180, 70]]
          : [[36, 70, 40], [52, 94, 50], [72, 118, 58], [96, 140, 66], [124, 166, 84]];
        const blobs = [[10, 10, 7.5], [6, 12, 4.5], [14, 12, 4.5], [10, 6, 5]];
        for (let y = 0; y < 22; y++) for (let x = 0; x < 20; x++) {
          let inside = false, minEdge = 9;
          for (const [bx, by, br] of blobs) {
            const r = br + (H(x, y, seed + 9) - 0.5) * 1.2;
            const dd = Math.hypot(x - bx, y - by);
            if (dd <= r) { inside = true; minEdge = Math.min(minEdge, r - dd); }
          }
          if (!inside) continue;
          const lv = 0.55 - (x - 10) / 22 - (y - 9) / 16 + (H(x, y, seed + 3) - 0.5) * 0.35;
          let col = pickPal(base, lv);
          if (minEdge < 0.9 && y > 8) col = base[0];
          set(x, y, col);
        }
        // pár jablíček / květů
        if (hue > 0.8) for (let k = 0; k < 4; k++) set(4 + H(k, 1, seed) * 12, 5 + H(k, 2, seed) * 10, [200, 60, 50]);
      }
    }));
  }

  function makeBush(berries) {
    return outline(paint(16, 16, (set) => {
      for (let y = 13; y < 16; y++) for (let x = 3; x < 13; x++) {
        const dx = (x - 8) / 5.5, dy = (y - 14) / 1.6;
        if (dx * dx + dy * dy < 1) set(x, y, [0, 0, 0], 60);
      }
      const pal = [[34, 80, 40], [48, 102, 48], [64, 124, 56], [88, 148, 66]];
      for (let y = 4; y < 15; y++) for (let x = 2; x < 15; x++) {
        const r = 5.6 + (H(x, y, 77) - 0.5) * 1.4;
        if (Math.hypot(x - 8, (y - 9.5) * 1.15) > r) continue;
        set(x, y, pickPal(pal, 0.6 - (x - 8) / 14 - (y - 9) / 12 + (H(x, y, 5) - 0.5) * 0.3));
      }
      if (berries) {
        const pts = [[5, 8], [9, 6], [11, 10], [7, 11], [10, 13], [4, 11], [12, 7]];
        for (const [x, y] of pts) { set(x, y, [190, 36, 60]); set(x + 1, y, [150, 24, 48]); set(x, y - 1, [240, 120, 140]); }
      }
    }));
  }

  function makeRock(seed, ore) {
    return paint(16, 16, (set) => {
      const pal = [[92, 88, 84], [104, 100, 94], [116, 112, 104], [128, 122, 114]];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const v = U.noise(x / 4 + seed, y / 4, seed) * 0.6 + H(x, y, seed) * 0.4;
        set(x, y, pickPal(pal, v));
      }
      // praskliny
      for (let k = 0; k < 3; k++) {
        let x = Math.floor(H(k, 0, seed) * 14) + 1, y = Math.floor(H(k, 1, seed) * 14) + 1;
        for (let s = 0; s < 4; s++) {
          set(x, y, [70, 66, 62]); set(x + 1, y - 1, [140, 134, 126], 160);
          x += H(k, s, seed + 4) > 0.5 ? 1 : 0; y += 1;
        }
      }
      if (ore) {
        const ocol = [[150, 82, 44], [188, 110, 60], [222, 150, 90], [120, 64, 36]];
        for (let k = 0; k < 7; k++) {
          const cx = 2 + H(k, 5, seed) * 12, cy = 2 + H(k, 6, seed) * 12;
          for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
            if (H(x + k, y, seed + 8) > 0.55 || (x === 0 && y === 0)) set(cx + x, cy + y, ocol[(x + 1 + (y + 1)) % 4]);
          }
          set(cx - 1, cy - 1, [244, 200, 140]);
        }
      }
    });
  }

  // ============ PŘEDMĚTY ============
  function makeItems() {
    S.items.wood = outline(paint(16, 16, (set, get, rect) => {
      const log = (x0, y0, len) => {
        for (let x = x0; x < x0 + len; x++) {
          set(x, y0, [168, 116, 68]); set(x, y0 + 1, [140, 92, 52]); set(x, y0 + 2, [104, 66, 36]);
          if (H(x, y0, 3) > 0.8) set(x, y0 + 1, [120, 78, 44]);
        }
        set(x0, y0, [210, 172, 120]); set(x0, y0 + 1, [176, 132, 84]); set(x0, y0 + 2, [196, 160, 110]);
      };
      log(2, 10, 12); log(3, 7, 11); log(5, 4, 8);
    }));
    S.items.stone = outline(paint(16, 16, (set) => {
      const chunks = [[5, 10, 3.2], [11, 11, 2.8], [8, 6, 2.8], [12, 6, 1.8]];
      for (const [cx, cy, r] of chunks) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        if (Math.hypot(x, y * 1.2) > r) continue;
        const lv = 0.55 - x / 8 - y / 7;
        set(cx + x, cy + y, lv > 0.8 ? [184, 178, 168] : lv > 0.45 ? [146, 140, 132] : [104, 100, 96]);
      }
    }));
    S.items.iron = outline(paint(16, 16, (set) => {
      const ingot = (x0, y0) => {
        for (let y = 0; y < 4; y++) for (let x = (y === 0 ? 1 : 0); x < (y === 0 ? 7 : 8); x++) {
          set(x0 + x, y0 + y, y === 0 ? [196, 204, 216] : y === 3 ? [80, 86, 98] : [132, 140, 154]);
        }
        set(x0 + 2, y0 + 1, [226, 232, 240]);
      };
      ingot(1, 10); ingot(8, 10); ingot(4, 6);
    }));
    S.items.food = outline(paint(16, 16, (set) => {
      const pts = [[4, 11], [8, 12], [12, 11], [6, 8], [10, 8], [8, 5]];
      for (const [cx, cy] of pts) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
        if (Math.hypot(x, y * 1.3) > 2.3) continue;
        set(cx + x, cy + y, (x + y) < -1 ? [214, 176, 112] : (x + y) > 1 ? [146, 108, 60] : [186, 146, 88]);
      }
      set(5, 11, [120, 86, 50]); set(9, 8, [120, 86, 50]); set(12, 12, [120, 86, 50]);
      set(8, 3, [96, 160, 64]); set(9, 2, [120, 184, 80]); set(7, 2, [80, 140, 54]);
    }));
    S.items.plank = outline(paint(16, 16, (set, get, rect) => {
      const board = (x0, y0, len, c) => { rect(x0, y0, len, 2, c); rect(x0, y0, len, 1, U.shade(c, 1.18)); set(x0, y0 + 1, U.shade(c, 0.7)); set(x0 + len - 1, y0 + 1, U.shade(c, 0.7)); };
      board(2, 11, 12, [196, 150, 96]); board(3, 8, 12, [206, 162, 106]); board(2, 5, 11, [186, 140, 88]);
    }));
    S.items.ore = outline(paint(16, 16, (set) => {
      const chunks = [[5, 10, 3.2], [11, 10, 3], [8, 6, 2.8]];
      for (const [cx, cy, r] of chunks) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        if (Math.hypot(x, y * 1.2) > r) continue;
        const lv = 0.55 - x / 8 - y / 7;
        let c = lv > 0.8 ? [150, 144, 136] : lv > 0.45 ? [112, 106, 100] : [80, 76, 72];
        if (H(cx + x, cy + y, 31) > 0.62) c = lv > 0.5 ? [226, 150, 86] : [176, 98, 52];
        set(cx + x, cy + y, c);
      }
    }));
    S.items.meat = outline(paint(16, 16, (set) => {
      for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) {
        const dx = (x - 7.5) / 5, dy = (y - 8) / 4.2;
        if (dx * dx + dy * dy > 1) continue;
        set(x, y, dx + dy < -0.5 ? [226, 110, 100] : dx + dy > 0.6 ? [150, 50, 50] : [196, 76, 70]);
      }
      set(6, 7, [240, 200, 190]); set(7, 8, [240, 200, 190]); set(9, 9, [240, 200, 190]);
      set(12, 11, [236, 230, 214]); set(13, 12, [236, 230, 214]); set(14, 12, [250, 246, 236]); set(13, 13, [250, 246, 236]);
    }));
    S.items.egg = outline(paint(16, 16, (set) => {
      for (const [cx, cy] of [[5, 10], [10, 10], [8, 6]]) for (let y = -3; y <= 3; y++) for (let x = -2; x <= 2; x++) {
        if ((x * x) / 5.5 + (y * y) / 9.5 > 1) continue;
        set(cx + x, cy + y, x + y < -1 ? [252, 248, 236] : x + y > 2 ? [206, 190, 160] : [236, 224, 200]);
      }
    }));
    S.items.wool = outline(paint(16, 16, (set) => {
      for (const [cx, cy, r] of [[6, 9, 3.6], [10, 9, 3.4], [8, 6, 3.2]]) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        if (Math.hypot(x, y) > r) continue;
        set(cx + x, cy + y, H(cx + x, cy + y, 41) > 0.7 ? [206, 204, 196] : x + y < 0 ? [250, 248, 242] : [228, 226, 218]);
      }
    }));
    S.items.leather = outline(paint(16, 16, (set) => {
      for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
        if ((x < 5 || x > 10) && (y > 5 && y < 10)) continue;
        set(x, y, (x + y) % 5 === 0 ? [124, 80, 44] : y < 5 ? [176, 122, 72] : [150, 100, 58]);
      }
    }));
    S.items.coat = outline(paint(16, 16, (set, get, rect) => {
      rect(5, 3, 6, 10, [120, 86, 150]); rect(2, 4, 3, 6, [104, 72, 132]); rect(11, 4, 3, 6, [104, 72, 132]);
      rect(5, 3, 6, 1, [236, 232, 220]); rect(7, 4, 2, 9, [96, 66, 122]); rect(5, 12, 6, 1, [236, 232, 220]);
    }));
    S.items.bow = outline(paint(16, 16, (set, get, rect) => {
      for (let k = 0; k < 11; k++) set(2 + k, 8, [150, 104, 60]);
      rect(11, 3, 2, 11, [110, 72, 40]); set(10, 3, [110, 72, 40]); set(10, 13, [110, 72, 40]);
      for (let k = 0; k < 5; k++) { set(9 - k * 0, 4 + k, [220, 220, 220], 0); }
      for (let y = 4; y < 13; y++) set(9, y, [226, 226, 226]);
      set(2, 8, [200, 204, 214]); set(1, 8, [200, 204, 214]);
    }));
    S.items.ammo = outline(paint(16, 16, (set, get, rect) => {
      for (const x of [3, 7, 11]) { rect(x, 6, 2, 7, [196, 150, 60]); rect(x, 4, 2, 2, [150, 156, 168]); set(x, 6, [236, 200, 110]); }
    }));
    S.items.parts = outline(paint(16, 16, (set, get, rect) => {
      for (const [cx, cy] of [[5, 10], [11, 6]]) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        const d = Math.hypot(x, y), a = Math.atan2(y, x);
        if (d > 4.2 || d < 1.3) continue;
        if (d > 3 && Math.cos(a * 8) < 0) continue;      // zuby ozubeného kola
        set(cx + x, cy + y, x + y < 0 ? [196, 204, 216] : [120, 128, 140]);
      }
      rect(9, 11, 5, 2, [176, 126, 74]); set(13, 11, [120, 128, 140]);
    }));
    S.items.herbs = outline(paint(16, 16, (set) => {
      for (let k = 0; k < 4; k++) {
        const x0 = 4 + k * 2.5;
        for (let y = 5; y < 14; y++) set(x0 + (y > 9 ? 0 : (k & 1)), y, [70, 120, 60]);
        set(x0 - 1, 7 + k, [100, 160, 80]); set(x0 + 1, 9 - k % 2, [100, 160, 80]);
        set(x0, 4, [170, 110, 210]); set(x0 + 1, 5, [200, 150, 230]);
      }
      for (let x = 3; x < 13; x++) set(x, 11, [176, 126, 74]);
    }));
    S.items.medicine = outline(paint(16, 16, (set, get, rect) => {
      rect(4, 5, 8, 9, [236, 232, 220]); rect(4, 5, 8, 1, [250, 248, 240]); rect(6, 2, 4, 3, [176, 126, 74]);
      rect(7, 7, 2, 5, [220, 60, 60]); rect(5, 9, 6, 1, [220, 60, 60]); rect(5, 9, 6, 2, [220, 60, 60]);
    }));
    S.items.meal = outline(paint(16, 16, (set) => {
      for (let y = 7; y < 14; y++) for (let x = 2; x < 14; x++) {
        const dx = (x - 7.5) / 6, dy = (y - 8) / 6;
        if (dx * dx + dy * dy > 1) continue;
        set(x, y, y > 11 ? [96, 56, 30] : [130, 80, 44]);
      }
      for (let x = 3; x < 13; x++) { set(x, 7, [214, 120, 52]); set(x, 8, [196, 104, 44]); }
      set(5, 7, [240, 200, 100]); set(9, 8, [110, 170, 70]); set(11, 7, [240, 200, 100]); set(7, 8, [230, 150, 80]);
      set(6, 4, [240, 240, 240], 140); set(7, 3, [240, 240, 240], 120); set(9, 4, [240, 240, 240], 140); set(10, 2, [240, 240, 240], 100);
    }));
  }

  // ============ STAVBY ============
  function makeBuild() {
    S.build.wall_wood = paint(16, 16, (set) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const row = y >> 2, ry = y & 3;
        let col = [150, 104, 60];
        if (H(row, x >> 3, 3) > 0.5) col = [160, 112, 66];
        if (ry === 0) col = [182, 134, 84];
        if (ry === 3) col = [100, 66, 38];
        if ((x + row * 5) % 9 === 0) col = [96, 62, 36];
        if (H(x, y, 9) > 0.93) col = U.shade(col, 0.85);
        set(x, y, col);
      }
    });
    S.build.wall_stone = paint(16, 16, (set) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const row = y >> 2, ry = y & 3, off = (row & 1) * 4;
        const bx = Math.floor((x + off) / 8);
        let col = H(bx, row, 4) > 0.5 ? [150, 146, 138] : [136, 132, 126];
        if (ry === 0) col = [172, 168, 160];
        if (ry === 3 || (x + off) % 8 === 0) col = [86, 82, 78];
        if (H(x, y, 11) > 0.9) col = U.shade(col, 0.9);
        set(x, y, col);
      }
    });
    S.build.door = paint(16, 16, (set, get, rect) => {
      rect(0, 0, 16, 16, [84, 56, 32]);
      for (let y = 2; y < 16; y++) for (let x = 2; x < 14; x++) {
        let col = (x - 2) % 4 === 0 ? [130, 88, 50] : [176, 126, 74];
        if (y === 6 || y === 12) col = [110, 74, 42];
        set(x, y, col);
      }
      set(11, 9, [230, 206, 100]); set(11, 10, [170, 140, 60]);
    });
    S.build.door_open = paint(16, 16, (set, get, rect) => {
      rect(0, 0, 16, 2, [84, 56, 32]); rect(0, 0, 2, 16, [84, 56, 32]); rect(14, 0, 2, 16, [84, 56, 32]);
      rect(2, 2, 3, 14, [150, 104, 60]);
    });
    S.build.floor_wood = paint(16, 16, (set) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const plank = x >> 2, off = (plank * 7) % 16;
        let col = H(plank, 0, 2) > 0.5 ? [176, 132, 86] : [164, 122, 78];
        if ((x & 3) === 0) col = [124, 88, 54];
        if ((y + off) % 16 === 0) col = [130, 92, 56];
        if (H(x, y, 3) > 0.9) col = U.shade(col, 0.92);
        set(x, y, col);
      }
    });
    S.build.floor_stone = paint(16, 16, (set) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const tx = x >> 3, ty = y >> 3;
        let col = H(tx, ty, 6) > 0.5 ? [160, 156, 148] : [148, 144, 138];
        if ((x & 7) === 0 || (y & 7) === 0) col = [112, 108, 104];
        else if ((x & 7) === 1 || (y & 7) === 1) col = U.shade(col, 1.08);
        if (H(x, y, 8) > 0.92) col = U.shade(col, 0.92);
        set(x, y, col);
      }
    });
    S.build.bed = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 1, 14, 15, [110, 72, 40]);
      rect(2, 2, 12, 4, [236, 232, 220]);
      rect(2, 2, 12, 1, [250, 248, 240]);
      rect(2, 6, 12, 9, [62, 98, 168]);
      rect(2, 6, 12, 1, [100, 136, 200]);
      rect(2, 9, 12, 1, [80, 116, 186]);
      rect(1, 15, 14, 1, [80, 50, 28]);
    }));
    S.build.table = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 3, 14, 9, [176, 126, 74]);
      rect(1, 3, 14, 1, [206, 158, 100]);
      for (let x = 1; x < 15; x += 4) rect(x, 4, 1, 8, [150, 104, 60]);
      rect(1, 12, 14, 2, [116, 78, 44]);
      rect(2, 14, 2, 2, [90, 58, 32]); rect(12, 14, 2, 2, [90, 58, 32]);
      // miska a hrnek
      rect(5, 6, 4, 2, [226, 220, 204]); rect(6, 6, 2, 1, [214, 120, 52]);
      rect(11, 5, 2, 2, [150, 160, 176]);
    }));
    S.build.chair = outline(paint(16, 16, (set, get, rect) => {
      rect(4, 2, 8, 6, [150, 104, 60]);
      rect(4, 2, 8, 1, [186, 138, 86]);
      rect(5, 4, 6, 1, [116, 78, 44]);
      rect(4, 8, 8, 4, [176, 126, 74]);
      rect(4, 8, 8, 1, [206, 158, 100]);
      rect(4, 12, 2, 3, [96, 62, 36]); rect(10, 12, 2, 3, [96, 62, 36]);
    }));
    S.build.chest = outline(paint(16, 16, (set, get, rect) => {
      rect(2, 4, 12, 10, [140, 92, 50]);
      rect(2, 4, 12, 4, [168, 116, 66]);
      rect(2, 4, 12, 1, [200, 150, 92]);
      rect(2, 8, 12, 1, [84, 54, 30]);
      rect(2, 4, 1, 10, [90, 94, 104]); rect(13, 4, 1, 10, [90, 94, 104]);
      rect(7, 7, 2, 3, [232, 200, 96]); set(7, 9, [150, 120, 50]);
      rect(2, 13, 12, 1, [96, 62, 34]);
    }));
    // ----- obrana -----
    S.build.armory = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 7, 14, 5, [110, 114, 126]); rect(1, 7, 14, 1, [170, 176, 188]); rect(1, 11, 14, 1, [70, 74, 86]);
      rect(2, 12, 2, 4, [70, 74, 86]); rect(12, 12, 2, 4, [70, 74, 86]);
      for (let k = 0; k < 7; k++) set(3 + k, 5, [150, 104, 60]);
      rect(9, 2, 2, 5, [110, 72, 40]); set(8, 2, [110, 72, 40]); set(8, 6, [110, 72, 40]);
      rect(12, 4, 2, 3, [196, 150, 60]);
    }));
    S.build.turret = outline(paint(16, 16, (set, get, rect) => {
      rect(2, 9, 12, 7, [112, 108, 102]); rect(2, 9, 12, 1, [160, 156, 148]); rect(2, 15, 12, 1, [70, 66, 62]);
      for (let y = 3; y < 11; y++) for (let x = 4; x < 12; x++) if (Math.hypot(x - 7.5, y - 6.5) < 4) set(x, y, x + y < 12 ? [176, 184, 196] : [110, 116, 128]);
      set(7, 6, [60, 62, 70]); set(8, 6, [60, 62, 70]); set(7, 7, [60, 62, 70]); set(8, 7, [60, 62, 70]);
    }));
    S.build.gate = paint(16, 16, (set, get, rect) => {
      rect(0, 0, 16, 16, [70, 74, 86]);
      for (let y = 2; y < 16; y++) for (let x = 2; x < 14; x++) set(x, y, (x - 2) % 4 === 0 ? [110, 78, 46] : [150, 110, 66]);
      rect(2, 5, 12, 2, [120, 126, 138]); rect(2, 11, 12, 2, [120, 126, 138]);
      for (const x of [3, 7, 11]) { set(x, 5, [200, 206, 216]); set(x, 11, [200, 206, 216]); }
    });
    // ----- chov a krejčí -----
    S.build.tailor = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 7, 14, 5, [150, 104, 60]); rect(1, 7, 14, 1, [186, 138, 86]); rect(1, 11, 14, 1, [100, 66, 38]);
      rect(2, 12, 2, 4, [100, 66, 38]); rect(12, 12, 2, 4, [100, 66, 38]);
      rect(3, 4, 5, 3, [120, 86, 150]); rect(3, 4, 5, 1, [150, 116, 180]);
      rect(10, 3, 3, 4, [236, 232, 220]); set(11, 2, [200, 60, 60]);
    }));
    const hut = (roof, roofD, wall) => outline(paint(16, 16, (set, get, rect) => {
      rect(2, 8, 12, 8, wall); rect(2, 15, 12, 1, U.shade(wall, 0.7));
      for (let y = 1; y < 9; y++) { const w = 1 + y; rect(8 - w, y, w * 2, 1, y & 1 ? roof : roofD); }
      rect(6, 11, 4, 5, [50, 36, 28]);
    }));
    S.build.coop = hut([196, 150, 80], [170, 124, 60], [176, 126, 74]);
    S.build.sheepfold = hut([150, 90, 70], [124, 70, 54], [200, 190, 170]);
    // ----- dílny, stroje, energie -----
    const metal = [120, 126, 138], metalL = [176, 184, 196], metalD = [72, 78, 90];
    const wood = [150, 104, 60], woodL = [186, 138, 86], woodD = [100, 66, 38];
    const stoneC = [140, 136, 130], stoneL = [176, 172, 164], stoneD = [92, 88, 84];
    // ----- pozdní hra a lékárna -----
    S.build.apothecary = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 3, 14, 13, [150, 104, 60]); rect(1, 3, 14, 1, [186, 138, 86]);
      for (const y of [6, 10]) rect(2, y, 12, 1, [100, 66, 38]);
      for (const [x, y, c] of [[3, 4, [120, 190, 120]], [6, 4, [200, 120, 220]], [10, 4, [236, 232, 220]], [4, 8, [220, 80, 80]], [8, 8, [150, 200, 230]], [11, 8, [120, 190, 120]]]) rect(x, y, 2, 2, c);
      rect(3, 11, 10, 5, [176, 126, 74]); rect(7, 12, 2, 3, [220, 60, 60]); rect(6, 13, 4, 1, [220, 60, 60]);
    }));
    S.build.machineshop = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 7, 14, 5, metal); rect(1, 7, 14, 1, metalL); rect(1, 11, 14, 1, metalD);
      rect(2, 12, 2, 4, metalD); rect(12, 12, 2, 4, metalD);
      rect(9, 1, 2, 6, metalD); rect(7, 1, 6, 2, metal); rect(9, 5, 2, 2, [255, 220, 90]);
      rect(2, 4, 5, 3, [120, 80, 44]); rect(3, 5, 3, 1, [200, 206, 216]);
    }));
    S.build.heater = outline(paint(16, 16, (set, get, rect) => {
      rect(2, 3, 12, 12, metal); rect(2, 3, 12, 1, metalL); rect(2, 14, 12, 1, metalD);
      for (let x = 4; x < 13; x += 2) rect(x, 5, 1, 8, [230, 110, 50]);
      rect(11, 1, 2, 2, metalD);
    }));
    S.build.assembler = outline(paint(32, 16, (set, get, rect) => {
      rect(1, 4, 30, 11, metal); rect(1, 4, 30, 1, metalL); rect(1, 14, 30, 1, metalD);
      rect(3, 6, 26, 4, [58, 60, 68]);
      for (let x = 4; x < 28; x += 6) { rect(x, 1, 2, 6, metalD); rect(x - 1, 6, 4, 2, [255, 220, 90]); }
      rect(4, 11, 6, 2, [176, 126, 74]); rect(22, 11, 6, 2, [196, 204, 216]);
    }));
    S.build.harvester = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 4, 14, 9, [196, 150, 52]); rect(1, 4, 14, 1, [236, 196, 90]); rect(1, 12, 14, 1, [130, 96, 30]);
      rect(9, 1, 5, 4, [70, 110, 150]); rect(10, 2, 3, 2, [160, 210, 240]);
      for (let x = 1; x < 15; x += 2) set(x, 13, metalL);
      for (const cx of [4, 12]) rect(cx - 2, 13, 4, 3, [50, 46, 44]);
    }));
    S.build.radio = outline(paint(32, 32, (set, get, rect) => {
      rect(4, 22, 24, 10, [140, 136, 130]); rect(4, 22, 24, 1, [176, 172, 164]);
      rect(8, 24, 8, 6, [58, 60, 68]); rect(9, 25, 2, 2, [126, 220, 126]); rect(12, 25, 2, 2, [255, 200, 80]);
      for (let y = 2; y < 22; y++) { const w = Math.max(1, Math.floor((22 - y) / 5)); set(16 - w, y, metalD); set(16 + w, y, metalD); if (y % 4 === 0) rect(16 - w, y, w * 2 + 1, 1, metal); }
      rect(15, 0, 3, 3, [230, 70, 60]);
      for (let a = 0; a < 7; a++) { set(21 + a, 6 - Math.round(Math.sin(a / 2) * 2), metalL); }
    }));
    S.build.saw = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 7, 14, 5, wood); rect(1, 7, 14, 1, woodL); rect(1, 11, 14, 1, woodD);
      rect(2, 12, 2, 4, woodD); rect(12, 12, 2, 4, woodD);
      for (let x = 4; x < 12; x++) { set(x, 3 + (x & 1), metalL); set(x, 5, metal); set(x, 6, metalD); }
      rect(3, 3, 1, 4, woodD); rect(12, 3, 1, 4, woodD);
      rect(5, 8, 7, 2, [206, 162, 106]);
    }));
    S.build.furnace = outline(paint(16, 16, (set, get, rect) => {
      rect(2, 4, 12, 12, stoneC);
      for (let y = 4; y < 16; y += 3) rect(2, y, 12, 1, stoneD);
      for (let y = 4; y < 16; y++) set(2 + ((y * 5) % 11), y, stoneL);
      rect(5, 9, 6, 5, [40, 30, 28]); rect(6, 11, 4, 3, [240, 130, 40]); rect(7, 12, 2, 2, [255, 220, 110]);
      rect(6, 0, 4, 4, stoneD); rect(6, 0, 4, 1, stoneL);
    }));
    S.build.research = outline(paint(32, 16, (set, get, rect) => {
      rect(1, 6, 30, 6, wood); rect(1, 6, 30, 1, woodL); rect(1, 11, 30, 1, woodD);
      rect(2, 12, 2, 4, woodD); rect(28, 12, 2, 4, woodD); rect(14, 12, 2, 4, woodD);
      rect(4, 2, 2, 4, [150, 200, 230]); rect(4, 4, 2, 2, [80, 170, 110]);            // baňka
      rect(8, 3, 2, 3, [220, 220, 230]); rect(8, 5, 2, 1, [200, 90, 90]);
      rect(13, 3, 7, 3, [236, 228, 204]); rect(14, 4, 5, 1, [120, 110, 96]);            // papíry
      rect(23, 1, 1, 5, metalD); rect(21, 1, 5, 1, metal); rect(24, 2, 3, 2, [250, 214, 110]); // lampička
    }));
    S.build.belt = paint(16, 16, (set, get, rect) => {
      rect(0, 2, 16, 12, [58, 60, 68]);
      rect(0, 1, 16, 1, metalL); rect(0, 14, 16, 1, metalD);
      rect(0, 2, 16, 1, [40, 42, 48]); rect(0, 13, 16, 1, [40, 42, 48]);
    });
    // šipky pásu (3 fáze animace), směr východ
    S.beltArrow = [0, 1, 2].map(f => paint(16, 16, (set) => {
      for (let k = 0; k < 3; k++) {
        const x0 = (k * 6 + f * 2) % 18 - 2;
        for (let d = 0; d < 4; d++) { set(x0 + d, 4 + d, [226, 190, 80]); set(x0 + d, 11 - d, [226, 190, 80]); }
      }
    }));
    const beltBase = (fn) => paint(16, 16, (set, get, rect) => {
      rect(0, 2, 16, 12, [58, 60, 68]); rect(0, 1, 16, 1, metalL); rect(0, 14, 16, 1, metalD);
      fn(set, rect);
    });
    const arr = (set, x0, y0, dx, dy, c) => { for (let d = 0; d < 3; d++) { set(x0 - d * dx - d * dy, y0 - d * dy - d * dx, c); set(x0 - d * dx + d * dy, y0 - d * dy + d * dx, c); } };
    S.build.splitter = beltBase((set, rect) => {
      rect(5, 5, 6, 6, [90, 96, 110]); rect(5, 5, 6, 1, metalL);
      arr(set, 14, 8, 1, 0, [120, 220, 140]); arr(set, 8, 13, 0, 1, [120, 220, 140]); arr(set, 8, 2, 0, -1, [120, 220, 140]);
    });
    S.build.sorter = beltBase((set, rect) => {
      rect(5, 4, 6, 8, [70, 90, 130]); rect(5, 4, 6, 1, [130, 160, 210]);
      arr(set, 14, 8, 1, 0, [255, 220, 90]); arr(set, 8, 13, 0, 1, [200, 200, 210]);
    });
    S.build.tunnel = beltBase((set, rect) => {
      rect(6, 3, 10, 10, [30, 28, 30]); rect(6, 3, 1, 10, metalL); rect(6, 3, 10, 1, metalL); rect(6, 12, 10, 1, metalD);
      arr(set, 4, 8, 1, 0, [226, 190, 80]);
    });
    S.build.rail = paint(16, 16, (set, get, rect) => {
      for (const x of [1, 5, 9, 13]) rect(x, 3, 2, 10, [110, 78, 46]);
      rect(0, 4, 16, 1, metalL); rect(0, 5, 16, 1, metalD); rect(0, 10, 16, 1, metalL); rect(0, 11, 16, 1, metalD);
    });
    S.build.cartstop = paint(16, 16, (set, get, rect) => {
      rect(0, 0, 16, 16, [96, 90, 84]); rect(0, 0, 16, 1, [140, 134, 126]); rect(0, 15, 16, 1, [60, 56, 52]);
      rect(0, 4, 16, 1, metalL); rect(0, 5, 16, 1, metalD); rect(0, 10, 16, 1, metalL); rect(0, 11, 16, 1, metalD);
      rect(1, 1, 3, 2, [255, 220, 90]); rect(12, 13, 3, 2, [255, 220, 90]);
    });
    S.cart = outline(paint(14, 12, (set, get, rect) => {
      rect(1, 2, 12, 6, [150, 104, 60]); rect(1, 2, 12, 1, [186, 138, 86]); rect(1, 7, 12, 1, [100, 66, 38]);
      rect(1, 2, 1, 6, metalD); rect(12, 2, 1, 6, metalD);
      for (const cx of [3, 10]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (Math.hypot(x, y) < 2.3) set(cx + x, 9 + y, Math.hypot(x, y) < 1 ? metalL : [50, 46, 44]);
    }));
    S.build.drill = outline(paint(16, 16, (set, get, rect) => {
      rect(2, 2, 12, 9, metal); rect(2, 2, 12, 1, metalL); rect(2, 10, 12, 1, metalD);
      rect(4, 4, 8, 4, [58, 60, 68]); rect(5, 5, 2, 2, [250, 214, 110]);
      rect(1, 11, 2, 5, metalD); rect(13, 11, 2, 5, metalD);
      for (let y = 11; y < 16; y++) { const w = Math.max(1, 5 - (y - 11)); rect(8 - (w >> 1), y, w, 1, y & 1 ? metalL : metalD); }
    }));
    S.build.autosaw = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 6, 14, 9, metal); rect(1, 6, 14, 1, metalL); rect(1, 14, 14, 1, metalD);
      rect(3, 9, 10, 3, wood); rect(3, 9, 10, 1, woodL);
      for (let a = 0; a < 10; a++) { const an = a / 10 * Math.PI * 2; set(8 + Math.cos(an) * 4.5, 5 + Math.sin(an) * 4.5, metalL); }
      for (let y = 2; y < 9; y++) for (let x = 5; x < 12; x++) if (Math.hypot(x - 8, y - 5) < 3.6) set(x, y, (x + y) & 1 ? [200, 206, 216] : [150, 156, 168]);
      set(8, 5, metalD);
    }));
    S.build.autofurnace = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 4, 14, 12, stoneC);
      for (let y = 4; y < 16; y += 3) rect(1, y, 14, 1, stoneD);
      rect(1, 4, 14, 1, metalL); rect(1, 15, 14, 1, metalD); rect(1, 4, 1, 12, metal); rect(14, 4, 1, 12, metal);
      rect(4, 8, 8, 6, [40, 30, 28]); rect(5, 10, 6, 4, [240, 130, 40]); rect(6, 11, 4, 3, [255, 220, 110]);
      rect(5, 0, 3, 4, metalD); rect(9, 1, 3, 3, metalD);
    }));
    S.build.pole = outline(paint(16, 16, (set, get, rect) => {
      rect(7, 2, 2, 14, wood); rect(7, 2, 1, 14, woodL);
      rect(3, 3, 10, 2, woodD); rect(3, 3, 10, 1, wood);
      set(3, 2, metalL); set(12, 2, metalL); set(7, 1, metalL); set(8, 1, metalL);
      rect(6, 14, 4, 2, stoneD);
    }));
    S.build.waterwheel = outline(paint(16, 16, (set, get, rect) => {
      rect(0, 12, 16, 4, woodD); rect(0, 12, 16, 1, wood);
      rect(7, 2, 2, 11, woodD);
      rect(2, 13, 3, 3, stoneC); rect(11, 13, 3, 3, stoneC);
    }));
    S.build.windmill = outline(paint(32, 32, (set, get, rect) => {
      for (let y = 12; y < 32; y++) { const w = 4 + Math.floor((y - 12) / 4); rect(16 - w, y, w * 2, 1, (y % 5 === 0) ? stoneD : stoneC); set(16 - w, y, stoneL); }
      rect(13, 24, 6, 8, woodD); rect(14, 25, 4, 7, wood);
      rect(11, 8, 10, 5, wood); rect(11, 8, 10, 1, woodL); rect(11, 12, 10, 1, woodD);
    }));
    S.build.boiler = outline(paint(32, 32, (set, get, rect) => {
      rect(3, 12, 26, 18, stoneC);
      for (let y = 12; y < 30; y += 4) rect(3, y, 26, 1, stoneD);
      for (let y = 6; y < 24; y++) for (let x = 6; x < 26; x++) {
        const dx = (x - 15.5) / 10, dy = (y - 15) / 9;
        if (dx * dx + dy * dy <= 1) set(x, y, dx + dy < -0.5 ? metalL : dx + dy > 0.6 ? metalD : metal);
      }
      rect(6, 14, 20, 1, metalD); rect(6, 18, 20, 1, metalD);
      rect(11, 22, 10, 8, [40, 30, 28]); rect(12, 25, 8, 5, [240, 130, 40]); rect(14, 27, 4, 3, [255, 220, 110]);
      rect(21, 0, 5, 10, metalD); rect(21, 0, 5, 1, metalL); rect(22, 1, 1, 9, metal);
    }));
    // šipka směru výstupu (východ)
    S.arrow = outline(paint(9, 9, (set) => {
      for (let x = 1; x < 6; x++) set(x, 4, [255, 220, 90]);
      for (let d = 0; d < 3; d++) { set(7 - d, 4 - d, [255, 220, 90]); set(7 - d, 4 + d, [255, 220, 90]); }
    }), [40, 30, 10]);
    S.build.campfire = paint(16, 16, (set) => {
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2;
        const x = 8 + Math.cos(ang) * 6, y = 9 + Math.sin(ang) * 5;
        set(x, y, [130, 126, 120]); set(x + 1, y, [96, 92, 88]); set(x, y - 1, [170, 166, 158]);
      }
      for (let k = -4; k <= 4; k++) { set(8 + k, 9 + (k >> 1), [110, 70, 40]); set(8 + k, 9 - (k >> 1), [90, 56, 32]); }
      for (let k = -2; k <= 2; k++) set(8 + k, 10, [40, 30, 26]);
    });
    S.build.lamp = outline(paint(16, 16, (set, get, rect) => {
      rect(5, 13, 6, 3, [110, 106, 100]);
      rect(7, 5, 2, 9, [80, 84, 94]);
      rect(5, 1, 6, 5, [60, 62, 70]);
      rect(6, 2, 4, 3, [250, 214, 110]);
      set(6, 2, [255, 244, 190]);
    }));
  }

  // ============ PLODINY ============
  function makeCrops() {
    S.tilled = paint(16, 16, (set) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let col = (y % 4 < 2) ? [92, 64, 40] : [72, 50, 30];
        if (H(x, y, 21) > 0.85) col = U.shade(col, 1.15);
        set(x, y, col);
      }
    });
    const make = (leaf, fruit, kind) => [0, 1, 2, 3].map(n => outline(paint(16, 16, (set) => {
      const plants = [[4, 5], [11, 5], [4, 12], [11, 12]];
      for (const [px, py] of plants) {
        if (n === 0) { set(px, py, leaf[1]); set(px + 1, py - 1, leaf[2]); continue; }
        if (kind === 'corn') {
          // vysoké stonky s klasy
          const hgt = n === 1 ? 3 : n === 2 ? 5 : 6;
          for (let k = 0; k < hgt; k++) { set(px, py + 1 - k, leaf[1]); if (k % 2) set(px + (k & 2 ? 1 : -1), py + 1 - k, leaf[2]); }
          if (n === 3) { set(px + 1, py - 2, fruit[0]); set(px + 1, py - 3, fruit[1]); set(px + 1, py - 1, fruit[0]); }
          continue;
        }
        const r = n === 1 ? 1.6 : n === 2 ? 2.6 : 3.2;
        for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
          if (Math.hypot(x, y) > r + (H(x + px, y + py, 4) - 0.5)) continue;
          set(px + x, py + y, leaf[Math.max(0, Math.min(2, Math.round(1 - (x + y) / 4)))]);
        }
        if (n === 3) {
          if (kind === 'cabbage') { for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) set(px + x, py + y, Math.abs(x) + Math.abs(y) < 2 ? fruit[1] : fruit[0]); }
          else { set(px - 1, py - 2, fruit[1]); set(px + 2, py, fruit[0]); set(px + 1, py + 3, fruit[0]); }
        }
      }
    }), [30, 60, 26], 255));
    S.crops = {};
    for (const k of CROP_KEYS) S.crops[k] = make(CROPS[k].leaf, CROPS[k].fruit, k);
    const leaf = [[54, 120, 50], [74, 146, 60], [100, 170, 72]];
    const stage = (n) => outline(paint(16, 16, (set) => {
      const plants = [[4, 5], [11, 5], [4, 12], [11, 12]];
      for (const [px, py] of plants) {
        if (n === 0) { set(px, py, leaf[1]); set(px + 1, py - 1, leaf[2]); continue; }
        const r = n === 1 ? 1.6 : n === 2 ? 2.6 : 3.2;
        for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
          if (Math.hypot(x, y) > r + (H(x + px, y + py, 4) - 0.5)) continue;
          set(px + x, py + y, leaf[Math.max(0, Math.min(2, Math.round(1 - (x + y) / 4)))]);
        }
        if (n === 3) { set(px - 1, py - 2, [240, 236, 250]); set(px + 2, py, [200, 160, 230]); set(px + 1, py + 3, [216, 176, 100]); }
      }
    }, 0), [30, 60, 26], 255);
    S.crop = [stage(0), stage(1), stage(2), stage(3)];
  }

  // ============ IKONY OZNAČENÍ ============
  function makeDes() {
    S.des.chop = outline(paint(9, 9, (set) => {
      for (let k = 0; k < 7; k++) set(1 + k, 7 - k, [150, 100, 56]);
      for (let y = 1; y < 5; y++) for (let x = 4; x < 8; x++) if (x - y < 5 && x + y > 5) set(x, y, [210, 214, 224]);
    }));
    S.des.mine = outline(paint(9, 9, (set) => {
      for (let k = 0; k < 7; k++) set(1 + k, 7 - k, [150, 100, 56]);
      for (let k = 0; k < 7; k++) set(1 + k, 1 + Math.abs(k - 3) * 0.5, [200, 204, 214]);
    }));
    S.des.harvest = outline(paint(9, 9, (set) => {
      for (let y = 4; y < 8; y++) for (let x = 1; x < 8; x++) set(x, y, (x + y) % 2 ? [190, 140, 70] : [160, 110, 50]);
      set(3, 3, [200, 40, 60]); set(5, 3, [200, 40, 60]); set(4, 2, [220, 60, 80]);
    }));
    S.des.decon = outline(paint(9, 9, (set) => {
      for (let k = 0; k < 7; k++) { set(1 + k, 1 + k, [230, 70, 60]); set(7 - k, 1 + k, [230, 70, 60]); }
    }));
  }

  // ============ KOLONISTÉ ============
  function colonist(look) {
    const out = {};
    const skin = look.skin, skinD = U.shade(look.skin, 0.82);
    const hair = look.hair, hairL = U.shade(look.hair, 1.3);
    const shirt = look.shirt, shirtD = U.shade(look.shirt, 0.75), shirtL = U.shade(look.shirt, 1.18);
    const pants = look.pants, boots = [44, 34, 28];
    const eye = [30, 24, 30];
    for (const dir of ['down', 'up', 'left', 'right']) {
      out[dir] = [];
      for (let f = 0; f < 3; f++) {
        out[dir].push(outline(paint(16, 16, (set, get, rect) => {
          const side = dir === 'left' || dir === 'right';
          const flip = dir === 'left';
          const X = (x) => flip ? 15 - x : x;
          // nohy
          let lA = 0, lB = 0;
          if (f === 1) { lA = -1; lB = 0; } else if (f === 2) { lA = 0; lB = -1; }
          if (!side) {
            rect(6, 12, 2, 2 + lA, pants); set(6, 14 + lA, boots); set(7, 14 + lA, boots);
            rect(8, 12, 2, 2 + lB, pants); set(8, 14 + lB, boots); set(9, 14 + lB, boots);
          } else {
            const o1 = f === 1 ? 1 : f === 2 ? -1 : 0;
            rect(X(7 + o1) - (flip ? 1 : 0), 12, 2, 2, pants); set(X(7 + o1), 14, boots); set(X(8 + o1), 14, boots);
            rect(X(7 - o1) - (flip ? 1 : 0), 12, 2, 2, U.shade(pants, 0.85)); set(X(7 - o1), 14, boots); set(X(8 - o1), 14, boots);
          }
          // tělo
          rect(5, 8, 6, 4, shirt);
          for (let y = 8; y < 12; y++) { set(X(10), y, shirtD); set(X(5), y, side ? shirt : shirtL); }
          rect(5, 11, 6, 1, U.shade(pants, 0.7)); // opasek
          // ruce
          if (!side) {
            const sw = f === 0 ? 0 : (f === 1 ? -1 : 1);
            rect(4, 8 + Math.max(0, sw), 1, 3, shirtD); set(4, 11 + Math.max(0, sw), skin);
            rect(11, 8 + Math.max(0, -sw), 1, 3, shirtD); set(11, 11 + Math.max(0, -sw), skin);
          } else {
            const sw = f === 1 ? 1 : f === 2 ? -1 : 0;
            rect(X(8 + sw), 9, 1, 2, shirtD); set(X(8 + sw), 11, skin);
          }
          // hlava
          rect(4, 1, 8, 7, skin);
          for (let y = 1; y < 8; y++) set(X(11), y, skinD);
          // vlasy
          const style = look.style;
          if (style !== 'bald') {
            rect(4, 0, 8, 2, hair);
            rect(4, 0, 8, 1, hairL);
            if (dir === 'up') rect(4, 0, 8, 7, hair);
            else if (side) { rect(X(10) - (flip ? 0 : 0), 1, 2, 4, hair); set(X(9), 2, hair); }
            else { set(4, 2, hair); set(11, 2, hair); }
            if (style === 'long') {
              if (dir === 'up') { rect(3, 1, 10, 7, hair); rect(5, 8, 6, 1, hair); }
              else if (side) rect(X(11) - (flip ? 0 : 1), 2, 2, 7, hair);
              else { rect(3, 2, 1, 7, hair); rect(12, 2, 1, 7, hair); rect(4, 2, 1, 4, hair); rect(11, 2, 1, 4, hair); }
            } else if (style === 'bun') {
              rect(6, -1 + 1, 4, 1, hairL);
              if (dir === 'up' || side) rect(side ? X(11) - (flip ? 0 : 1) : 6, 1, 3, 3, hair);
            } else if (style === 'spiky') {
              set(5, 0, hairL); set(7, 0, hairL); set(9, 0, hairL); set(11, 1, hair);
            } else if (style === 'beard' && dir !== 'up') {
              if (side) { rect(X(5) - (flip ? 1 : 0), 5, 3, 3, hair); }
              else { rect(5, 6, 6, 2, hair); set(4, 5, hair); set(11, 5, hair); }
            }
          } else {
            set(5, 1, U.shade(skin, 1.08)); set(6, 1, U.shade(skin, 1.08));
          }
          // obličej
          if (dir === 'down') {
            set(6, 4, eye); set(9, 4, eye);
            set(6, 3, U.shade(skin, 1.05)); set(5, 5, [230, 140, 130], 120); set(10, 5, [230, 140, 130], 120);
            if (style !== 'beard') set(7, 6, skinD), set(8, 6, skinD);
          } else if (side) {
            set(X(5), 4, eye);
            set(X(3), 4, skin); // nos
          }
        })));
      }
    }
    return out;
  }
  function portrait(spr) {
    const c = canvas(12, 10);
    const g = c.getContext('2d');
    g.drawImage(spr.down[0], 2, 0, 12, 10, 0, 0, 12, 10);
    return c;
  }

  // ============ ZVĚŘ ============
  function makeAnimals() {
    // čtyřnožec z boku; `o` = barvy a rozměry
    const quad = (o) => (f, flip) => outline(paint(16, 14, (set, get, rect) => {
      const X = (x) => flip ? 15 - x : x;
      const R = (x, y, w, h, c) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(X(xx), yy, c); };
      const [bx, by, bw, bh] = o.body;
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
        const dx = (x - bx - bw / 2 + 0.5) / (bw / 2), dy = (y - by - bh / 2 + 0.5) / (bh / 2);
        if (dx * dx + dy * dy <= 1.05) set(X(x), y, dy < -0.3 ? o.light : dy > 0.4 ? o.dark : (o.fluff && H(x, y, 9) > 0.7 ? o.dark : o.col));
      }
      R(o.head[0], o.head[1], o.head[2], o.head[3], o.headCol || o.col);
      set(X(o.head[0] + 1), o.head[1] + 1, [20, 16, 16]);
      if (o.extra) o.extra(set, X, R);
      const l1 = f ? 0 : 1, l2 = f ? 1 : 0, ly = by + bh - 1, ll = o.leg;
      R(bx + 1, ly, 1, ll - l1, o.dark); R(bx + 3, ly, 1, ll - l2, o.dark);
      R(bx + bw - 4, ly, 1, ll - l2, o.dark); R(bx + bw - 2, ly, 1, ll - l1, o.dark);
    }));
    const mk = (fn) => ({ left: [fn(0, false), fn(1, false)], right: [fn(0, true), fn(1, true)] });
    const boar = quad({ body: [3, 4, 10, 6], head: [1, 6, 3, 3], col: [96, 72, 56], dark: [70, 52, 40], light: [124, 96, 76], leg: 3,
      extra: (set, X) => { for (let x = 4; x < 11; x += 2) set(X(x), 3, [70, 52, 40]); set(X(0), 7, [200, 150, 140]); set(X(1), 9, [236, 230, 214]); } });
    const deer = quad({ body: [4, 4, 9, 5], head: [1, 2, 3, 3], col: [168, 118, 70], dark: [124, 84, 48], light: [198, 150, 98], leg: 5,
      extra: (set, X, R) => { R(3, 4, 2, 2, [168, 118, 70]); set(X(2), 0, [226, 214, 190]); set(X(3), 1, [226, 214, 190]); set(X(1), 1, [226, 214, 190]); set(X(13), 5, [240, 236, 226]); } });
    const sheep = quad({ body: [3, 3, 10, 7], head: [1, 5, 3, 3], col: [236, 234, 226], dark: [200, 198, 190], light: [252, 250, 244], headCol: [70, 62, 58], leg: 3, fluff: true });
    const chicken = (f, flip) => outline(paint(10, 10, (set, get, rect) => {
      const X = (x) => flip ? 9 - x : x;
      for (let y = 3; y < 8; y++) for (let x = 2; x < 8; x++) if (Math.hypot(x - 4.5, (y - 5) * 1.2) < 3) set(X(x), y, y < 5 ? [250, 246, 236] : [222, 214, 196]);
      set(X(2), 2, [250, 246, 236]); set(X(2), 3, [250, 246, 236]); set(X(1), 3, [236, 170, 60]); set(X(2), 1, [210, 50, 50]);
      set(X(8), 3, [222, 214, 196]); set(X(8), 4, [222, 214, 196]);
      set(X(4), 8 + (f ? 0 : 0), [236, 170, 60]); if (!f) set(X(5), 8, [236, 170, 60]); else set(X(3), 8, [236, 170, 60]);
    }));
    S.animals = { boar: mk(boar), deer: mk(deer), sheep: mk(sheep), chicken: mk(chicken) };
  }

  // ============ IKONY NÁSTROJŮ ============
  function makeIcons() {
    const I = S.icons;
    I.select = outline(paint(16, 16, (set) => {
      for (let y = 1; y < 13; y++) for (let x = 3; x < 3 + Math.min(y, 8); x++) set(x, y, [240, 240, 240]);
      for (let y = 9; y < 15; y++) { set(7 + ((y - 9) >> 1), y, [240, 240, 240]); set(8 + ((y - 9) >> 1), y, [240, 240, 240]); }
    }));
    const big = (src) => { const c = canvas(16, 16); const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, src.width, src.height, 0, 0, 16, 16); return c; };
    I.chop = big(S.des.chop);
    I.mine = big(S.des.mine);
    I.harvest = big(S.des.harvest);
    I.decon = outline(paint(16, 16, (set, get, rect) => {
      for (let k = 0; k < 10; k++) { set(3 + k, 13 - k, [150, 100, 56]); set(4 + k, 13 - k, [120, 80, 44]); }
      rect(9, 2, 6, 4, [170, 174, 184]); rect(9, 2, 6, 1, [220, 224, 232]);
    }));
    I.cancel = outline(paint(16, 16, (set) => {
      for (let k = 0; k < 11; k++) for (let t = 0; t < 2; t++) { set(2 + k + t, 2 + k, [230, 70, 60]); set(13 - k + t, 2 + k, [230, 70, 60]); }
    }));
    for (const k in BUILD) I[k] = S.build[k];
    I.wall_wood = S.build.wall_wood; I.wall_stone = S.build.wall_stone;
    I.belt = canvas(16, 16);
    { const g = I.belt.getContext('2d'); g.drawImage(S.build.belt, 0, 0); g.drawImage(S.beltArrow[0], 0, 0); }
    I.zone_stock = outline(paint(16, 16, (set, get, rect) => {
      rect(2, 4, 12, 10, [160, 112, 60]);
      rect(2, 4, 12, 1, [200, 150, 90]);
      for (let k = 0; k < 10; k++) { set(3 + k, 5 + k * 0.85, [110, 72, 38]); }
      rect(2, 8, 12, 1, [120, 80, 44]);
    }));
    I.zone_farm = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 11, 14, 4, [96, 66, 40]);
      rect(1, 12, 14, 1, [70, 48, 30]);
      for (let y = 4; y < 11; y++) set(8, y, [70, 140, 60]);
      for (let k = 0; k < 4; k++) { set(7 - k, 7 - k * 0.5, [96, 170, 70]); set(9 + k, 6 - k * 0.5, [96, 170, 70]); }
    }));
    I.zone_clear = outline(paint(16, 16, (set, get, rect) => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 9; x++) set(3 + x + y, 3 + y, x < 4 ? [230, 120, 140] : [240, 240, 240]);
    }));
    I.priorities = outline(paint(16, 16, (set, get, rect) => {
      for (let r = 0; r < 4; r++) { rect(2, 2 + r * 3, 3, 2, [230, 200, 90]); rect(6, 2 + r * 3, 8, 2, [220, 220, 220]); }
    }));
    I.hunt = outline(paint(16, 16, (set, get, rect) => {
      for (let k = 0; k < 12; k++) { set(2 + k, 13 - k, [150, 100, 56]); set(3 + k, 13 - k, [120, 80, 44]); }
      rect(11, 1, 4, 2, [210, 214, 224]); rect(13, 1, 2, 4, [210, 214, 224]); set(12, 3, [210, 214, 224]);
    }));
    I.parts = S.items.parts; I.herbs = S.items.herbs; I.medicine = S.items.medicine;
    I.zone_pasture = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 11, 14, 4, [96, 150, 70]); rect(1, 11, 14, 1, [126, 180, 90]);
      for (const x of [2, 7, 12]) { rect(x, 5, 2, 8, [176, 126, 74]); set(x, 5, [206, 158, 100]); }
      rect(1, 7, 14, 1, [150, 104, 60]); rect(1, 10, 14, 1, [150, 104, 60]);
    }));
    I.pollution_btn = outline(paint(16, 16, (set) => {
      for (const [cx, cy, r] of [[5, 10, 3.4], [10, 9, 4], [8, 5, 3]]) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        if (Math.hypot(x, y) <= r) set(cx + x, cy + y, x + y < 0 ? [150, 110, 160] : [110, 76, 124]);
      }
    }));
    I.trade_btn = outline(paint(16, 16, (set, get, rect) => {
      rect(2, 5, 11, 6, [176, 126, 74]); rect(2, 5, 11, 1, [206, 158, 100]); rect(2, 10, 11, 1, [116, 78, 44]);
      rect(4, 2, 7, 3, [220, 190, 110]);
      for (const cx of [4, 11]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (Math.hypot(x, y) < 2.4) set(cx + x, 12 + y, Math.hypot(x, y) < 1 ? [200, 200, 200] : [60, 50, 44]);
    }));
    I.research_btn = outline(paint(16, 16, (set, get, rect) => {
      rect(6, 1, 4, 5, [200, 220, 236]); rect(5, 1, 6, 1, [150, 170, 190]);
      for (let y = 6; y < 14; y++) { const w = 2 + (y - 6) * 0.75; rect(8 - w, y, w * 2, 1, y > 9 ? [90, 190, 120] : [200, 220, 236]); }
      set(7, 11, [200, 240, 210]); set(9, 12, [200, 240, 210]);
    }));
    I.power_btn = outline(paint(16, 16, (set) => {
      const pts = [[9, 1], [8, 2], [7, 3], [6, 4], [5, 5], [4, 6], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [8, 8], [7, 9], [6, 10], [5, 11], [4, 12], [3, 13]];
      for (const [x, y] of pts) { set(x, y, [255, 220, 80]); set(x + 1, y, [255, 240, 150]); set(x + 2, y, [230, 180, 50]); }
    }));
    I.overview = outline(paint(16, 16, (set, get, rect) => {
      rect(1, 2, 14, 12, [60, 110, 70]); rect(1, 2, 14, 1, [90, 150, 100]);
      rect(2, 8, 5, 5, [50, 90, 150]); rect(9, 3, 5, 4, [130, 126, 120]);
      rect(7, 6, 2, 2, [255, 220, 90]); rect(11, 10, 2, 2, [255, 220, 90]);
    }));
    I.menu = outline(paint(16, 16, (set, get, rect) => {
      rect(2, 3, 12, 2, [230, 230, 230]); rect(2, 7, 12, 2, [230, 230, 230]); rect(2, 11, 12, 2, [230, 230, 230]);
    }));
  }

  function init() {
    S.trees = [makeTree(11, 'oak'), makeTree(42, 'oak'), makeTree(77, 'oak'), makeTree(5, 'pine'), makeTree(93, 'pine')];
    S.bush = makeBush(true);
    S.bushEmpty = makeBush(false);
    S.rocks = [makeRock(1, false), makeRock(2, false), makeRock(3, false), makeRock(4, false)];
    S.ores = [makeRock(5, true), makeRock(6, true), makeRock(7, true)];
    makeItems();
    makeBuild();
    makeCrops();
    makeDes();
    makeAnimals();
    makeIcons();
  }

  function toURL(c, scale = 3) {
    const big = canvas(c.width * scale, c.height * scale);
    const g = big.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0, big.width, big.height);
    return big.toDataURL();
  }

  /** Sprite nájezdníka (tmavá kápě). */
  S.raider = () => S._raider || (S._raider = colonist({ skin: [214, 170, 130], hair: [40, 20, 20], shirt: [120, 30, 30], pants: [40, 36, 40], style: 'long' }));
  S.init = init;
  S.buildTerrain = buildTerrain;
  S.colonist = colonist;
  S.portrait = portrait;
  S.toURL = toURL;
  return S;
})();
