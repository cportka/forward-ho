/** Deterministic, seedable PRNG (mulberry32). Level layouts are reproducible from a seed. */
export class Rng {
  private s: number;

  constructor(seed = 0x1a2b3c4d) {
    this.s = seed >>> 0 || 1;
  }

  static fromString(str: string): Rng {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return new Rng(h);
  }

  /** [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [lo, hi) */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Symmetric noise in [-a, a]. */
  sym(a = 1): number {
    return (this.next() * 2 - 1) * a;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  fork(salt: number): Rng {
    return new Rng((this.s ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0);
  }
}

/** Shared non-deterministic RNG for cosmetic things (particles, jitter). */
export const fx = new Rng((Math.random() * 0xffffffff) >>> 0);
