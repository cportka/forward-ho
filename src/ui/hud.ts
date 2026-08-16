/** In-run heads-up display. */

import { clamp, easeOutBack, formatCount } from '../core/math';
import { drawText } from '../render/font';
import { ICON_COIN, ICON_RIFLE, ICON_SKULL, ICON_SOLDIER } from '../render/art';
import type { World } from '../game/world';
import { button, fitText, label, panel, progressBar, ts, type UiContext } from './ui';

export interface HudResult {
  pausePressed: boolean;
}

export function drawHud(ui: UiContext, world: World, muted: boolean): HudResult {
  const p = ui.p;
  const u = ui.u;
  const W = ui.w;
  const H = ui.h;
  const pad = u * 3;
  const top = pad + u * 2;

  // --- Progress track along the very top.
  const trackH = Math.max(3, u * 2);
  const trackW = W - pad * 2;
  progressBar(ui, pad, top, trackW, trackH, world.progress, '#ffd447', '#20242e');
  const bossAt = 1 - 70 / Math.max(1, world.plan.length);
  p.rect(pad + trackW * bossAt - u * 0.6, top - u, u * 1.2, trackH + u * 2, '#e0332f', 0.95);
  p.rect(pad + trackW * world.progress - u * 0.6, top - u, u * 1.2, trackH + u * 2, '#ffffff', 1);

  const rowY = top + trackH + u * 3;
  const chipH = u * 11;

  // --- Troop counter, the number that matters most.
  const troopW = u * 30;
  panel(ui, pad, rowY, troopW, chipH, { fill: '#101827', alpha: 0.88, border: Math.max(1, u * 0.6) });
  p.sprite(ICON_SOLDIER, pad + u * 6.5, rowY + chipH * 0.5 + chipH * 0.3, chipH * 0.6, {});
  const troopStr = formatCount(world.stats.troops);
  const troopSize = Math.min(ts(ui, 1.5), fitText(troopStr, troopW - u * 13));
  drawText(p, troopStr, pad + u * 12, rowY + chipH * 0.5 - troopSize * 3.5, troopSize, {
    color: '#ffffff', outline: 1, outlineColor: '#0b0d14', align: 'left', bold: true,
  });

  // --- Weapon chip.
  const wepX = pad + troopW + u * 2.5;
  const wepW = u * 36;
  panel(ui, wepX, rowY, wepW, chipH, { fill: '#1a1330', alpha: 0.88, border: Math.max(1, u * 0.6) });
  p.sprite(ICON_RIFLE, wepX + u * 7, rowY + chipH * 0.5 + chipH * 0.16, chipH * 0.34, {});
  const nameSize = Math.min(ts(ui, 0.8), fitText(world.weapon.name, wepW - u * 14));
  label(ui, world.weapon.name, wepX + u * 12.5, rowY + u * 1.8, nameSize, '#c9a4ff', 'left');
  const pipW = (wepW - u * 15) / 10;
  for (let i = 0; i < 10; i++) {
    const on = i <= world.weaponTier;
    p.rect(
      wepX + u * 12.5 + i * pipW, rowY + chipH - u * 4.2,
      Math.max(2, pipW * 0.78), u * 2.6,
      on ? '#c9a4ff' : '#3a3050', 1,
    );
    if (on) p.rect(wepX + u * 12.5 + i * pipW, rowY + chipH - u * 4.2, Math.max(2, pipW * 0.78), u * 0.9, '#efe0ff', 1);
  }

  // --- Gold and kills on the right.
  const rightX = W - pad;
  const statSize = ts(ui, 0.95);
  p.sprite(ICON_COIN, rightX - u * 2.5, rowY + u * 5.5, u * 5, {});
  drawText(p, formatCount(world.stats.gold), rightX - u * 6, rowY + u * 1, statSize, {
    color: '#ffd447', outline: 1, outlineColor: '#0b0d14', align: 'right', bold: true,
  });
  p.sprite(ICON_SKULL, rightX - u * 2.5, rowY + u * 12, u * 5, {});
  drawText(p, formatCount(world.stats.kills), rightX - u * 6, rowY + u * 7.5, statSize, {
    color: '#e8e2d0', outline: 1, outlineColor: '#0b0d14', align: 'right', bold: true,
  });

  // --- Combo meter.
  if (world.stats.combo > 4) {
    const c = world.stats.combo;
    const s = ts(ui, 1.2 + Math.min(0.9, c / 120));
    drawText(p, `${c} COMBO`, W * 0.5, rowY + chipH + u * 3, s, {
      color: '#ffd447', outline: 1, outlineColor: '#7a3a00', align: 'center', bold: true,
      alpha: 0.75 + 0.25 * Math.sin(ui.time * 12),
    });
  }

  // --- Shield / dash indicators.
  let iy = rowY + chipH + u * 10;
  const badge = ts(ui, 0.8);
  if (world.squad.shieldTime > 0) {
    label(ui, `SHIELD ${world.squad.shieldTime.toFixed(1)}`, pad, iy, badge, '#8ff2ec', 'left');
    iy += badge * 9;
  }
  if (world.squad.dashTime > 0) {
    label(ui, `DOUBLE TIME ${world.squad.dashTime.toFixed(1)}`, pad, iy, badge, '#39f5c8', 'left');
  }

  // --- Centre banner.
  if (world.bannerT > 0) {
    const k = clamp(world.bannerT / 2.4, 0, 1);
    const pop = easeOutBack(clamp((1 - k) * 3.4, 0, 1));
    const alpha = clamp(k * 2.4, 0, 1);
    const bs = Math.round(Math.min(ts(ui, 3.4), fitText(world.bannerText, W * 0.86)) * (0.62 + pop * 0.38));
    const by = H * 0.3;
    drawText(p, world.bannerText, W * 0.5, by, Math.max(1, bs), {
      color: '#ffd447', outline: 1, outlineColor: '#5a2a00', shadow: 1, align: 'center', bold: true, alpha,
    });
    if (world.bannerSub) {
      drawText(p, world.bannerSub, W * 0.5, by + bs * 9, ts(ui, 1), {
        color: '#ffffff', outline: 1, align: 'center', bold: true, alpha,
      });
    }
  }

  // --- Reward toast.
  if (world.toastT > 0) {
    const k = clamp(world.toastT / 1.8, 0, 1);
    const s = Math.min(ts(ui, 1.3), fitText(world.toastText, W * 0.8));
    drawText(p, world.toastText, W * 0.5, H * 0.44, s, {
      color: '#8fd4ff', outline: 1, outlineColor: '#0b0d14', align: 'center', bold: true,
      alpha: clamp(k * 2, 0, 1),
    });
  }

  // --- Low-troop warning vignette.
  if (world.stats.troops > 0 && world.stats.troops <= 3) {
    const a = 0.16 + 0.12 * Math.sin(ui.time * 8);
    const b = u * 2;
    p.rect(0, 0, W, b, '#ff3b2f', a);
    p.rect(0, H - b, W, b, '#ff3b2f', a);
    p.rect(0, 0, b, H, '#ff3b2f', a);
    p.rect(W - b, 0, b, H, '#ff3b2f', a);
  }

  // --- Pause button.
  const bs2 = u * 10;
  const pauseX = W - pad - bs2;
  const pauseY = H - pad - bs2;
  const paused = button(ui, 'hud.pause', pauseX, pauseY, bs2, bs2, '', {
    fill: '#1d2432', fillHot: '#39445a',
  });
  p.rect(pauseX + bs2 * 0.3, pauseY + bs2 * 0.28, bs2 * 0.12, bs2 * 0.44, '#ffffff', 0.9);
  p.rect(pauseX + bs2 * 0.56, pauseY + bs2 * 0.28, bs2 * 0.12, bs2 * 0.44, '#ffffff', 0.9);

  if (muted) label(ui, 'MUTED', pad, H - pad - ts(ui, 0.8) * 7, ts(ui, 0.8), '#6a7284', 'left');

  return { pausePressed: paused };
}
