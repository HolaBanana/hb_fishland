'use strict';
/**
 * Camera – pozice (střed ve světových pixelech) a přiblížení.
 */
const Camera = {
  x: 0, y: 0, zoom: Config.ZOOM_DEFAULT,
  vw: 800, vh: 600,
  follow: null,

  resize(w, h) { this.vw = w; this.vh = h; this.clamp(); },
  centerOn(wx, wy) { this.x = wx; this.y = wy; this.clamp(); },
  centerTile(tx, ty) { this.centerOn((tx + 0.5) * Config.TILE, (ty + 0.5) * Config.TILE); },
  screenToWorld(sx, sy) {
    return { x: (sx - this.vw / 2) / this.zoom + this.x, y: (sy - this.vh / 2) / this.zoom + this.y };
  },
  screenToTile(sx, sy) {
    const p = this.screenToWorld(sx, sy);
    return { x: Math.floor(p.x / Config.TILE), y: Math.floor(p.y / Config.TILE) };
  },
  worldToScreen(wx, wy) {
    return { x: (wx - this.x) * this.zoom + this.vw / 2, y: (wy - this.y) * this.zoom + this.vh / 2 };
  },
  pan(dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.follow = null;
    this.clamp();
  },
  setZoom(z, sx = this.vw / 2, sy = this.vh / 2) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = U.clamp(z, this.minZoom(), Config.ZOOM_MAX);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  },
  minZoom() {
    // nedovolit oddálit tak, aby byla mapa menší než obrazovka
    const mw = World.w * Config.TILE, mh = World.h * Config.TILE;
    return Math.max(Config.ZOOM_MIN * 0.6, this.vw / mw, this.vh / mh, 0.5);
  },
  clamp() {
    if (!World.w) return;
    const mw = World.w * Config.TILE, mh = World.h * Config.TILE;
    const hw = this.vw / 2 / this.zoom, hh = this.vh / 2 / this.zoom;
    this.x = hw * 2 >= mw ? mw / 2 : U.clamp(this.x, hw, mw - hw);
    this.y = hh * 2 >= mh ? mh / 2 : U.clamp(this.y, hh - 60 / this.zoom, mh - hh + 140 / this.zoom);
  },
  update() {
    if (this.follow) {
      const c = this.follow;
      const tx = c.x * Config.TILE, ty = c.y * Config.TILE;
      this.x += (tx - this.x) * 0.12;
      this.y += (ty - this.y) * 0.12;
      this.clamp();
    }
  },
};
