'use strict';
/**
 * Utils – pomocné funkce: deterministický generátor náhody, šum, barvy, matematika.
 */
const U = (() => {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = mulberry32(1234567);

  function hash2(x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function noise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  }
  function fbm(x, y, seed, oct = 4) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += noise(x * freq, y * freq, seed + i * 1013) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  return {
    seed(s) { rng = mulberry32(s); },
    rand() { return rng(); },
    range(a, b) { return a + rng() * (b - a); },
    int(a, b) { return a + Math.floor(rng() * (b - a + 1)); },
    pick(arr) { return arr[Math.floor(rng() * arr.length)]; },
    chance(p) { return rng() < p; },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); },
    hash2, noise, fbm,
    hex(h) {
      const n = parseInt(h.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    rgb(c, a) {
      return a === undefined
        ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
        : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
    },
    shade(c, f) {
      return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
    },
    mix(a, b, t) {
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    },
    pad2(n) { return (n < 10 ? '0' : '') + n; },
  };
})();
