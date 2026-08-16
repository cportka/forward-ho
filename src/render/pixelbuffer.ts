/**
 * The layered pixel canvas.
 *
 * The scene is painted into several offscreen buffers, each with its own
 * pixel size, and composited with nearest-neighbour upscaling. Distant
 * parallax planes get big chunky pixels, the world plane gets medium ones and
 * the HUD gets fine ones — so the picture is pixel-art all the way through
 * without every element snapping to the same grid.
 */

import { bakeSprite, type SpriteDef } from './sprite';

export type LayerId = 'sky' | 'far' | 'mid' | 'world' | 'fx' | 'ui';

export const LAYER_ORDER: LayerId[] = ['sky', 'far', 'mid', 'world', 'fx', 'ui'];

/** Pixel size of each plane, expressed in multiples of the base pixel unit. */
const LAYER_UNITS: Record<LayerId, number> = {
  sky: 5,
  far: 4,
  mid: 3,
  world: 2,
  fx: 2,
  ui: 1,
};

export interface SpriteDrawOptions {
  /** Flat colour override — used for silhouettes and hit flashes. */
  tint?: string;
  alpha?: number;
  /** Extra key so tinted/flashed variants do not collide in the bake cache. */
  variant?: string;
  /** Horizontal squash/stretch multiplier applied after baking. */
  squashX?: number;
  /** Draw the sprite mirrored. */
  flip?: boolean;
  /** Rotation in radians around the anchor. Breaks pixel alignment; use sparingly. */
  rot?: number;
}

/**
 * Painter for a single plane. All coordinates are **device pixels**; the
 * painter divides by the plane's pixel size and snaps, so callers never have
 * to think about which plane they are drawing into.
 */
export class Painter {
  readonly ctx: CanvasRenderingContext2D;
  /** Device pixels per plane pixel. */
  scale: number;
  /** Plane dimensions, in plane pixels. */
  w = 1;
  h = 1;

  constructor(
    readonly id: LayerId,
    readonly canvas: HTMLCanvasElement,
    scale: number,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: id !== 'sky' })!;
    this.scale = scale;
  }

  resize(deviceW: number, deviceH: number, scale: number): void {
    this.scale = scale;
    this.w = Math.max(1, Math.ceil(deviceW / scale));
    this.h = Math.max(1, Math.ceil(deviceH / scale));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
  }

  fill(color: string): void {
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  /** Converts device pixels to this plane's pixels (unrounded). */
  p(v: number): number {
    return v / this.scale;
  }

  setAlpha(a: number): void {
    this.ctx.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }

  additive(on: boolean): void {
    this.ctx.globalCompositeOperation = on ? 'lighter' : 'source-over';
  }

  /** Restricts drawing to a rectangle until `popClip`. Snapped to the grid. */
  pushClip(x: number, y: number, w: number, h: number): void {
    const s = this.scale;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(x / s), Math.round(y / s), Math.max(0, Math.round(w / s)), Math.max(0, Math.round(h / s)));
    ctx.clip();
  }

  popClip(): void {
    this.ctx.restore();
  }

  /** Axis-aligned rectangle, snapped to the plane grid. */
  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    if (alpha <= 0) return;
    const s = this.scale;
    const x0 = Math.round(x / s);
    const y0 = Math.round(y / s);
    const x1 = Math.round((x + w) / s);
    const y1 = Math.round((y + h) / s);
    const dw = Math.max(1, x1 - x0);
    const dh = Math.max(1, y1 - y0);
    if (x1 < 0 || y1 < 0 || x0 > this.w || y0 > this.h) return;
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prev * alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, dw, dh);
    if (alpha !== 1) ctx.globalAlpha = prev;
  }

  /** Rectangle outline of `t` device pixels. */
  strokeRect(x: number, y: number, w: number, h: number, t: number, color: string, alpha = 1): void {
    this.rect(x, y, w, t, color, alpha);
    this.rect(x, y + h - t, w, t, color, alpha);
    this.rect(x, y + t, t, h - 2 * t, color, alpha);
    this.rect(x + w - t, y + t, t, h - 2 * t, color, alpha);
  }

  /** Filled quad in device pixels — used for the road and other ground planes. */
  quad(
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    x4: number, y4: number,
    color: string,
    alpha = 1,
  ): void {
    if (alpha <= 0) return;
    const s = this.scale;
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prev * alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(Math.round(x1 / s), Math.round(y1 / s));
    ctx.lineTo(Math.round(x2 / s), Math.round(y2 / s));
    ctx.lineTo(Math.round(x3 / s), Math.round(y3 / s));
    ctx.lineTo(Math.round(x4 / s), Math.round(y4 / s));
    ctx.closePath();
    ctx.fill();
    if (alpha !== 1) ctx.globalAlpha = prev;
  }

  /** Blocky filled ellipse — shadows, ground rings, explosion cores. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 1): void {
    if (alpha <= 0 || rx <= 0 || ry <= 0) return;
    const s = this.scale;
    const px = cx / s;
    const py = cy / s;
    const prx = Math.max(0.5, rx / s);
    const pry = Math.max(0.5, ry / s);
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prev * alpha;
    ctx.fillStyle = color;
    const yTop = Math.round(py - pry);
    const yBot = Math.round(py + pry);
    for (let y = yTop; y <= yBot; y++) {
      const dy = (y + 0.5 - py) / pry;
      const k = 1 - dy * dy;
      if (k <= 0) continue;
      const half = prx * Math.sqrt(k);
      const x0 = Math.round(px - half);
      const x1 = Math.round(px + half);
      ctx.fillRect(x0, y, Math.max(1, x1 - x0), 1);
    }
    if (alpha !== 1) ctx.globalAlpha = prev;
  }

  /** Blocky ellipse outline — the glowing rings under squad members. */
  ring(cx: number, cy: number, rx: number, ry: number, thickness: number, color: string, alpha = 1): void {
    if (alpha <= 0 || rx <= 0 || ry <= 0) return;
    const s = this.scale;
    const px = cx / s;
    const py = cy / s;
    const prx = Math.max(0.6, rx / s);
    const pry = Math.max(0.4, ry / s);
    const t = Math.max(1, Math.round(thickness / s));
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prev * alpha;
    ctx.fillStyle = color;
    const yTop = Math.round(py - pry);
    const yBot = Math.round(py + pry);
    const irx = Math.max(0, prx - t);
    const iry = Math.max(0, pry - t);
    for (let y = yTop; y <= yBot; y++) {
      const dy = (y + 0.5 - py) / pry;
      const k = 1 - dy * dy;
      if (k <= 0) continue;
      const outer = prx * Math.sqrt(k);
      let inner = 0;
      if (iry > 0) {
        const dyi = (y + 0.5 - py) / iry;
        const ki = 1 - dyi * dyi;
        if (ki > 0) inner = irx * Math.sqrt(ki);
      }
      const x0 = Math.round(px - outer);
      const x1 = Math.round(px + outer);
      if (inner <= 0.5) {
        ctx.fillRect(x0, y, Math.max(1, x1 - x0), 1);
      } else {
        const i0 = Math.round(px - inner);
        const i1 = Math.round(px + inner);
        ctx.fillRect(x0, y, Math.max(1, i0 - x0), 1);
        ctx.fillRect(i1, y, Math.max(1, x1 - i1), 1);
      }
    }
    if (alpha !== 1) ctx.globalAlpha = prev;
  }

  /** Thick pixel line — projectile trails, cables, rails. */
  line(x1: number, y1: number, x2: number, y2: number, thickness: number, color: string, alpha = 1): void {
    if (alpha <= 0) return;
    const s = this.scale;
    const ax = x1 / s;
    const ay = y1 / s;
    const bx = x2 / s;
    const by = y2 / s;
    const t = Math.max(1, Math.round(thickness / s));
    const dx = bx - ax;
    const dy = by - ay;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prev * alpha;
    ctx.fillStyle = color;
    const half = (t - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      ctx.fillRect(Math.round(ax + dx * u - half), Math.round(ay + dy * u - half), t, t);
    }
    if (alpha !== 1) ctx.globalAlpha = prev;
  }

  /**
   * Draws a sprite so that it stands `targetH` device pixels tall, anchored at
   * (x, y) in device pixels. Returns the block size actually used.
   */
  sprite(def: SpriteDef, x: number, y: number, targetH: number, opts: SpriteDrawOptions = {}): number {
    const s = this.scale;
    const baked = bakeSprite(def, targetH / s, opts.tint, opts.variant ?? '');
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    if (opts.alpha !== undefined) ctx.globalAlpha = prev * Math.max(0, Math.min(1, opts.alpha));

    const sx = opts.squashX ?? 1;
    const flip = opts.flip ? -1 : 1;
    const w = baked.w * sx;
    const ax = baked.ax * sx;

    if (opts.rot) {
      ctx.save();
      ctx.translate(Math.round(x / s), Math.round(y / s));
      ctx.rotate(opts.rot);
      ctx.scale(flip, 1);
      ctx.drawImage(baked.canvas, -ax, -baked.ay, w, baked.h);
      ctx.restore();
    } else {
      const dx = Math.round(x / s - ax * flip) ;
      const dy = Math.round(y / s - baked.ay);
      if (flip < 0) {
        ctx.save();
        ctx.translate(Math.round(x / s), 0);
        ctx.scale(-1, 1);
        ctx.drawImage(baked.canvas, -ax, dy, w, baked.h);
        ctx.restore();
      } else {
        ctx.drawImage(baked.canvas, dx, dy, w, baked.h);
      }
    }

    if (opts.alpha !== undefined) ctx.globalAlpha = prev;
    return baked.block * s;
  }
}

export class PixelStage {
  readonly out: CanvasRenderingContext2D;
  readonly layers: Record<LayerId, Painter>;

  /** Backing-store size in device pixels. */
  width = 1;
  height = 1;
  /** CSS size of the canvas element. */
  cssWidth = 1;
  cssHeight = 1;
  /** Base pixel unit — every plane's pixel size is a multiple of this. */
  unit = 2;
  dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.out = canvas.getContext('2d', { alpha: false })!;
    const mk = (id: LayerId) => new Painter(id, document.createElement('canvas'), LAYER_UNITS[id] * this.unit);
    this.layers = {
      sky: mk('sky'),
      far: mk('far'),
      mid: mk('mid'),
      world: mk('world'),
      fx: mk('fx'),
      ui: mk('ui'),
    };
  }

  /**
   * Sizes the canvas to the viewport, clamping the aspect ratio to a portrait
   * play area so the framing matches on phones and desktops alike.
   */
  resize(viewW: number, viewH: number, dpr: number): boolean {
    const maxAspect = 0.78;
    let cw = viewW;
    let ch = viewH;
    if (cw / ch > maxAspect) cw = Math.floor(ch * maxAspect);

    const ratio = Math.min(dpr, 2);
    let bw = Math.round(cw * ratio);
    let bh = Math.round(ch * ratio);
    // Keep the backing store sane on very large displays.
    const cap = 1600;
    if (bh > cap) {
      const k = cap / bh;
      bw = Math.round(bw * k);
      bh = cap;
    }

    if (bw === this.width && bh === this.height && cw === this.cssWidth && ch === this.cssHeight) {
      return false;
    }

    this.cssWidth = cw;
    this.cssHeight = ch;
    this.width = bw;
    this.height = bh;
    this.dpr = ratio;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.out.imageSmoothingEnabled = false;

    // One base pixel per ~430 rendered rows keeps the chunkiness consistent.
    this.unit = Math.max(2, Math.min(5, Math.round(bh / 430)));
    for (const id of LAYER_ORDER) {
      this.layers[id].resize(bw, bh, LAYER_UNITS[id] * this.unit);
    }
    return true;
  }

  clearAll(): void {
    for (const id of LAYER_ORDER) this.layers[id].clear();
  }

  composite(): void {
    const ctx = this.out;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, this.width, this.height);
    for (const id of LAYER_ORDER) {
      const l = this.layers[id];
      ctx.drawImage(l.canvas, 0, 0, l.w, l.h, 0, 0, l.w * l.scale, l.h * l.scale);
    }
  }
}
