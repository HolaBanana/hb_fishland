'use strict';
/**
 * Pathfinder – A* na mřížce s 8 směry, binární haldou a znovupoužitelnými typed-arrays.
 * mode: 0 = přesně na cíl, 1 = na cíl nebo vedle něj, 2 = pouze vedle cíle (cíl je neprůchodný / staví se na něm)
 */
const Pathfinder = (() => {
  let w = 0, h = 0;
  let g, parent, closed, seen;
  let gen = 0;
  const heapI = [], heapF = [];
  const MAX_EXPANDED = 40000;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let stats = { calls: 0, expanded: 0 };

  function init(W, H) {
    w = W; h = H;
    const n = w * h;
    g = new Float32Array(n);
    parent = new Int32Array(n);
    closed = new Uint32Array(n);
    seen = new Uint32Array(n);
  }

  function push(i, f) {
    let k = heapI.length;
    heapI.push(i); heapF.push(f);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= f) break;
      heapI[k] = heapI[p]; heapF[k] = heapF[p];
      k = p;
    }
    heapI[k] = i; heapF[k] = f;
  }
  function pop() {
    const top = heapI[0];
    const li = heapI.pop(), lf = heapF.pop();
    const len = heapI.length;
    if (len > 0) {
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k, mf = lf;
        if (l < len && heapF[l] < mf) { m = l; mf = heapF[l]; }
        if (r < len && heapF[r] < mf) { m = r; mf = heapF[r]; }
        if (m === k) break;
        heapI[k] = heapI[m]; heapF[k] = heapF[m];
        k = m;
      }
      heapI[k] = li; heapF[k] = lf;
    }
    return top;
  }

  function find(sx, sy, tx, ty, mode = 0) {
    stats.calls++;
    const W = World.walk, C = World.cost;
    if (!World.inb(tx, ty)) return null;
    if (mode === 0 && !W[ty * w + tx]) return null;
    gen++;
    heapI.length = 0; heapF.length = 0;

    const isGoal = (x, y) => {
      if (mode === 0) return x === tx && y === ty;
      const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
      if (dx > 1 || dy > 1) return false;
      return !(mode === 2 && dx === 0 && dy === 0);
    };
    const heur = (x, y) => {
      const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
      let d = Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
      if (mode !== 0) d = Math.max(0, d - 1);
      return d * 0.75;
    };

    const s = sy * w + sx;
    g[s] = 0; seen[s] = gen; parent[s] = -1;
    push(s, heur(sx, sy));
    let expanded = 0;

    while (heapI.length) {
      const i = pop();
      if (closed[i] === gen) continue;
      closed[i] = gen;
      const x = i % w, y = (i / w) | 0;
      if (isGoal(x, y)) {
        const path = [];
        let k = i;
        while (k !== s && k !== -1) { path.push(k); k = parent[k]; }
        path.reverse();
        stats.expanded += expanded;
        return path;
      }
      if (++expanded > MAX_EXPANDED) break;
      const gi = g[i], ci = C[i];
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0], dy = DIRS[d][1];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!W[ni] || closed[ni] === gen) continue;
        let step;
        if (dx !== 0 && dy !== 0) {
          // žádné řezání rohů přes překážky
          if (!W[y * w + nx] || !W[ny * w + x]) continue;
          step = 1.4142 * (ci + C[ni]) * 0.5;
        } else step = (ci + C[ni]) * 0.5;
        const ng = gi + step;
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen; g[ni] = ng; parent[ni] = i;
          push(ni, ng + heur(nx, ny));
        }
      }
    }
    stats.expanded += expanded;
    return null;
  }

  return { init, find, stats };
})();
