// Velmora Bay — shared helpers: a seeded random generator, small math
// utilities and a canvas-texture factory. Nothing here knows about the
// game itself; every other module builds on these pieces.

/** A tiny deterministic PRNG (mulberry32). Same seed, same stream. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small random helper wrapped around a mulberry32 stream. */
export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  /** Float in [0, 1). */
  float() {
    return this.next();
  }
  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }
  /** Integer in [min, max] (inclusive). */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
  /** A random element of an array. */
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest-arc interpolation between two angles, in radians. */
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Distance on the ground plane between two points. */
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Forward vector for a heading angle (rotation.y convention: +Z at 0). */
export function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/**
 * Build a THREE.CanvasTexture from a drawing callback. The canvas is
 * never added to the page; the texture is all the game keeps.
 */
export function canvasTexture(THREE, width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Format a cash amount as "$ 1,250". */
export function money(n) {
  return '$ ' + Math.floor(n).toLocaleString('en-US');
}

/** Format in-game minutes since midnight as "14:32". */
export function clockText(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
