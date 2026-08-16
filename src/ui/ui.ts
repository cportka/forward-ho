/** A tiny immediate-mode widget kit drawn with the pixel painter. */

import { clamp } from '../core/math';
import type { Painter } from '../render/pixelbuffer';
import { drawText, measureText, type TextOptions } from '../render/font';
import type { SpriteDef } from '../render/sprite';

export interface UiContext {
  p: Painter;
  /** Device-pixel dimensions of the screen. */
  w: number;
  h: number;
  /** Layout unit in device pixels — panels, padding and buttons scale off it. */
  u: number;
  /** Text unit: device pixels per *font* pixel at body size. */
  t: number;
  time: number;
  px: number;
  py: number;
  down: boolean;
  pressed: boolean;
  released: boolean;
  activeId: string | null;
  hotId: string | null;
  /** Set when a widget consumed the tap this frame. */
  consumed: boolean;
}

export function makeUiContext(p: Painter, w: number, h: number): UiContext {
  return {
    p, w, h,
    u: layoutUnit(h),
    t: textUnit(h),
    time: 0, px: -1, py: -1,
    down: false, pressed: false, released: false,
    activeId: null, hotId: null, consumed: false,
  };
}

function layoutUnit(h: number): number {
  return clamp(Math.round(h / 290), 2, 14);
}

function textUnit(h: number): number {
  // Body text lands at ~2.3% of screen height. Anything smaller than this and
  // the 5x7 font stops being comfortably readable on a phone.
  return clamp(Math.round(h / 300), 2, 14);
}

/** Text size in device pixels per font pixel, `k` multiples of body size. */
export function ts(ui: UiContext, k: number): number {
  return Math.max(1, Math.round(ui.t * k));
}

/** Largest text size that fits `text` inside `maxWidth`. */
export function fitText(text: string, maxWidth: number, bold = true, cap = 64): number {
  const unitW = measureText(text, 1, { bold });
  if (unitW <= 0) return 1;
  return clamp(Math.floor(maxWidth / unitW), 1, cap);
}

/**
 * One size for a whole group of labels, driven by the longest of them. Mixed
 * shrink levels inside a single list are the main thing that makes pixel text
 * look sloppy, so blocks of copy get sized together.
 */
export function fitTextGroup(texts: readonly string[], maxWidth: number, nominal: number, floor = 0.6): number {
  let size = nominal;
  for (const t of texts) size = Math.min(size, fitText(t, maxWidth));
  return Math.max(Math.round(nominal * floor), Math.min(nominal, size));
}

/**
 * Text size for a label that must fit a box but must also stay readable.
 * Shrinks to fit, but never below `floor` of the nominal size — if a label
 * cannot fit at that size it needs to be shorter, not smaller.
 */
export function fitTextClamped(text: string, maxWidth: number, nominal: number, floor = 0.7): number {
  return Math.max(Math.round(nominal * floor), Math.min(nominal, fitText(text, maxWidth)));
}

export function beginUi(
  ui: UiContext,
  w: number, h: number,
  pointerX: number, pointerY: number,
  down: boolean, pressed: boolean, released: boolean,
  time: number,
): void {
  ui.w = w;
  ui.h = h;
  ui.u = layoutUnit(h);
  ui.t = textUnit(h);
  ui.px = pointerX;
  ui.py = pointerY;
  ui.down = down;
  ui.pressed = pressed;
  ui.released = released;
  ui.time = time;
  ui.consumed = false;
  ui.hotId = null;
}

export function endUi(ui: UiContext): void {
  if (ui.released) ui.activeId = null;
}

function inside(ui: UiContext, x: number, y: number, w: number, h: number): boolean {
  return ui.px >= x && ui.px <= x + w && ui.py >= y && ui.py <= y + h;
}

export interface PanelStyle {
  fill?: string;
  edge?: string;
  edgeLight?: string;
  alpha?: number;
  border?: number;
}

export function panel(ui: UiContext, x: number, y: number, w: number, h: number, style: PanelStyle = {}): void {
  const p = ui.p;
  const b = style.border ?? ui.u;
  const fill = style.fill ?? '#141a26';
  const edge = style.edge ?? '#0b0d14';
  const light = style.edgeLight ?? '#3a4356';
  const a = style.alpha ?? 1;
  // Chunky bevelled frame: dark outer, light inner top-left, dark inner bottom-right.
  p.rect(x - b, y - b, w + b * 2, h + b * 2, edge, a);
  p.rect(x, y, w, h, fill, a);
  p.rect(x, y, w, b, light, a * 0.9);
  p.rect(x, y, b, h, light, a * 0.55);
  p.rect(x, y + h - b, w, b, '#05070d', a * 0.6);
  p.rect(x + w - b, y, b, h, '#05070d', a * 0.45);
}

export interface ButtonStyle {
  fill?: string;
  fillHot?: string;
  text?: string;
  textHot?: string;
  edge?: string;
  size?: number;
  icon?: SpriteDef;
  disabled?: boolean;
  align?: 'center' | 'left';
}

export function button(
  ui: UiContext,
  id: string,
  x: number, y: number, w: number, h: number,
  label: string,
  style: ButtonStyle = {},
): boolean {
  const p = ui.p;
  const over = inside(ui, x, y, w, h);
  const disabled = style.disabled ?? false;

  if (!disabled && over && ui.pressed && !ui.consumed) {
    ui.activeId = id;
    ui.consumed = true;
  }
  const active = ui.activeId === id && over;
  if (over && !disabled) ui.hotId = id;

  const clicked = !disabled && ui.released && ui.activeId === id && over;

  const base = disabled ? '#232833' : (style.fill ?? '#2f6ddb');
  const hot = style.fillHot ?? '#63a6ff';
  const fill = disabled ? base : active ? hot : over ? mixLight(base) : base;
  const edge = style.edge ?? '#0b0d14';
  const b = ui.u;
  const press = active ? b : 0;

  p.rect(x - b, y - b + press, w + b * 2, h + b * 2, edge, disabled ? 0.6 : 1);
  p.rect(x, y + press, w, h, fill, disabled ? 0.7 : 1);
  p.rect(x, y + press, w, b, '#ffffff', disabled ? 0.06 : 0.22);
  p.rect(x, y + h - b + press, w, b, '#000000', 0.28);

  // Text height lands at ~50% of the button, shrinking to fit the width but
  // never below three-quarters of that — short labels beat tiny ones.
  const nominal = Math.max(2, Math.round(h * 0.072));
  const size = style.size ?? fitTextClamped(label, w - b * 7, nominal, 0.75);
  const tcol = disabled ? '#6a7284' : (active ? (style.textHot ?? '#ffffff') : (style.text ?? '#ffffff'));
  let tx = x + w / 2;
  let align: TextOptions['align'] = 'center';
  if (style.align === 'left') {
    tx = x + b * 3;
    align = 'left';
  }
  if (style.icon) {
    const ih = h * 0.62;
    p.sprite(style.icon, x + b * 3 + ih * 0.5, y + press + h * 0.5 + ih * 0.5, ih, { alpha: disabled ? 0.5 : 1 });
    if (align === 'center') tx += ih * 0.35;
    else tx = x + b * 3 + ih + b * 2;
  }
  // Buttons always have a solid fill behind them, so a full outline only
  // fattens the glyphs. A one-pixel drop shadow gives the same separation.
  drawText(p, label, tx, y + press + h / 2 - size * 3.5, size, {
    color: tcol,
    outline: 0,
    shadow: 1,
    shadowColor: 'rgba(0,0,0,0.55)',
    align,
    bold: true,
  });

  return clicked;
}

function mixLight(hex: string): string {
  return hex.length === 7 ? `${hex}` : hex;
}

export function label(
  ui: UiContext,
  text: string,
  x: number, y: number,
  size: number,
  color = '#ffffff',
  align: TextOptions['align'] = 'left',
  bold = true,
  outline = 1,
): number {
  return drawText(ui.p, text, x, y, size, {
    color,
    outline,
    outlineColor: '#0b0d14',
    align,
    bold,
  });
}

export function textWidth(text: string, size: number, bold = true): number {
  return measureText(text, size, { bold });
}

export function progressBar(
  ui: UiContext,
  x: number, y: number, w: number, h: number,
  t: number,
  fill: string,
  back = '#12151c',
): void {
  const p = ui.p;
  const b = Math.max(1, ui.u * 0.5);
  p.rect(x - b, y - b, w + b * 2, h + b * 2, '#0b0d14', 0.85);
  p.rect(x, y, w, h, back, 1);
  const f = clamp(t, 0, 1);
  if (f > 0) {
    p.rect(x, y, w * f, h, fill, 1);
    p.rect(x, y, w * f, Math.max(1, h * 0.34), '#ffffff', 0.22);
  }
}

/** Dim the whole screen behind a modal. */
export function scrim(ui: UiContext, alpha = 0.62): void {
  ui.p.rect(0, 0, ui.w, ui.h, '#05070d', alpha);
}
