/** In-run heads-up display. */

import { clamp, easeOutBack, formatCount } from '../core/math';
import { drawText } from '../render/font';
import { ICON_COIN, ICON_RIFLE, ICON_SKULL, ICON_SOLDIER } from '../render/art';
import type { World } from '../game/world';
import { button, fitTextClamped, label, panel, progressBar, ts, type UiContext } from './ui';

export interface HudResult {
  pausePressed: boolean;
}

const INK = '#0b0d14';
const GOLD = '#ffd447';

export function drawHud(ui: UiContext, world: World, muted: boolean): HudResult {
  const p = ui.p;
  const u = ui.u;
  const W = ui.w;
  const H = ui.h;
  const pad = u * 4;

  // --- Progress track along the very top.
  const trackH = Math.max(4, u * 2.4);
  const trackW = W - pad * 2;
  const top = pad;
  progressBar(ui, pad, top, trackW, trackH, world.progress, GOLD, '#20242e');
  const bossAt = 1 - 70 / Math.max(1, world.plan.length);
  p.rect(pad + trackW * bossAt - u * 0.7, top - u, u * 1.4, trackH + u * 2, '#e0332f', 0.95);
  p.rect(pad + trackW * world.progress - u * 0.8, top - u, u * 1.6, trackH + u * 2, '#ffffff', 1);

  const rowY = top + trackH + u * 4;
  const chipH = u * 13;
  const gapX = u * 2.5;

  // Three fixed boxes across one row, sized from the widest content each can
  // hold, so nothing ever lands on top of anything else.
  const statW = u * 26;
  const troopW = u * 30;
  const wepX = pad + troopW + gapX;
  const statX = W - pad - statW;
  const wepW = Math.max(u * 20, statX - gapX - wepX);

  // --- Troop counter: the number that matters most.
  panel(ui, pad, rowY, troopW, chipH, { fill: '#101827', alpha: 0.9, border: Math.max(1, u * 0.7) });
  const troopIcon = chipH * 0.56;
  p.sprite(ICON_SOLDIER, pad + u * 3 + troopIcon * 0.5, rowY + chipH * 0.5 + troopIcon * 0.5, troopIcon, {});
  const troopStr = formatCount(world.stats.troops);
  const troopBox = troopW - u * 6 - troopIcon;
  const troopSize = fitTextClamped(troopStr, troopBox, ts(ui, 1.25), 0.55);
  drawText(p, troopStr, pad + troopW - u * 3, rowY + chipH * 0.5 - troopSize * 3.5, troopSize, {
    color: '#ffffff', outline: 1, outlineColor: INK, align: 'right', bold: true,
  });

  // --- Weapon chip: name over a tier meter.
  panel(ui, wepX, rowY, wepW, chipH, { fill: '#1a1330', alpha: 0.9, border: Math.max(1, u * 0.7) });
  const nameSize = ts(ui, 0.8);
  const wIcon = nameSize * 5;
  p.sprite(ICON_RIFLE, wepX + u * 2.5 + wIcon * 0.5, rowY + u * 3 + wIcon, wIcon, {});
  label(
    ui, world.weapon.name, wepX + u * 4 + wIcon, rowY + u * 2.5,
    fitTextClamped(world.weapon.name, wepW - u * 7 - wIcon, nameSize, 0.6), '#d5bcff', 'left',
  );
  progressBar(
    ui, wepX + u * 3, rowY + chipH - u * 5, wepW - u * 6, u * 2.6,
    (world.weaponTier + 1) / 10, '#c9a4ff', '#2c2440',
  );

  // --- Gold and kills, stacked in their own box.
  panel(ui, statX, rowY, statW, chipH, { fill: '#101827', alpha: 0.9, border: Math.max(1, u * 0.7) });
  const statSize = ts(ui, 0.85);
  const statIcon = statSize * 5.5;
  const statRow = chipH / 2;
  p.sprite(ICON_COIN, statX + u * 2 + statIcon * 0.5, rowY + statRow * 0.5 + statIcon * 0.5, statIcon, {});
  drawText(p, formatCount(world.stats.gold), statX + statW - u * 2.5, rowY + statRow * 0.5 - statSize * 3.5, statSize, {
    color: GOLD, outline: 1, outlineColor: INK, align: 'right', bold: true,
  });
  p.sprite(ICON_SKULL, statX + u * 2 + statIcon * 0.5, rowY + statRow * 1.5 + statIcon * 0.5, statIcon, {});
  drawText(p, formatCount(world.stats.kills), statX + statW - u * 2.5, rowY + statRow * 1.5 - statSize * 3.5, statSize, {
    color: '#e8e2d0', outline: 1, outlineColor: INK, align: 'right', bold: true,
  });

  // --- Combo meter.
  if (world.stats.combo > 4) {
    const c = world.stats.combo;
    const s = ts(ui, 1.2 + Math.min(0.9, c / 120));
    drawText(p, `${c} COMBO`, W * 0.5, rowY + chipH + u * 4, s, {
      color: GOLD, outline: 1, outlineColor: '#7a3a00', align: 'center', bold: true,
      alpha: 0.78 + 0.22 * Math.sin(ui.time * 12),
    });
  }

  // --- Status badges.
  let iy = rowY + chipH + u * 12;
  const badge = ts(ui, 0.8);
  if (world.squad.shieldTime > 0) {
    label(ui, `SHIELD ${world.squad.shieldTime.toFixed(1)}`, pad, iy, badge, '#8ff2ec', 'left');
    iy += badge * 9;
  }
  if (world.squad.dashTime > 0) {
    label(ui, `DOUBLE TIME ${world.squad.dashTime.toFixed(1)}`, pad, iy, badge, '#39f5c8', 'left');
  }

  drawPushGauge(ui, world);

  // --- Centre banner.
  if (world.bannerT > 0) {
    const k = clamp(world.bannerT / 2.4, 0, 1);
    const pop = easeOutBack(clamp((1 - k) * 3.4, 0, 1));
    const alpha = clamp(k * 2.4, 0, 1);
    const bs = Math.max(2, Math.round(fitTextClamped(world.bannerText, W * 0.88, ts(ui, 3)) * (0.66 + pop * 0.34)));
    const by = H * 0.28;
    drawText(p, world.bannerText, W * 0.5, by, bs, {
      color: GOLD, outline: 1, outlineColor: '#5a2a00', shadow: 1, align: 'center', bold: true, alpha,
    });
    if (world.bannerSub) {
      drawText(p, world.bannerSub, W * 0.5, by + bs * 9.2, ts(ui, 1), {
        color: '#ffffff', outline: 1, align: 'center', bold: true, alpha,
      });
    }
  }

  // --- Reward toast.
  if (world.toastT > 0) {
    const k = clamp(world.toastT / 1.8, 0, 1);
    const s = fitTextClamped(world.toastText, W * 0.86, ts(ui, 1.3));
    drawText(p, world.toastText, W * 0.5, H * 0.42, s, {
      color: '#8fd4ff', outline: 1, outlineColor: INK, align: 'center', bold: true,
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
  const bs2 = u * 12;
  const pauseX = W - pad - bs2;
  const pauseY = H - pad - bs2;
  const paused = button(ui, 'hud.pause', pauseX, pauseY, bs2, bs2, '', {
    fill: '#1d2432', fillHot: '#39445a',
  });
  p.rect(pauseX + bs2 * 0.3, pauseY + bs2 * 0.28, bs2 * 0.12, bs2 * 0.44, '#ffffff', 0.9);
  p.rect(pauseX + bs2 * 0.56, pauseY + bs2 * 0.28, bs2 * 0.12, bs2 * 0.44, '#ffffff', 0.9);

  if (muted) label(ui, 'MUTED', pad, H - pad - ts(ui, 0.8) * 7, ts(ui, 0.8), '#8a93a6', 'left');

  return { pausePressed: paused };
}

/**
 * The march gauge. Pushing the column up the road buys rate of fire and costs
 * safety, so the trade needs to be legible at a glance while you are dragging.
 */
function drawPushGauge(ui: UiContext, world: World): void {
  const p = ui.p;
  const u = ui.u;
  const push = world.squad.push;
  const gaugeH = u * 34;
  const gaugeW = u * 6;
  const x = u * 4;
  const y = ui.h - gaugeH - u * 20;
  const capSize = ts(ui, 0.72);

  panel(ui, x, y, gaugeW, gaugeH, { fill: '#0d1220', alpha: 0.7, border: Math.max(1, u * 0.5) });

  const mid = y + gaugeH / 2;
  p.rect(x, mid - u * 0.4, gaugeW, u * 0.8, '#3a4356', 0.9);

  const travel = (gaugeH / 2 - u * 2) * clamp(push, -1, 1);
  const col = push >= 0 ? '#ff9a3c' : '#63d8ff';
  if (Math.abs(travel) > 0.5) {
    const topY = travel > 0 ? mid - travel : mid;
    p.rect(x + u, topY, gaugeW - u * 2, Math.abs(travel), col, 0.92);
  }
  p.rect(x - u * 0.6, mid - travel - u * 1.2, gaugeW + u * 1.2, u * 2.4, '#ffffff', 0.95);

  // Only the active state is labelled — a static legend is just clutter once
  // you have used the control twice.
  if (Math.abs(push) > 0.1) {
    const pct = Math.round((world.squad.fireRateMul - 1) * 100);
    const lbl = push > 0 ? 'CHARGE' : 'HOLD';
    drawText(p, lbl, x + gaugeW + u * 2, mid - capSize * 8, capSize, {
      color: col, outline: 1, outlineColor: INK, align: 'left', bold: true,
    });
    drawText(p, `${pct >= 0 ? '+' : ''}${pct}% ROF`, x + gaugeW + u * 2, mid + capSize, capSize, {
      color: col, outline: 1, outlineColor: INK, align: 'left', bold: true,
    });
  }
}
