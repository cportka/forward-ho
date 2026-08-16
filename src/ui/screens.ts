/** Front-end screens: title, level select, barracks, help, pause and results. */

import { clamp, formatCount } from '../core/math';
import { drawText, measureText } from '../render/font';
import { ICON_COIN, ICON_SKULL, ICON_SOLDIER, ICON_STAR } from '../render/art';
import { CAMPAIGN_LENGTH, levelBiome, levelName } from '../game/levels';
import { BIOMES } from '../game/defs';
import type { Meta, UpgradeId } from '../game/progression';
import { UPGRADES } from '../game/progression';
import type { RunStats } from '../game/world';
import { button, fitText, fitTextClamped, fitTextGroup, label, panel, progressBar, scrim, ts, type UiContext } from './ui';

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

const GOLD = '#ffd447';
const SKY = '#8fd4ff';
const DIM = '#8a93a6';

/** Screen headline. Returns the y just below it. */
function heading(ui: UiContext, y: number, big: string, small: string): number {
  const s1 = Math.min(ts(ui, 2.6), fitText(big, ui.w * 0.88));
  drawText(ui.p, big, ui.w * 0.5, y, s1, {
    color: GOLD, outline: 1, outlineColor: '#7a3a00', shadow: 1, align: 'center', bold: true,
  });
  let out = y + s1 * 8;
  if (small) {
    const s2 = Math.min(ts(ui, 0.95), fitText(small, ui.w * 0.88));
    drawText(ui.p, small, ui.w * 0.5, out + ui.u * 1.5, s2, {
      color: SKY, outline: 1, align: 'center', bold: true,
    });
    out += s2 * 9 + ui.u * 1.5;
  }
  return out + ui.u * 5;
}

// ---------------------------------------------------------------------------

export function drawTitle(ui: UiContext, meta: Meta, muted: boolean): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  const H = ui.h;
  let act: ScreenAction = NONE;

  ui.p.rect(0, 0, W, H * 0.5, '#05070d', 0.52);
  ui.p.rect(0, H * 0.5, W, H * 0.5, '#05070d', 0.28);

  const logo = fitText('FORWARD', W * 0.86);
  const ty = H * 0.07;
  drawText(ui.p, 'FORWARD', W * 0.5, ty, logo, {
    color: GOLD, outline: 1, outlineColor: '#7a3a00', shadow: 2, align: 'center', bold: true,
  });
  const hoSize = Math.min(Math.round(logo * 1.5), fitText('HO!', W * 0.5));
  drawText(ui.p, 'HO!', W * 0.5, ty + logo * 8, hoSize, {
    color: '#ff8b2b', outline: 1, outlineColor: '#7a1a00', shadow: 2, align: 'center', bold: true,
  });
  const tagline = 'MARCH * SHOOT * MULTIPLY';
  const tag = fitTextClamped(tagline, W * 0.84, ts(ui, 0.95), 0.5);
  drawText(ui.p, tagline, W * 0.5, ty + logo * 8 + hoSize * 9.4, tag, {
    color: SKY, outline: 1, align: 'center', bold: true,
    alpha: 0.72 + 0.28 * Math.sin(ui.time * 2.4),
  });

  const bw = Math.min(W * 0.76, u * 80);
  const bx = (W - bw) / 2;
  const bh = u * 15;
  const gap = u * 5;
  let by = H * 0.45;

  if (button(ui, 't.play', bx, by, bw, bh, 'MARCH OUT', { fill: '#2f6ddb', fillHot: '#63a6ff' })) {
    act = { type: 'play', level: Math.max(0, meta.state.highestLevel) };
  }
  by += bh + gap;
  if (button(ui, 't.levels', bx, by, bw, bh * 0.84, 'SECTORS', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'goto', screen: 'levels' };
  }
  by += bh * 0.84 + gap;
  if (button(ui, 't.barracks', bx, by, bw, bh * 0.84, 'BARRACKS', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'goto', screen: 'barracks' };
  }
  by += bh * 0.84 + gap;
  const halfW = (bw - gap) / 2;
  if (button(ui, 't.help', bx, by, halfW, bh * 0.78, 'HOW TO', { fill: '#2a3141', fillHot: '#454f66' })) {
    act = { type: 'goto', screen: 'help' };
  }
  if (button(ui, 't.mute', bx + halfW + gap, by, halfW, bh * 0.78, muted ? 'MUTED' : 'SOUND', {
    fill: muted ? '#4a2a2a' : '#2a3141', fillHot: '#454f66',
  })) {
    act = { type: 'toggleMute' };
  }

  // Records strip: icon + value on the top line, caption underneath, with the
  // panel height derived from those two lines so they can never overlap.
  const cell = (W - u * 10) / 3;
  const icons = [ICON_COIN, ICON_SOLDIER, ICON_SKULL];
  const vals = [formatCount(meta.state.gold), formatCount(meta.state.bestTroops), formatCount(meta.state.totalKills)];
  const names = ['GOLD', 'BEST ARMY', 'KILLS'];
  const capSize = fitTextGroup(names, cell - u * 3, ts(ui, 0.7));
  const valSize = fitTextGroup(vals, cell - u * 12, ts(ui, 0.95));
  // Explicit bands: value row, a full unit of air, then the caption row.
  const valTop = u * 5;
  const capTop = valTop + valSize * 7 + u * 4;
  const stripH = capTop + capSize * 7 + u * 5;
  const stripY = H - stripH - u * 6;
  panel(ui, u * 5, stripY, W - u * 10, stripH, { fill: '#101827', alpha: 0.9, border: Math.max(1, u * 0.6) });
  for (let i = 0; i < 3; i++) {
    const cx = u * 5 + cell * (i + 0.5);
    const iconW = valSize * 5;
    const valW = measureText(vals[i], valSize, { bold: true });
    const groupX = cx - (iconW + u * 2 + valW) / 2;
    ui.p.sprite(icons[i], groupX + iconW * 0.5, stripY + valTop + valSize * 7, iconW, {});
    // No outline: this text sits on a solid dark panel, and the outline only
    // fattens the glyphs into blobs at these sizes.
    drawText(ui.p, vals[i], groupX + iconW + u * 2, stripY + valTop, valSize, {
      color: '#ffffff', outline: 0, align: 'left', bold: true,
    });
    drawText(ui.p, names[i], cx, stripY + capTop, capSize, {
      color: DIM, outline: 0, align: 'center', bold: true,
    });
  }

  return act;
}

// ---------------------------------------------------------------------------

export function drawLevels(ui: UiContext, meta: Meta): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  let act: ScreenAction = NONE;
  scrim(ui, 0.8);
  const y0 = heading(ui, u * 12, 'SECTORS', 'PICK YOUR FRONT');

  const cols = 2;
  const pad = u * 7;
  const gap = u * 5;
  const cw = (W - pad * 2 - gap) / cols;
  const numSize = ts(ui, 1.7);
  const capSize = ts(ui, 0.8);
  const ch = numSize * 8 + capSize * 9 + u * 12;
  const unlocked = meta.unlockedLevels;
  const total = Math.max(CAMPAIGN_LENGTH, unlocked);
  const bottomBar = u * 22;

  for (let i = 0; i < total; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cw + gap);
    const yy = y0 + row * (ch + gap);
    if (yy + ch > ui.h - bottomBar) break;
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
    drawText(ui.p, `${i + 1}`, x + cw * 0.5, yy + u * 4, numSize, {
      color: open ? '#ffffff' : '#5a6274', outline: 1, align: 'center', bold: true,
    });
    const nm = open ? levelName(i) : 'LOCKED';
    drawText(ui.p, nm, x + cw * 0.5, yy + u * 4 + numSize * 8.4, fitTextClamped(nm, cw - u * 4, capSize), {
      color: open ? biome.sunColor : '#5a6274', outline: 1, align: 'center', bold: true,
    });
    if (i < meta.state.highestLevel) ui.p.sprite(ICON_STAR, x + cw - u * 6, yy + u * 9, u * 7, {});
  }

  if (button(ui, 'lv.back', (W - u * 44) / 2, ui.h - u * 18, u * 44, u * 14, 'BACK', {
    fill: '#3a4356', fillHot: '#5a6478',
  })) {
    act = { type: 'back' };
  }
  return act;
}

// ---------------------------------------------------------------------------

/** Set when the barracks opens straight off the end of a run. */
export interface DeployContext {
  cleared: boolean;
  levelName: string;
  goldEarned: number;
  hasNext: boolean;
}

export function drawBarracks(ui: UiContext, meta: Meta, deploy: DeployContext | null): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  const H = ui.h;
  let act: ScreenAction = NONE;
  scrim(ui, 0.86);

  let y = deploy
    ? heading(ui, u * 9, 'BARRACKS', deploy.cleared ? `${deploy.levelName} CLEARED` : 'REGROUP AND TRY AGAIN')
    : heading(ui, u * 9, 'BARRACKS', 'SPEND YOUR GOLD');

  // Gold bar.
  const goldSize = ts(ui, 1.5);
  const goldH = goldSize * 8 + u * 6;
  panel(ui, u * 6, y, W - u * 12, goldH, { fill: '#2a2410', alpha: 0.96, border: Math.max(1, u * 0.7) });
  ui.p.sprite(ICON_COIN, u * 12, y + u * 3 + goldSize * 7, goldSize * 6.5, {});
  drawText(ui.p, formatCount(meta.state.gold), W - u * 12, y + u * 3, goldSize, {
    color: GOLD, outline: 1, align: 'right', bold: true,
  });
  if (deploy && deploy.goldEarned > 0) {
    drawText(ui.p, `+${formatCount(deploy.goldEarned)} EARNED`, u * 22, y + u * 3 + goldSize * 2, ts(ui, 0.8), {
      color: '#c8a44a', outline: 1, align: 'left', bold: true,
    });
  }
  y += goldH + u * 6;

  // Upgrade rows. Each row gets its own vertical budget so nothing collides.
  const rowGap = u * 3;
  const primaryH = u * 16;
  const bottom = H - primaryH - u * (deploy ? 30 : 24);
  const rowH = Math.min(u * 24, Math.max(u * 17, (bottom - y) / UPGRADES.length - rowGap));
  const pad = u * 6;
  // One text size across every row, measured against the widest label.
  const iconW = rowH * 0.42;
  const rowTextW = Math.max(u * 10, W - pad * 2 - u * 15 - iconW - u * 26);
  const lvlSize = ts(ui, 0.75);
  const lvlW = measureText('LV 00', lvlSize, { bold: true }) + u * 3;
  const nameSize = fitTextGroup(UPGRADES.map((d) => d.name), rowTextW, ts(ui, 1.05));
  const subSize = fitTextGroup(
    UPGRADES.map((d) => d.format(meta.level(d.id))), rowTextW - lvlW, ts(ui, 0.9),
  );

  for (const def of UPGRADES) {
    const lvl = meta.level(def.id);
    const maxed = lvl >= def.maxLevel;
    const cost = meta.cost(def.id);
    const afford = meta.canAfford(def.id);

    panel(ui, pad, y, W - pad * 2, rowH, { fill: '#141a26', alpha: 0.95, border: Math.max(1, u * 0.55) });

    // Wide icons (the rifle) are sized by width so they cannot spill out of
    // the row; tall ones keep the full box height.
    const aspect = def.icon.w / Math.max(1, def.icon.h);
    const iconSize = Math.min(iconW, iconW / Math.max(1, aspect));
    ui.p.sprite(def.icon, pad + u * 4 + iconW * 0.5, y + rowH * 0.5 + iconSize * 0.5, iconSize, {});

    const bw = u * 26;
    const bx = W - pad - bw - u * 3;
    const textX = pad + u * 6 + iconW;
    const textW = Math.max(u * 10, bx - textX - u * 4);

    // Name gets its own line at full width; the effect and the level tag share
    // the line beneath, so a long name can never collide with anything.
    // Name and level share the top line; the effect owns the second line at
    // full width, so neither has to shrink to dodge the other.
    drawText(ui.p, def.name, textX, y + u * 3, nameSize, {
      color: '#ffffff', outline: 0, align: 'left', bold: true,
    });
    // Effect and level share the second line, with a full line of air above.
    const line2 = y + u * 3 + nameSize * 9.5;
    drawText(ui.p, def.format(lvl), textX, line2, subSize, {
      color: SKY, outline: 0, align: 'left', bold: true,
    });
    const lvlTag = maxed ? 'MAX' : `LV ${lvl}`;
    drawText(ui.p, lvlTag, textX + textW, line2, lvlSize, {
      color: maxed ? GOLD : DIM, outline: 0, align: 'right', bold: true,
    });

    // Level track: one continuous bar reads better than a row of chips.
    const trackY = y + rowH - u * 4.5;
    progressBar(ui, textX, trackY, textW, u * 2.4, lvl / def.maxLevel, maxed ? GOLD : '#63a6ff', '#252c3a');

    if (
      button(ui, `up.${def.id}`, bx, y + u * 3.5, bw, rowH - u * 7, maxed ? 'MAX' : formatCount(cost), {
        fill: maxed ? '#2a3141' : afford ? '#2f8f4a' : '#4a2c2c',
        fillHot: '#63d87a',
        disabled: maxed || !afford,
      })
    ) {
      act = { type: 'buy', id: def.id };
    }
    y += rowH + rowGap;
  }

  // Primary action.
  const bw = Math.min(W * 0.8, u * 86);
  const bx = (W - bw) / 2;
  const byPrimary = H - primaryH - u * (deploy ? 20 : 16);

  if (deploy) {
    const lbl = deploy.cleared ? (deploy.hasNext ? 'NEXT SECTOR' : 'MARCH ON') : 'TRY AGAIN';
    if (
      button(ui, 'bk.deploy', bx, byPrimary, bw, primaryH, lbl, {
        fill: deploy.cleared ? '#2f8f4a' : '#2f6ddb',
        fillHot: deploy.cleared ? '#63d87a' : '#63a6ff',
      })
    ) {
      act = deploy.cleared ? { type: 'next' } : { type: 'restart' };
    }
    if (button(ui, 'bk.menu', bx, byPrimary + primaryH + u * 4, bw, u * 12, 'MENU', {
      fill: '#3a4356', fillHot: '#5a6478',
    })) {
      act = { type: 'quit' };
    }
  } else {
    const half = (bw - u * 4) / 2;
    if (button(ui, 'bk.back', bx, byPrimary, half, u * 14, 'BACK', { fill: '#3a4356', fillHot: '#5a6478' })) {
      act = { type: 'back' };
    }
    if (button(ui, 'bk.wipe', bx + half + u * 4, byPrimary, half, u * 14, 'RESET', {
      fill: '#5a2a2a', fillHot: '#a44',
    })) {
      act = { type: 'wipe' };
    }
  }
  return act;
}

// ---------------------------------------------------------------------------

const HELP_LINES: [string, string][] = [
  ['STEER', 'DRAG SIDEWAYS OR A/D'],
  ['CHARGE', 'DRAG UP: FASTER FIRE'],
  ['HOLD', 'DRAG DOWN: SAFER'],
  ['GATES', 'BLUE ADDS, RED TAKES'],
  ['LADDERS', 'HUG A +1 ROW TO STACK'],
  ['BOARDS', 'SHOOT ITS NUMBER TO 0'],
  ['WALLS', 'BLAST CRATES OR LOSE'],
  ['HORDE', 'EACH BODY COSTS ONE'],
  ['BOSS', 'IT CLOSES IN - HURRY'],
];

export function drawHelp(ui: UiContext): ScreenAction {
  const u = ui.u;
  const W = ui.w;
  let act: ScreenAction = NONE;
  scrim(ui, 0.9);
  let y = heading(ui, u * 12, 'HOW TO', 'FORWARD, HO!');

  // Two lines per entry: the label above its explanation. A side-by-side
  // column forces the copy into a narrow gutter and it stops being readable.
  const boxW = W - u * 12;
  const keySize = fitTextGroup(HELP_LINES.map((l) => l[0]), boxW - u * 10, ts(ui, 0.85));
  const valSize = fitTextGroup(HELP_LINES.map((l) => l[1]), boxW - u * 10, ts(ui, 0.85));
  const rowH = keySize * 8 + valSize * 9 + u * 2;
  const boxH = HELP_LINES.length * rowH + u * 8;
  panel(ui, u * 6, y, boxW, boxH, { fill: '#101827', alpha: 0.96, border: Math.max(1, u * 0.7) });
  y += u * 4;
  for (const [k, v] of HELP_LINES) {
    label(ui, k, u * 11, y, keySize, GOLD, 'left', true, 0);
    label(ui, v, u * 11, y + keySize * 8, valSize, '#d3dbe8', 'left', true, 0);
    y += rowH;
  }

  if (button(ui, 'hp.back', (W - u * 44) / 2, ui.h - u * 18, u * 44, u * 14, 'BACK', {
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
  scrim(ui, 0.76);
  heading(ui, ui.h * 0.2, 'PAUSED', '');

  const bw = Math.min(W * 0.76, u * 80);
  const bx = (W - bw) / 2;
  const bh = u * 15;
  const gap = u * 5;
  let by = ui.h * 0.38;

  if (button(ui, 'pz.resume', bx, by, bw, bh, 'RESUME', { fill: '#2f6ddb', fillHot: '#63a6ff' })) {
    act = { type: 'resume' };
  }
  by += bh + gap;
  if (button(ui, 'pz.restart', bx, by, bw, bh * 0.86, 'RESTART', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'restart' };
  }
  by += bh * 0.86 + gap;
  if (button(ui, 'pz.mute', bx, by, bw, bh * 0.86, muted ? 'MUTED' : 'SOUND ON', { fill: '#2a3141', fillHot: '#454f66' })) {
    act = { type: 'toggleMute' };
  }
  by += bh * 0.86 + gap;
  if (button(ui, 'pz.quit', bx, by, bw, bh * 0.86, 'ABANDON', { fill: '#5a2a2a', fillHot: '#a44' })) {
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
  scrim(ui, 0.82);

  const head = d.cleared ? 'SECTOR CLEAR' : 'ARMY LOST';
  const headColor = d.cleared ? GOLD : '#ff6a52';
  const s1 = Math.min(ts(ui, 2.4), fitText(head, W * 0.88));
  drawText(ui.p, head, W * 0.5, H * 0.1, s1, {
    color: headColor, outline: 1, outlineColor: '#5a2a00', shadow: 1, align: 'center', bold: true,
  });
  const s2 = ts(ui, 0.95);
  drawText(ui.p, d.levelName, W * 0.5, H * 0.1 + s1 * 8.6, s2, {
    color: SKY, outline: 1, align: 'center', bold: true,
  });

  const rows: [string, string, string][] = [
    ['PEAK ARMY', formatCount(d.stats.peakTroops), SKY],
    ['KILLS', formatCount(d.stats.kills), '#ffffff'],
    ['BEST COMBO', formatCount(d.stats.bestCombo), GOLD],
    ['DISTANCE', `${Math.round(d.stats.distance)}M`, '#d3dbe8'],
    ['WEAPON', `TIER ${d.stats.weaponTier + 1}`, '#c9a4ff'],
    ['SCORE', formatCount(d.stats.score), GOLD],
  ];

  const px = u * 7;
  const py = H * 0.24;
  const keySize = ts(ui, 0.9);
  const valSize = ts(ui, 1.15);
  const rowH = valSize * 9.4;
  panel(ui, px, py, W - px * 2, rows.length * rowH + u * 9, {
    fill: '#101827', alpha: 0.96, border: Math.max(1, u * 0.7),
  });

  for (let i = 0; i < rows.length; i++) {
    const [k, v, c] = rows[i];
    const revealT = clamp(d.reveal * rows.length - i, 0, 1);
    if (revealT <= 0) continue;
    const yy = py + u * 4.5 + i * rowH;
    label(ui, k, px + u * 6, yy + (valSize - keySize) * 3.5, keySize, DIM, 'left', true, 0);
    drawText(ui.p, v, W - px - u * 6, yy, valSize, {
      color: c, outline: 0, align: 'right', bold: true, alpha: revealT,
    });
  }

  const gy = py + rows.length * rowH + u * 15;
  const goldSize = ts(ui, 1.4);
  const gh = goldSize * 8 + u * 6;
  panel(ui, px, gy, W - px * 2, gh, { fill: '#2a2410', alpha: 0.96, border: Math.max(1, u * 0.7) });
  ui.p.sprite(ICON_COIN, px + u * 6 + goldSize * 3, gy + u * 3 + goldSize * 7, goldSize * 6.5, {});
  drawText(
    ui.p,
    `+${formatCount(Math.round(d.goldEarned * clamp(d.reveal * 1.3, 0, 1)))}`,
    W - px - u * 6, gy + u * 3, goldSize,
    { color: GOLD, outline: 1, align: 'right', bold: true },
  );
  label(ui, 'GOLD BANKED', px + u * 12 + goldSize * 5, gy + u * 3 + goldSize * 2, ts(ui, 0.75), '#c8a44a', 'left');

  const bw = Math.min(W * 0.8, u * 86);
  const bx = (W - bw) / 2;
  const bh = u * 15;
  const by = gy + gh + u * 8;

  if (button(ui, 'rs.continue', bx, by, bw, bh, 'TO BARRACKS', {
    fill: '#2f6ddb', fillHot: '#63a6ff',
  })) {
    act = { type: 'goto', screen: 'barracks' };
  }
  if (button(ui, 'rs.menu', bx, by + bh + u * 4, bw, u * 12, 'MENU', { fill: '#3a4356', fillHot: '#5a6478' })) {
    act = { type: 'quit' };
  }

  progressBar(ui, px, H - u * 6, W - px * 2, Math.max(2, u * 1.4), d.reveal, headColor, '#20242e');
  return act;
}
