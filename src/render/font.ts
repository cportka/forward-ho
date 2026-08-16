/**
 * A 5x7 pixel font, baked through the same sprite pipeline as everything else
 * so text gets the exact same crisp block quantisation as the art.
 */

import { defineSprite, type SpriteDef } from './sprite';
import type { Painter } from './pixelbuffer';

const GLYPHS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['..#..', '.#.#.', '#...#', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '*': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '#.##.', '..##.'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
  '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '#####', '.#.#.', '.....'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '[': ['..##.', '..#..', '..#..', '..#..', '..#..', '..#..', '..##.'],
  ']': ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.##..'],
  '^': ['..#..', '.#.#.', '#...#', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
};

export const FONT_H = 7;

interface Glyph {
  sprite: SpriteDef | null;
  /** Width of the inked area, in font pixels. */
  w: number;
  /** Left trim already applied when baking. */
  advance: number;
}

const cacheNormal = new Map<string, Glyph>();
const cacheBold = new Map<string, Glyph>();

function trimRows(rows: string[]): { rows: string[]; w: number } {
  let min = 99;
  let max = -1;
  for (const r of rows) {
    for (let x = 0; x < r.length; x++) {
      if (r[x] === '#') {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  if (max < 0) return { rows: [], w: 0 };
  const out = rows.map((r) => r.slice(min, max + 1).padEnd(max - min + 1, '.'));
  return { rows: out, w: max - min + 1 };
}

function embolden(rows: string[]): string[] {
  return rows.map((r) => {
    let out = '';
    for (let x = 0; x < r.length + 1; x++) {
      const a = r[x] === '#';
      const b = x > 0 && r[x - 1] === '#';
      out += a || b ? '#' : '.';
    }
    return out;
  });
}

function glyphFor(ch: string, bold: boolean): Glyph {
  const cache = bold ? cacheBold : cacheNormal;
  const hit = cache.get(ch);
  if (hit) return hit;

  const src = GLYPHS[ch];
  if (!src) {
    const g: Glyph = { sprite: null, w: 3, advance: 3 };
    cache.set(ch, g);
    return g;
  }
  const shaped = bold ? embolden(src) : src;
  const { rows, w } = trimRows(shaped);
  if (w === 0) {
    const g: Glyph = { sprite: null, w: 3, advance: 3 };
    cache.set(ch, g);
    return g;
  }
  const sprite = defineSprite(`f${bold ? 'b' : 'n'}_${ch.charCodeAt(0)}`, rows, { '#': '#ffffff' }, {
    ax: 0,
    ay: 0,
  });
  const g: Glyph = { sprite, w, advance: w };
  cache.set(ch, g);
  return g;
}

export interface TextOptions {
  color?: string;
  /** Outline thickness in font pixels (0 = none). */
  outline?: number;
  outlineColor?: string;
  /** Drop shadow offset in font pixels. */
  shadow?: number;
  shadowColor?: string;
  /** 'left' | 'center' | 'right' */
  align?: 'left' | 'center' | 'right';
  /** Spacing between glyphs, in font pixels. */
  tracking?: number;
  bold?: boolean;
  /** Force all glyphs onto the same advance — good for counters. */
  mono?: boolean;
  alpha?: number;
}

/** Width of `text` in device pixels when rendered at the given pixel size. */
export function measureText(text: string, px: number, opts: TextOptions = {}): number {
  const bold = opts.bold ?? false;
  const tracking = opts.tracking ?? 1;
  const mono = opts.mono ?? false;
  const monoW = bold ? 6 : 5;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toUpperCase();
    if (ch === ' ') {
      w += (mono ? monoW : 3) + tracking;
      continue;
    }
    const g = glyphFor(ch, bold);
    w += (mono ? monoW : g.advance) + tracking;
  }
  return Math.max(0, w - tracking) * px;
}

/**
 * Draws text with `px` device pixels per font pixel. (x, y) is the top-left of
 * the text block unless `align` says otherwise.
 */
export function drawText(
  p: Painter,
  text: string,
  x: number,
  y: number,
  px: number,
  opts: TextOptions = {},
): number {
  const bold = opts.bold ?? false;
  const tracking = opts.tracking ?? 1;
  const mono = opts.mono ?? false;
  const monoW = bold ? 6 : 5;
  const color = opts.color ?? '#ffffff';
  const total = measureText(text, px, opts);

  let cx = x;
  if (opts.align === 'center') cx = x - total / 2;
  else if (opts.align === 'right') cx = x - total;

  const outline = opts.outline ?? 0;
  const outlineColor = opts.outlineColor ?? '#000000';
  const shadow = opts.shadow ?? 0;
  const shadowColor = opts.shadowColor ?? 'rgba(0,0,0,0.55)';

  const pass = (dx: number, dy: number, col: string, alpha: number) => {
    let gx = cx + dx;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i].toUpperCase();
      if (ch === ' ') {
        gx += ((mono ? monoW : 3) + tracking) * px;
        continue;
      }
      const g = glyphFor(ch, bold);
      const adv = mono ? monoW : g.advance;
      if (g.sprite) {
        const off = mono ? ((monoW - g.w) / 2) * px : 0;
        p.sprite(g.sprite, gx + off, y + dy, FONT_H * px, {
          tint: col,
          variant: col,
          alpha,
        });
      }
      gx += (adv + tracking) * px;
    }
  };

  const alpha = opts.alpha ?? 1;
  if (shadow > 0) pass(shadow * px, shadow * px, shadowColor, alpha);
  if (outline > 0) {
    const t = outline * px;
    pass(-t, 0, outlineColor, alpha);
    pass(t, 0, outlineColor, alpha);
    pass(0, -t, outlineColor, alpha);
    pass(0, t, outlineColor, alpha);
    pass(-t, -t, outlineColor, alpha);
    pass(t, -t, outlineColor, alpha);
    pass(-t, t, outlineColor, alpha);
    pass(t, t, outlineColor, alpha);
  }
  pass(0, 0, color, alpha);
  return total;
}
