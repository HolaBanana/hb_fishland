'use strict';
/**
 * Input – dotykové ovládání a myš:
 *  - 1 prst / levé tlačítko: s nástrojem "Výběr" posun mapy a klepnutí = výběr,
 *                            s jiným nástrojem tažení = výběr oblasti
 *  - 2 prsty: posun + zoom (pinch)
 *  - pravé / prostřední tlačítko: posun, kolečko: zoom
 *  - klávesy: mezerník pauza, 1/2/3 rychlost, WASD/šipky posun, Esc zrušit nástroj
 */
const Input = {
  pointers: new Map(),
  gesture: null,          // {type:'pending'|'pan'|'drag'|'pinch'|'dead', ...}
  drag: null,             // aktuální výběr oblasti {x0,y0,x1,y1}
  hover: null,            // políčko pod kurzorem (myš)
  keys: new Set(),

  init(cv) {
    this.cv = cv;
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e));
    cv.addEventListener('pointercancel', e => this.up(e, true));
    cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.hover = null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      Camera.setZoom(Camera.zoom * f, e.clientX, e.clientY);
    }, { passive: false });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    // zabránit nativnímu zoomu stránky na iOS
    document.addEventListener('gesturestart', e => e.preventDefault());
  },

  down(e) {
    this.cv.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (this.pointers.size === 1) {
      const pan = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2);
      this.gesture = { type: pan ? 'pan' : 'pending', sx: e.clientX, sy: e.clientY, t: performance.now() };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = null;
      this.gesture = {
        type: 'pinch',
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        z0: Camera.zoom,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
      };
    }
  },

  move(e) {
    if (e.pointerType === 'mouse') this.hover = Camera.screenToTile(e.clientX, e.clientY);
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      Camera.pan(mx - g.mx, my - g.my);
      Camera.setZoom(g.z0 * d / g.d0, mx, my);
      g.mx = mx; g.my = my;
      return;
    }
    if (g.type === 'pending') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) {
        if (Game.tool === 'select') g.type = 'pan';
        else {
          g.type = 'drag';
          const t = Camera.screenToTile(g.sx, g.sy);
          this.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y };
        }
      }
    }
    if (g.type === 'pan') Camera.pan(e.clientX - px, e.clientY - py);
    if (g.type === 'drag') {
      const t = Camera.screenToTile(e.clientX, e.clientY);
      this.drag.x1 = t.x; this.drag.y1 = t.y;
      this.edgeScroll(e.clientX, e.clientY);
    }
  },

  /** Při tažení výběru u okraje obrazovky posouvat kameru. */
  edgeScroll(x, y) {
    const m = 30, s = 6;
    let dx = 0, dy = 0;
    if (x < m) dx = s; else if (x > Camera.vw - m) dx = -s;
    if (y < m + 40) dy = s; else if (y > Camera.vh - m - 120) dy = -s;
    if (dx || dy) Camera.pan(dx, dy);
  },

  up(e, cancelled) {
    const g = this.gesture;
    this.pointers.delete(e.pointerId);
    if (!g) return;
    if (g.type === 'pinch') {
      // po pinchi ignorovat zbývající prst, dokud se nezvednou všechny
      if (this.pointers.size > 0) { this.gesture = { type: 'dead' }; return; }
    }
    if (this.pointers.size > 0) return;
    if (!cancelled) {
      if (g.type === 'pending') this.tap(e.clientX, e.clientY);
      else if (g.type === 'drag' && this.drag) {
        const d = this.drag;
        const tiles = Tools.tilesFor(Game.tool, d.x0, d.y0, d.x1, d.y1);
        Tools.apply(Game.tool, tiles);
      }
    }
    this.drag = null;
    this.gesture = null;
  },

  tap(sx, sy) {
    const t = Camera.screenToTile(sx, sy);
    if (Game.tool !== 'select') {
      Tools.apply(Game.tool, Tools.tilesFor(Game.tool, t.x, t.y, t.x, t.y));
      return;
    }
    // výběr kolonisty (podle světové pozice, s tolerancí)
    const w = Camera.screenToWorld(sx, sy);
    let best = null, bd = 0.9;
    for (const c of Game.colonists) {
      const d = Math.hypot(w.x / Config.TILE - c.x, w.y / Config.TILE - (c.y - 0.35));
      if (d < bd) { bd = d; best = c; }
    }
    if (best) Game.select({ type: 'colonist', c: best });
    else if (World.inb(t.x, t.y)) Game.select({ type: 'tile', x: t.x, y: t.y });
    else Game.select(null);
  },

  key(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (down) {
      this.keys.add(k);
      if (k === ' ') { e.preventDefault(); Game.togglePause(); }
      else if (k === '1' || k === '2' || k === '3') Game.setSpeed(+k);
      else if (k === 'escape') { if (Game.tool !== 'select') UI.setTool('select'); else Game.select(null); }
      else if (k === '+' || k === '=') Camera.setZoom(Camera.zoom * 1.2);
      else if (k === '-') Camera.setZoom(Camera.zoom / 1.2);
    } else this.keys.delete(k);
  },

  update(dt) {
    const s = 600 * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx += s;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx -= s;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += s;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= s;
    if (dx || dy) Camera.pan(dx, dy);
  },
};
