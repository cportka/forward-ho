/**
 * `?gallery=1` renders every sprite at a ladder of sizes.
 *
 * It exists to make the pixel-block quantisation visible: the same sprite is
 * shown small, medium and large, and every version must have perfectly square,
 * evenly spaced pixels.
 */

import { ART_INDEX } from '../render/art';
import { drawText, measureText } from '../render/font';
import type { PixelStage } from '../render/pixelbuffer';

let cached: boolean | null = null;

export function galleryRequested(): boolean {
  if (cached === null) {
    try {
      cached = new URLSearchParams(window.location.search).get('gallery') === '1';
    } catch {
      cached = false;
    }
  }
  return cached;
}

export function drawGallery(stage: PixelStage): void {
  const p = stage.layers.ui;
  const W = stage.width;
  const H = stage.height;
  const u = Math.max(2, Math.round(H / 260));

  p.fill('#12151c');
  const title = 'ART GALLERY';
  drawText(p, title, W * 0.5, u * 3, Math.max(2, Math.min(u * 2, Math.floor((W * 0.8) / measureText(title, 1, { bold: true })))), {
    color: '#ffd447', outline: 1, align: 'center', bold: true,
  });

  const names = Object.keys(ART_INDEX);
  const cols = Math.max(2, Math.min(5, Math.floor(W / (u * 42))));
  const cellW = W / cols;
  const cellH = u * 40;
  const top = u * 14;

  for (let i = 0; i < names.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = cellW * (col + 0.5);
    const cy = top + row * cellH;
    if (cy + cellH > H) break;

    const def = ART_INDEX[names[i]];
    p.rect(cellW * col, cy, cellW - 1, cellH - 1, (i + row) % 2 ? '#171b24' : '#1b202b');

    // Label first, so the art below always has a known budget.
    const nm = names[i].replace(/^(SPR_|ICON_)/, '');
    const nmSize = Math.max(1, Math.min(u, Math.floor((cellW - u * 3) / Math.max(1, measureText(nm, 1, { bold: true })))));
    drawText(p, nm, cx, cy + u * 1.5, nmSize, { color: '#8fd4ff', outline: 1, align: 'center', bold: true });
    drawText(p, `${def.w}x${def.h}`, cx, cy + u * 1.5 + nmSize * 8, Math.max(1, Math.round(u * 0.7)), {
      color: '#6a7284', outline: 1, align: 'center', bold: true,
    });

    // Three sizes, laid out so the widest still fits its cell.
    const base = cy + cellH - u * 3;
    const budget = cellW - u * 4;
    const aspect = def.w / def.h;
    const big = Math.min(u * 22, (budget * 0.55) / Math.max(0.35, aspect));
    const sizes = [big * 0.28, big * 0.55, big];
    let x = cellW * col + u * 2;
    for (const s of sizes) {
      x += (s * aspect) / 2;
      p.sprite(def, x, base, s, {});
      x += (s * aspect) / 2 + u * 1.5;
    }
  }
}
