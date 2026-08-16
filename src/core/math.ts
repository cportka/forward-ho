/** Small, allocation-free math helpers used all over the game. */

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function remap(v: number, a: number, b: number, c: number, d: number): number {
  return lerp(c, d, clamp01(invLerp(a, b, v)));
}

/** Frame-rate independent exponential smoothing. `rate` is roughly "per second". */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

export function easeInQuad(t: number): number {
  const x = clamp01(t);
  return x * x;
}

export function sign(v: number): number {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

export function approach(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + sign(d) * maxDelta;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Wraps `v` into [0, m). */
export function wrap(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

/** Deterministic value noise in 1D — cheap, smooth, no allocations. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i, seed), hash1(i + 1, seed), u);
}

/** Deterministic hash → [0,1). */
export function hash1(i: number, seed = 0): number {
  let h = (i | 0) * 374761393 + (seed | 0) * 668265263;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}

/** Deterministic 2D hash → [0,1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}

/** Formats large numbers the way idle/runner games do: 1.2K, 4.5M. */
export function formatCount(n: number): string {
  const v = Math.floor(n);
  if (v < 1000) return String(v);
  if (v < 1_000_000) {
    const k = v / 1000;
    return (k < 10 ? k.toFixed(1) : Math.floor(k).toString()) + 'K';
  }
  const m = v / 1_000_000;
  return (m < 10 ? m.toFixed(1) : Math.floor(m).toString()) + 'M';
}
