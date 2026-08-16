/**
 * Procedural pixel-art sprites.
 *
 * Sprites are authored as ASCII matrices with a colour key, then baked into
 * cached canvases at a chosen *block size* (device pixels per art pixel) and
 * *mip level* (art pixels collapsed per drawn pixel).
 *
 * That pairing is the heart of the game's look: every object picks a block
 * size appropriate to how big it currently is on screen, so its pixels are
 * always perfectly square and evenly spaced — never a smeared, non-integer
 * rescale — while different objects at different depths legitimately have
 * different pixel sizes.
 */

export interface SpriteDef {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  /** Palette index per art pixel, row-major. 0 === transparent. */
  readonly px: Uint8Array;
  /** pal[0] is unused (transparent); indices are 1-based. */
  readonly pal: readonly string[];
  /** Anchor in art-pixel space (defaults: horizontal centre, bottom). */
  readonly ax: number;
  readonly ay: number;
}

const TRANSPARENT = new Set([' ', '.', '_']);

export interface SpriteOptions {
  /** Anchor X in art pixels; default is w/2. */
  ax?: number;
  /** Anchor Y in art pixels; default is h (feet on the ground). */
  ay?: number;
}

/**
 * Builds a sprite from ASCII rows. Rows may be ragged; they are right-padded.
 * ' ', '.' and '_' are transparent.
 */
export function defineSprite(
  id: string,
  rows: readonly string[],
  key: Record<string, string>,
  opts: SpriteOptions = {},
): SpriteDef {
  const h = rows.length;
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);

  const pal: string[] = ['#00000000'];
  const idx = new Map<string, number>();
  for (const ch of Object.keys(key)) {
    pal.push(key[ch]);
    idx.set(ch, pal.length - 1);
  }

  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (TRANSPARENT.has(ch)) continue;
      const i = idx.get(ch);
      if (i === undefined) {
        throw new Error(`sprite "${id}": character "${ch}" has no colour in the key`);
      }
      px[y * w + x] = i;
    }
  }

  return {
    id,
    w,
    h,
    px,
    pal,
    ax: opts.ax ?? w / 2,
    ay: opts.ay ?? h,
  };
}

/** Produces a recoloured copy of a sprite (same shape, new palette entries). */
export function recolor(src: SpriteDef, id: string, map: Record<number, string>): SpriteDef {
  const pal = src.pal.slice();
  for (const k of Object.keys(map)) {
    const i = Number(k);
    if (i > 0 && i < pal.length) pal[i] = map[i as unknown as number];
  }
  return { ...src, id, pal };
}

/** Mirrors a sprite horizontally. */
export function flipX(src: SpriteDef, id: string): SpriteDef {
  const px = new Uint8Array(src.w * src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      px[y * src.w + x] = src.px[y * src.w + (src.w - 1 - x)];
    }
  }
  return { ...src, id, px, ax: src.w - src.ax };
}

/** Stacks sprites vertically into one taller sprite (used for banner columns). */
export function stackY(id: string, top: SpriteDef, bottom: SpriteDef): SpriteDef {
  const w = Math.max(top.w, bottom.w);
  const h = top.h + bottom.h;
  const pal = top.pal.slice();
  const offset = pal.length - 1;
  for (let i = 1; i < bottom.pal.length; i++) pal.push(bottom.pal[i]);

  const px = new Uint8Array(w * h);
  const dxTop = Math.floor((w - top.w) / 2);
  const dxBot = Math.floor((w - bottom.w) / 2);
  for (let y = 0; y < top.h; y++) {
    for (let x = 0; x < top.w; x++) px[y * w + x + dxTop] = top.px[y * top.w + x];
  }
  for (let y = 0; y < bottom.h; y++) {
    for (let x = 0; x < bottom.w; x++) {
      const v = bottom.px[y * bottom.w + x];
      px[(y + top.h) * w + x + dxBot] = v === 0 ? 0 : v + offset;
    }
  }
  return { id, w, h, px, pal, ax: w / 2, ay: h };
}

// ---------------------------------------------------------------------------
// Baking / caching
// ---------------------------------------------------------------------------

export interface BakedSprite {
  canvas: HTMLCanvasElement;
  /** Drawn width/height in device pixels. */
  w: number;
  h: number;
  /** Anchor position inside the baked canvas, in device pixels. */
  ax: number;
  ay: number;
  /** Art pixels collapsed into one drawn pixel. */
  mip: number;
  /** Device pixels per drawn pixel. */
  block: number;
}

/** Block sizes we are willing to draw at; keeps scaling from shimmering. */
const BLOCK_LADDER = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];

function quantizeBlock(v: number): number {
  if (v <= 1) return 1;
  let best = BLOCK_LADDER[0];
  let bestErr = Infinity;
  for (const b of BLOCK_LADDER) {
    const err = Math.abs(Math.log(v / b));
    if (err < bestErr) {
      bestErr = err;
      best = b;
    }
  }
  return best;
}

const cache = new Map<string, BakedSprite>();
const CACHE_LIMIT = 900;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/**
 * Bakes `sprite` so that it stands `targetH` device pixels tall.
 *
 * When the sprite would be drawn smaller than one device pixel per art pixel
 * we drop art resolution (mip) instead of squashing, which keeps distant
 * objects reading as chunky pixel clusters rather than mush.
 */
export function bakeSprite(sprite: SpriteDef, targetH: number, tint?: string, alphaKey = ''): BakedSprite {
  const ideal = targetH / sprite.h;
  let mip = 1;
  let block: number;
  if (ideal >= 1) {
    block = quantizeBlock(ideal);
  } else {
    mip = Math.max(1, Math.round(1 / ideal));
    block = 1;
  }

  const key = `${sprite.id}|${mip}|${block}|${tint ?? ''}|${alphaKey}`;
  const hit = cache.get(key);
  if (hit) {
    // refresh LRU position
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const mw = Math.max(1, Math.ceil(sprite.w / mip));
  const mh = Math.max(1, Math.ceil(sprite.h / mip));
  const canvas = makeCanvas(mw * block, mh * block);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Collapse art pixels down to the mip grid, choosing the most common
  // non-transparent colour so silhouettes survive aggressive downscaling.
  const counts = new Int32Array(sprite.pal.length);
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      counts.fill(0);
      let total = 0;
      for (let dy = 0; dy < mip; dy++) {
        const sy = my * mip + dy;
        if (sy >= sprite.h) break;
        for (let dx = 0; dx < mip; dx++) {
          const sx = mx * mip + dx;
          if (sx >= sprite.w) break;
          const v = sprite.px[sy * sprite.w + sx];
          total++;
          if (v !== 0) counts[v]++;
        }
      }
      let bestIdx = 0;
      let bestN = 0;
      let opaque = 0;
      for (let i = 1; i < counts.length; i++) {
        opaque += counts[i];
        if (counts[i] > bestN) {
          bestN = counts[i];
          bestIdx = i;
        }
      }
      if (bestIdx === 0 || opaque * 2 < total) continue;
      ctx.fillStyle = tint ?? sprite.pal[bestIdx];
      ctx.fillRect(mx * block, my * block, block, block);
    }
  }

  const baked: BakedSprite = {
    canvas,
    w: canvas.width,
    h: canvas.height,
    ax: (sprite.ax / mip) * block,
    ay: (sprite.ay / mip) * block,
    mip,
    block,
  };

  cache.set(key, baked);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return baked;
}

export function spriteCacheSize(): number {
  return cache.size;
}

export function clearSpriteCache(): void {
  cache.clear();
}
