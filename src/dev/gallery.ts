/**
 * `?gallery=1` renders every sprite at a ladder of sizes.
 *
 * It exists to make the pixel-block quantisation visible: the same sprite is
 * shown tiny, small, medium and large, and every version must have perfectly
 * square, evenly spaced pixels.
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
  const u = Math.max(2, Math.round(H / 240));

  p.fill('#12151c');
  drawText(p, 'ART GALLERY', W * 0.5, u * 4, Math.max(1, Math.min(u * 2, Math.floor(W * 0.8 / measureText('ART GALLERY', 1, { bold: true })))), {
    color: '#ffd447', outline: 1, align: 'center', bold: true,
  });

  const names = Object.keys(ART_INDEX);
  const cols = 5;
  const cellW = W / cols;
  const cellH = u * 34;
  let y = u * 16;

  for (let i = 0; i < names.length; i++) {
    const col = i % cols;
    if (col === 0 && i > 0) y += cellH;
    if (y + cellH > H) break;
    const def = ART_INDEX[names[i]];
    const cx = cellW * (col + 0.5);
    const base = y + cellH - u * 8;

    // Alternating cell background so the grid is readable.
    p.rect(cellW * col, y, cellW, cellH, (i + Math.floor(i / cols)) % 2 ? '#171b24' : '#1b202b');

    const sizes = [u * 4, u * 8, u * 14, u * 22];
    let x = cellW * col + u * 3;
    for (const s of sizes) {
      p.sprite(def, x + s * 0.4, base, s, {});
      x += s * 0.85 + u * 2;
    }

    const nm = names[i].replace(/^(SPR_|ICON_)/, '');
    const nmSize = Math.max(1, Math.min(u, Math.floor((cellW - u * 2) / Math.max(1, measureText(nm, 1, { bold: true })))));
    drawText(p, nm, cx, base + u * 2, nmSize, {
      color: '#8fd4ff', outline: 1, align: 'center', bold: true,
    });
    drawText(p, `${def.w}x${def.h}`, cx, base + u * 7, Math.max(1, u), {
      color: '#6a7284', outline: 1, align: 'center', bold: true,
    });
  }
}
