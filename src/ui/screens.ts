/** Front-end screens: title, level select, barracks, help, pause and results. */

import { clamp, formatCount } from '../core/math';
import { drawText } from '../render/font';
import { ICON_COIN, ICON_SKULL, ICON_SOLDIER, ICON_STAR } from '../render/art';
import { CAMPAIGN_LENGTH, levelBiome, levelName } from '../game/levels';
import { BIOMES } from '../game/defs';
import type { Meta, UpgradeId } from '../game/progression';
import { UPGRADES } from '../game/progression';
import type { RunStats } from '../game/world';
import { button, fitText, label, panel, progressBar, scrim, ts, type UiContext } from './ui';

export type ScreenName = 'title' | 'levels' | 'barracks' | 'help' | 'pause' | 'results';

export type ScreenAction =
  | { type: 'none' }
  | { type: 'play'; level: number }
  | { type: 'goto'; screen: ScreenName }
  | { type: 'back' }
  | { type: 'buy'; id: UpgradeId }
  | { type: 'toggleMute' }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'quit' }
  | { type: 'next' }
  | { type: 'wipe' };

const NONE: ScreenAction = { type: 'none' };

/** Screen headline; returns the y just below it. */
function heading(ui: UiContext, y: number, big: string, small: string): number {
  const s1 = Math.min(ts(ui, 3), fitText(big, ui.w * 0.84));
  drawText(ui.p, big, ui.w * 0.5, y, s1, {
    color: '#ffd447', outline: 1, outlineColor: '#7a3a00', shadow: 1, align: 'center', bold: true,
  });
  let out = y + s1 * 8;
  if (small) {
    const s2 = Math.min(ts(ui, 1), fitText(small, ui.w * 0.84));
    drawText(ui.p, small, ui.w * 0.5, out, s2, {
      color: '#8fd4ff', outline: 1, align: 'center', bold: true,
    });
    out += s2 * 9;
  }
  return out + ui.u * 3;
}

// ---------------------------------------------------------------------------

export function drawTitle(ui: UiContext, meta: Meta, muted: boolean): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  const H = ui.h;
  let act: ScreenAction = NONE;

  ui.p.rect(0, 0, W, H * 0.5, '#05070d', 0.5);
  ui.p.rect(0, H * 0.5, W, H * 0.5, '#05070d', 0.26);

  const logo = fitText('FORWARD', W * 0.84);
  const ty = H * 0.08;
  drawText(ui.p, 'FORWARD', W * 0.5, ty, logo, {
    color: '#ffd447', outline: 1, outlineColor: '#7a3a00', shadow: 2, align: 'center', bold: true,
  });
  const hoSize = Math.min(Math.round(logo * 1.5), fitText('HO!', W * 0.5));
  drawText(ui.p, 'HO!', W * 0.5, ty + logo * 8, hoSize, {
    color: '#ff8b2b', outline: 1, outlineColor: '#7a1a00', shadow: 2, align: 'center', bold: true,
  });
  const tag = ts(ui, 1);
  drawText(ui.p, 'MARCH * SHOOT * MULTIPLY', W * 0.5, ty + logo * 8 + hoSize * 9, tag, {
    color: '#8fd4ff', outline: 1, align: 'center', bold: true,
    alpha: 0.7 + 0.3 * Math.sin(ui.time * 2.4),
  });

  const bw = Math.min(W * 0.72, u * 78);
  const bx = (W - bw) / 2;
  let by = H * 0.46;
  const bh = u * 13;
  const gap = u * 4;

  if (button(ui, 't.play', bx, by, bw, bh, 'MARCH OUT', { fill: '#2f6ddb', fillHot: '#63a6ff' })) {
    act = { type: 'play', level: Math.max(0, meta.state.highestLevel) };
  }
  by += bh + gap;
  if (button(ui, 't.levels', bx, by, bw, bh * 0.82, 'SECTORS', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'goto', screen: 'levels' };
  }
  by += bh * 0.82 + gap;
  if (button(ui, 't.barracks', bx, by, bw, bh * 0.82, 'BARRACKS', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'goto', screen: 'barracks' };
  }
  by += bh * 0.82 + gap;
  const halfW = (bw - gap) / 2;
  if (button(ui, 't.help', bx, by, halfW, bh * 0.74, 'HOW TO', { fill: '#2a3141', fillHot: '#454f66' })) {
    act = { type: 'goto', screen: 'help' };
  }
  if (button(ui, 't.mute', bx + halfW + gap, by, halfW, bh * 0.74, muted ? 'SOUND OFF' : 'SOUND ON', {
    fill: '#2a3141', fillHot: '#454f66',
  })) {
    act = { type: 'toggleMute' };
  }

  // Records strip.
  const stripH = u * 15;
  const stripY = H - stripH - u * 5;
  panel(ui, u * 4, stripY, W - u * 8, stripH, { fill: '#101827', alpha: 0.82, border: Math.max(1, u * 0.6) });
  const cell = (W - u * 8) / 3;
  const icons = [ICON_COIN, ICON_SOLDIER, ICON_SKULL];
  const vals = [formatCount(meta.state.gold), formatCount(meta.state.bestTroops), formatCount(meta.state.totalKills)];
  const names = ['GOLD', 'BEST ARMY', 'KILLS'];
  const valSize = ts(ui, 1.15);
  const capSize = ts(ui, 0.75);
  for (let i = 0; i < 3; i++) {
    const cx = u * 4 + cell * (i + 0.5);
    ui.p.sprite(icons[i], cx - u * 7, stripY + u * 8.5, u * 6, {});
    drawText(ui.p, vals[i], cx + u * 2, stripY + u * 2.5, valSize, {
      color: '#ffffff', outline: 1, align: 'center', bold: true,
    });
    drawText(ui.p, names[i], cx, stripY + stripH - capSize * 8, capSize, {
      color: '#6a7284', outline: 1, align: 'center', bold: true,
    });
  }

  return act;
}

// ---------------------------------------------------------------------------

export function drawLevels(ui: UiContext, meta: Meta): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  let act: ScreenAction = NONE;
  scrim(ui, 0.78);
  const y0 = heading(ui, u * 10, 'SECTORS', 'PICK YOUR FRONT');

  const cols = 2;
  const pad = u * 6;
  const cw = (W - pad * 2 - u * 4) / cols;
  const ch = u * 20;
  const unlocked = meta.unlockedLevels;
  const total = Math.max(CAMPAIGN_LENGTH, unlocked);
  const numSize = ts(ui, 1.8);
  const capSize = ts(ui, 0.8);

  for (let i = 0; i < total; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cw + u * 4);
    const yy = y0 + row * (ch + u * 4);
    if (yy + ch > ui.h - u * 20) break;
    const open = i < unlocked;
    const biome = BIOMES[levelBiome(i)];
    if (
      button(ui, `lv.${i}`, x, yy, cw, ch, '', {
        fill: open ? biome.skyTop : '#232833',
        fillHot: biome.sunColor,
        disabled: !open,
      })
    ) {
      act = { type: 'play', level: i };
    }
    drawText(ui.p, `${i + 1}`, x + cw * 0.5, yy + u * 3, numSize, {
      color: open ? '#ffffff' : '#5a6274', outline: 1, align: 'center', bold: true,
    });
    const nm = open ? levelName(i) : 'LOCKED';
    drawText(ui.p, nm, x + cw * 0.5, yy + ch - capSize * 9, Math.min(capSize, fitText(nm, cw - u * 3)), {
      color: open ? biome.sunColor : '#5a6274', outline: 1, align: 'center', bold: true,
    });
    if (i < meta.state.highestLevel) ui.p.sprite(ICON_STAR, x + cw - u * 6, yy + u * 8, u * 6, {});
  }

  if (button(ui, 'lv.back', (W - u * 40) / 2, ui.h - u * 16, u * 40, u * 12, 'BACK', {
    fill: '#3a4356', fillHot: '#5a6478',
  })) {
    act = { type: 'back' };
  }
  return act;
}

// ---------------------------------------------------------------------------

export function drawBarracks(ui: UiContext, meta: Meta): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  let act: ScreenAction = NONE;
  scrim(ui, 0.84);
  let y = heading(ui, u * 8, 'BARRACKS', 'SPEND YOUR GOLD');

  const goldH = u * 12;
  panel(ui, W * 0.5 - u * 24, y, u * 48, goldH, { fill: '#2a2410', alpha: 0.95, border: Math.max(1, u * 0.6) });
  ui.p.sprite(ICON_COIN, W * 0.5 - u * 16, y + goldH * 0.5 + u * 3.5, u * 7, {});
  drawText(ui.p, formatCount(meta.state.gold), W * 0.5 + u * 4, y + goldH * 0.5 - ts(ui, 1.4) * 3.5, ts(ui, 1.4), {
    color: '#ffd447', outline: 1, align: 'center', bold: true,
  });
  y += goldH + u * 5;

  const bottom = ui.h - u * 18;
  const rowH = Math.min(u * 21, (bottom - y) / UPGRADES.length);
  const pad = u * 5;
  const nameSize = ts(ui, 1);
  const subSize = ts(ui, 0.75);

  for (const def of UPGRADES) {
    const lvl = meta.level(def.id);
    const maxed = lvl >= def.maxLevel;
    const cost = meta.cost(def.id);
    const afford = meta.canAfford(def.id);
    const h = rowH - u * 2;

    panel(ui, pad, y, W - pad * 2, h, { fill: '#141a26', alpha: 0.94, border: Math.max(1, u * 0.5) });
    ui.p.sprite(def.icon, pad + u * 8, y + h * 0.5 + h * 0.24, h * 0.46, {});
    const textX = pad + u * 15;
    label(ui, def.name, textX, y + u * 1.6, nameSize, '#ffffff', 'left');
    label(ui, def.format(lvl), textX, y + u * 1.6 + nameSize * 8, subSize, '#8fd4ff', 'left');

    const pipY = y + u * 1.6 + nameSize * 8 + subSize * 8.5;
    const pipW = u * 2;
    for (let i = 0; i < def.maxLevel; i++) {
      ui.p.rect(textX + i * pipW, pipY, pipW * 0.75, u * 1.8, i < lvl ? '#ffd447' : '#2c3444', 1);
    }

    const bw = u * 28;
    const bx = W - pad - bw - u * 2;
    if (
      button(ui, `up.${def.id}`, bx, y + u * 2.5, bw, h - u * 5, maxed ? 'MAX' : formatCount(cost), {
        fill: maxed ? '#2a3141' : afford ? '#2f8f4a' : '#5a2a2a',
        fillHot: '#63d87a',
        disabled: maxed || !afford,
      })
    ) {
      act = { type: 'buy', id: def.id };
    }
    y += rowH;
  }

  const bwid = u * 36;
  if (button(ui, 'bk.back', W * 0.5 - bwid - u * 2, ui.h - u * 15, bwid, u * 12, 'BACK', {
    fill: '#3a4356', fillHot: '#5a6478',
  })) {
    act = { type: 'back' };
  }
  if (button(ui, 'bk.wipe', W * 0.5 + u * 2, ui.h - u * 15, bwid, u * 12, 'RESET SAVE', {
    fill: '#5a2a2a', fillHot: '#a44',
  })) {
    act = { type: 'wipe' };
  }
  return act;
}

// ---------------------------------------------------------------------------

const HELP_LINES: [string, string][] = [
  ['STEER', 'DRAG ANYWHERE, OR USE A/D AND ARROWS'],
  ['FIRE', 'YOUR TROOPS FIRE BY THEMSELVES'],
  ['GATES', 'BLUE AND GOLD ADD TROOPS, RED TAKES THEM'],
  ['LADDERS', 'HUG A LONG ROW OF +1 GATES TO STACK UP'],
  ['BOARDS', 'SHOOT THE NUMBER TO ZERO FOR THE PRIZE'],
  ['WALLS', 'BLAST CRATES OR LOSE TROOPS RAMMING THEM'],
  ['HORDE', 'EVERY BODY THAT REACHES YOU COSTS A TROOP'],
  ['BOSS', 'IT CLOSES IN - OUT-DAMAGE THE CLOCK'],
  ['GOLD', 'SPEND IT IN THE BARRACKS BETWEEN RUNS'],
];

export function drawHelp(ui: UiContext): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  let act: ScreenAction = NONE;
  scrim(ui, 0.88);
  let y = heading(ui, u * 12, 'HOW TO', 'FORWARD, HO!');

  const keySize = ts(ui, 1);
  const valSize = ts(ui, 0.8);
  const rowH = keySize * 8 + valSize * 9 + u * 2;
  panel(ui, u * 5, y, W - u * 10, HELP_LINES.length * rowH + u * 6, {
    fill: '#101827', alpha: 0.95, border: Math.max(1, u * 0.6),
  });
  y += u * 4;
  for (const [k, v] of HELP_LINES) {
    label(ui, k, u * 10, y, keySize, '#ffd447', 'left');
    label(ui, v, u * 10, y + keySize * 8, Math.min(valSize, fitText(v, W - u * 22)), '#c9d3e2', 'left');
    y += rowH;
  }

  if (button(ui, 'hp.back', (W - u * 40) / 2, ui.h - u * 16, u * 40, u * 12, 'BACK', {
    fill: '#3a4356', fillHot: '#5a6478',
  })) {
    act = { type: 'back' };
  }
  return act;
}

// ---------------------------------------------------------------------------

export function drawPause(ui: UiContext, muted: boolean): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  let act: ScreenAction = NONE;
  scrim(ui, 0.72);
  heading(ui, ui.h * 0.22, 'PAUSED', '');

  const bw = Math.min(W * 0.72, u * 78);
  const bx = (W - bw) / 2;
  let by = ui.h * 0.4;
  const bh = u * 13;
  const gap = u * 4;

  if (button(ui, 'pz.resume', bx, by, bw, bh, 'RESUME', { fill: '#2f6ddb', fillHot: '#63a6ff' })) {
    act = { type: 'resume' };
  }
  by += bh + gap;
  if (button(ui, 'pz.restart', bx, by, bw, bh * 0.85, 'RESTART', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'restart' };
  }
  by += bh * 0.85 + gap;
  if (button(ui, 'pz.mute', bx, by, bw, bh * 0.85, muted ? 'SOUND OFF' : 'SOUND ON', { fill: '#2a3141', fillHot: '#454f66' })) {
    act = { type: 'toggleMute' };
  }
  by += bh * 0.85 + gap;
  if (button(ui, 'pz.quit', bx, by, bw, bh * 0.85, 'ABANDON', { fill: '#5a2a2a', fillHot: '#a44' })) {
    act = { type: 'quit' };
  }
  return act;
}

// ---------------------------------------------------------------------------

export interface ResultsData {
  cleared: boolean;
  levelIndex: number;
  levelName: string;
  stats: RunStats;
  goldEarned: number;
  reveal: number;
  hasNext: boolean;
}

export function drawResults(ui: UiContext, d: ResultsData): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  const H = ui.h;
  let act: ScreenAction = NONE;
  scrim(ui, 0.8);

  const head = d.cleared ? 'SECTOR CLEAR' : 'ARMY LOST';
  const headColor = d.cleared ? '#ffd447' : '#ff6a52';
  const s1 = Math.min(ts(ui, 2.6), fitText(head, W * 0.86));
  drawText(ui.p, head, W * 0.5, H * 0.1, s1, {
    color: headColor, outline: 1, outlineColor: '#5a2a00', shadow: 1, align: 'center', bold: true,
  });
  const s2 = ts(ui, 1);
  drawText(ui.p, d.levelName, W * 0.5, H * 0.1 + s1 * 8.5, s2, {
    color: '#8fd4ff', outline: 1, align: 'center', bold: true,
  });

  const rows: [string, string, string][] = [
    ['PEAK ARMY', formatCount(d.stats.peakTroops), '#8fd4ff'],
    ['KILLS', formatCount(d.stats.kills), '#ffffff'],
    ['BEST COMBO', formatCount(d.stats.bestCombo), '#ffd447'],
    ['DISTANCE', `${Math.round(d.stats.distance)}M`, '#c9d3e2'],
    ['WEAPON', `TIER ${d.stats.weaponTier + 1}`, '#c9a4ff'],
    ['SCORE', formatCount(d.stats.score), '#ffd447'],
  ];

  const px = u * 6;
  const py = H * 0.24;
  const keySize = ts(ui, 0.9);
  const valSize = ts(ui, 1.15);
  const rowH = valSize * 9 + u * 1.5;
  panel(ui, px, py, W - px * 2, rows.length * rowH + u * 8, {
    fill: '#101827', alpha: 0.95, border: Math.max(1, u * 0.6),
  });

  for (let i = 0; i < rows.length; i++) {
    const [k, v, c] = rows[i];
    const revealT = clamp(d.reveal * rows.length - i, 0, 1);
    if (revealT <= 0) continue;
    const yy = py + u * 4 + i * rowH;
    label(ui, k, px + u * 5, yy + (valSize - keySize) * 3.5, keySize, '#6a7284', 'left');
    drawText(ui.p, v, W - px - u * 5, yy, valSize, {
      color: c, outline: 1, align: 'right', bold: true, alpha: revealT,
    });
  }

  const gy = py + rows.length * rowH + u * 12;
  const gh = u * 14;
  panel(ui, px, gy, W - px * 2, gh, { fill: '#2a2410', alpha: 0.95, border: Math.max(1, u * 0.6) });
  ui.p.sprite(ICON_COIN, px + u * 8, gy + gh * 0.5 + u * 4, u * 8, {});
  const goldSize = ts(ui, 1.4);
  drawText(
    ui.p,
    `+${formatCount(Math.round(d.goldEarned * clamp(d.reveal * 1.3, 0, 1)))}`,
    W - px - u * 5, gy + gh * 0.5 - goldSize * 3.5, goldSize,
    { color: '#ffd447', outline: 1, align: 'right', bold: true },
  );
  label(ui, 'GOLD BANKED', px + u * 15, gy + gh * 0.5 - ts(ui, 0.8) * 3.5, ts(ui, 0.8), '#c8a44a', 'left');

  const bw = Math.min(W * 0.78, u * 84);
  const bx = (W - bw) / 2;
  let by = gy + gh + u * 6;
  const bh = u * 13;
  const gap = u * 3;

  if (d.cleared && d.hasNext) {
    if (button(ui, 'rs.next', bx, by, bw, bh, 'NEXT SECTOR', { fill: '#2f8f4a', fillHot: '#63d87a' })) {
      act = { type: 'next' };
    }
    by += bh + gap;
  }
  if (button(ui, 'rs.retry', bx, by, bw, bh * 0.86, d.cleared ? 'REPLAY' : 'TRY AGAIN', {
    fill: '#2f6ddb', fillHot: '#63a6ff',
  })) {
    act = { type: 'restart' };
  }
  by += bh * 0.86 + gap;
  const half = (bw - gap) / 2;
  if (button(ui, 'rs.barracks', bx, by, half, bh * 0.8, 'BARRACKS', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'goto', screen: 'barracks' };
  }
  if (button(ui, 'rs.menu', bx + half + gap, by, half, bh * 0.8, 'MENU', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'quit' };
  }

  progressBar(ui, px, H - u * 5, W - px * 2, Math.max(2, u * 1.4), d.reveal, headColor, '#20242e');
  return act;
}
