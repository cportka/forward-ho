/**
 * Lane furniture: multiplier gates, shoot-through reward boards, destructible
 * barricades and coin pickups.
 */

import { clamp, hash2 } from '../core/math';
import { fx as rnd } from '../core/rng';
import type { Camera, Projected } from '../render/camera';
import type { Painter } from '../render/pixelbuffer';
import { drawText, measureText } from '../render/font';
import { mixHex, shade } from '../render/palette';
import type { SpriteDef } from '../render/sprite';
import { ICON_BOLT, ICON_COIN, ICON_RIFLE, ICON_SHIELD, ICON_SOLDIER, SPR_BARREL, SPR_CRATE, SPR_PLANK, SPR_SANDBAG } from '../render/art';
import { GATE_STYLES, gateLabel, type GateOp } from './defs';

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export type Reward =
  | { kind: 'units'; amount: number }
  | { kind: 'weapon'; steps: number }
  | { kind: 'coins'; amount: number }
  | { kind: 'shield'; seconds: number }
  | { kind: 'dash'; seconds: number };

export function rewardIcon(r: Reward): SpriteDef {
  switch (r.kind) {
    case 'units':
      return ICON_SOLDIER;
    case 'weapon':
      return ICON_RIFLE;
    case 'coins':
      return ICON_COIN;
    case 'shield':
      return ICON_SHIELD;
    case 'dash':
      return ICON_BOLT;
  }
}

export function rewardLabel(r: Reward): string {
  switch (r.kind) {
    case 'units':
      return `+${r.amount} TROOPS`;
    case 'weapon':
      return r.steps > 1 ? `WEAPON +${r.steps}` : 'WEAPON UP';
    case 'coins':
      return `+${r.amount} GOLD`;
    case 'shield':
      return 'SHIELD UP';
    case 'dash':
      return 'DOUBLE TIME';
  }
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export interface Gate {
  alive: boolean;
  z: number;
  x: number;
  halfW: number;
  height: number;
  op: GateOp;
  value: number;
  taken: boolean;
  flash: number;
  /** Purely visual: gates in a ladder shimmer out of phase. */
  phase: number;
}

export class Gates {
  readonly list: Gate[] = [];

  reset(): void {
    this.list.length = 0;
  }

  add(z: number, x: number, halfW: number, op: GateOp, value: number): Gate {
    const g: Gate = {
      alive: true, z, x, halfW, height: 1.2, op, value,
      taken: false, flash: 0, phase: rnd.next() * 6.28,
    };
    this.list.push(g);
    return g;
  }

  /** A long run of small gates hugging one side, like the reference clips. */
  addLadder(z: number, x: number, halfW: number, op: GateOp, value: number, count: number, spacing: number): void {
    for (let i = 0; i < count; i++) this.add(z + i * spacing, x, halfW, op, value);
  }

  cull(behindZ: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].z < behindZ) this.list.splice(i, 1);
    }
  }

  update(dt: number): void {
    for (const g of this.list) if (g.flash > 0) g.flash = Math.max(0, g.flash - dt * 3);
  }

  draw(p: Painter, cam: Camera, proj: Projected, fogColor: string, time: number): void {
    const sorted = this.list.slice().sort((a, b) => b.z - a.z);
    for (const g of sorted) {
      if (g.z - cam.z < 3.4) continue;
      cam.project(proj, g.x, 0, g.z);
      if (!proj.visible) continue;
      const s = proj.s;
      if (s < 1.2) continue;
      const w = g.halfW * 2 * s;
      const h = g.height * s;
      if (w < 3 || h < 3) continue;

      const st = GATE_STYLES[g.op];
      const fog = cam.fogAt(g.z);
      const x0 = proj.sx - w / 2;
      const y0 = proj.sy - h;
      const taken = g.taken;
      const alpha = taken ? 0.18 : 0.94;

      const body = mixHex(st.body, fogColor, fog * 0.6);
      const light = mixHex(st.bodyLight, fogColor, fog * 0.6);
      const edge = mixHex(st.edge, fogColor, fog * 0.6);
      const post = Math.max(1, s * 0.075);

      // Panel with a lit top band and a shaded lower half.
      p.rect(x0, y0, w, h, body, alpha);
      p.rect(x0, y0, w, Math.max(1, h * 0.26), light, alpha * 0.95);
      p.rect(x0, y0 + h * 0.72, w, h * 0.28, edge, alpha * 0.8);
      p.strokeRect(x0, y0, w, h, Math.max(1, s * 0.035), edge, alpha);

      // Support posts.
      p.rect(x0 - post, y0 + h * 0.05, post, h * 1.02, edge, alpha);
      p.rect(x0 + w, y0 + h * 0.05, post, h * 1.02, edge, alpha);

      // Shimmer sweep.
      if (!taken && s > 6) {
        const t = (time * 0.55 + g.phase) % 2;
        if (t < 1) {
          const sx = x0 + w * t;
          p.rect(sx - w * 0.06, y0, w * 0.12, h, '#ffffff', 0.18);
        }
      }

      if (g.flash > 0) {
        p.additive(true);
        p.rect(x0 - post, y0 - h * 0.1, w + post * 2, h * 1.2, st.bodyLight, g.flash * 0.55);
        p.additive(false);
      }

      const label = gateLabel(g.op, g.value);
      // Long labels (SHIELD, DASH) have to shrink to fit the plate; short ones
      // stay big and legible from a long way down the road.
      const mono = label.length <= 4;
      const unitW = measureText(label, 1, { bold: true, mono });
      const px = Math.max(1, Math.min(Math.round(h * 0.5 / 7), Math.floor((w * 0.86) / Math.max(1, unitW))));
      if (!taken) {
        drawText(p, label, proj.sx, y0 + h * 0.5 - px * 3.5, px, {
          color: st.text,
          outline: 1,
          outlineColor: '#0b0d14',
          align: 'center',
          bold: true,
          mono,
          alpha: 1 - fog * 0.5,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reward boards — shoot the number down to zero to claim the prize
// ---------------------------------------------------------------------------

export interface Board {
  alive: boolean;
  z: number;
  x: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  reward: Reward;
  icon: SpriteDef;
  flash: number;
  shake: number;
  broken: boolean;
  /** Number currently shown; lags `hp` so the counter can punch as it ticks. */
  shown: number;
  pop: number;
}

export class Boards {
  readonly list: Board[] = [];

  reset(): void {
    this.list.length = 0;
  }

  add(z: number, x: number, hp: number, reward: Reward, w = 2.5, h = 2.6): Board {
    const b: Board = {
      alive: true, z, x, w, h, hp, maxHp: hp, reward,
      icon: rewardIcon(reward), flash: 0, shake: 0, broken: false,
      shown: hp, pop: 0,
    };
    this.list.push(b);
    return b;
  }

  cull(behindZ: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].z < behindZ || !this.list[i].alive) this.list.splice(i, 1);
    }
  }

  update(dt: number): void {
    for (const b of this.list) {
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 5);
      if (b.shake > 0) b.shake = Math.max(0, b.shake - dt * 6);
      if (b.pop > 0) b.pop = Math.max(0, b.pop - dt * 6);
      // The counter chases the real HP; each visible tick punches the scale.
      const target = Math.max(0, b.hp);
      if (b.shown !== target) {
        const next = target + (b.shown - target) * Math.exp(-14 * dt);
        if (Math.ceil(next) !== Math.ceil(b.shown)) b.pop = Math.min(1, b.pop + 0.5);
        b.shown = Math.abs(next - target) < 0.6 ? target : next;
      }
    }
  }

  draw(p: Painter, cam: Camera, proj: Projected, fogColor: string): void {
    const sorted = this.list.slice().sort((a, b) => b.z - a.z);
    for (const b of sorted) {
      if (!b.alive || b.z - cam.z < 3.4) continue;
      const jitter = b.shake > 0 ? Math.sin(b.shake * 60) * b.shake * 0.08 : 0;
      cam.project(proj, b.x + jitter, 0, b.z);
      if (!proj.visible) continue;
      const s = proj.s;
      const w = b.w * s;
      const h = b.h * s;
      if (w < 6 || h < 6) continue;

      const fog = cam.fogAt(b.z);
      const x0 = proj.sx - w / 2;
      const legH = h * 0.22;
      const y0 = proj.sy - h - legH;

      // Legs.
      const legW = Math.max(1, s * 0.12);
      p.rect(proj.sx - w * 0.32, proj.sy - legH * 1.05, legW, legH * 1.05, mixHex('#3a4150', fogColor, fog * 0.6));
      p.rect(proj.sx + w * 0.32 - legW, proj.sy - legH * 1.05, legW, legH * 1.05, mixHex('#3a4150', fogColor, fog * 0.6));

      // Panel: dark bezel, bright face, inner shadow.
      const bezel = Math.max(1, s * 0.06);
      p.rect(x0 - bezel, y0 - bezel, w + bezel * 2, h + bezel * 2, mixHex('#20242e', fogColor, fog * 0.5));
      const face = mixHex('#f2f4f8', fogColor, fog * 0.55);
      p.rect(x0, y0, w, h, face);
      p.rect(x0, y0, w, Math.max(1, h * 0.08), mixHex('#ffffff', fogColor, fog * 0.5));
      p.rect(x0, y0 + h * 0.9, w, h * 0.1, mixHex('#c8cdd6', fogColor, fog * 0.5));

      // Damage cracks grow as the board is worn down.
      const dmg = 1 - clamp(b.hp / b.maxHp, 0, 1);
      if (dmg > 0.08) {
        const cracks = Math.floor(dmg * 14);
        for (let i = 0; i < cracks; i++) {
          const cx = x0 + hash2(i, 1, 7) * w;
          const cy = y0 + hash2(i, 2, 7) * h;
          const cw = Math.max(1, s * 0.05 * (0.5 + hash2(i, 3, 7)));
          p.rect(cx, cy, cw, cw * (1 + hash2(i, 4, 7) * 2), '#8a8f99', 0.7);
        }
      }

      // The icon starts as flat line-art and fills with colour from the top
      // down as the number is shot away — the reference clips' signature tell.
      const iconH = h * 0.46;
      const iconTop = y0 + h * 0.58 - iconH;
      const fill = 1 - clamp(b.shown / Math.max(1, b.maxHp), 0, 1);
      p.sprite(b.icon, proj.sx, y0 + h * 0.58, iconH, {
        tint: '#c3c9d4',
        variant: 'ghost',
        alpha: 1 - fog * 0.4,
      });
      if (fill > 0.001) {
        const fh = iconH * fill;
        p.pushClip(proj.sx - w * 0.5, iconTop, w, fh);
        p.sprite(b.icon, proj.sx, y0 + h * 0.58, iconH, { alpha: 1 - fog * 0.4 });
        p.popClip();
        // Hot edge riding the fill line.
        p.additive(true);
        p.rect(proj.sx - iconH * 0.42, iconTop + fh - Math.max(1, s * 0.03), iconH * 0.84, Math.max(1, s * 0.06), '#ffd447', 0.85);
        p.additive(false);
      }

      const pop = 1 + b.pop * 0.22;
      const num = String(Math.max(0, Math.ceil(b.shown)));
      const numUnit = measureText(num, 1, { bold: true, mono: true });
      const px = Math.max(
        1,
        Math.min(Math.round(h * 0.17 * pop), Math.floor((w * 0.82 * pop) / Math.max(1, numUnit))),
      );
      drawText(p, num, proj.sx, y0 + h * 0.7, px, {
        color: '#20242e',
        outline: 1,
        outlineColor: '#ffffff',
        align: 'center',
        bold: true,
        mono: true,
      });

      const cap = rewardLabel(b.reward);
      const capPx = Math.max(1, Math.round(h * 0.036));
      if (capPx >= 1 && measureText(cap, capPx) < w * 1.4) {
        drawText(p, cap, proj.sx, y0 - bezel - capPx * 9, capPx, {
          color: '#ffd447',
          outline: 1,
          outlineColor: '#0b0d14',
          align: 'center',
          bold: true,
        });
      }

      if (b.flash > 0) {
        p.additive(true);
        p.rect(x0, y0, w, h, '#ffffff', b.flash * 0.5);
        p.additive(false);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Barricades — grids of destructible cells
// ---------------------------------------------------------------------------

export type BarricadeKind = 'crate' | 'plank' | 'barrel' | 'sandbag';

const BARRICADE_ART: Record<BarricadeKind, { sprite: SpriteDef; tint: string; cell: number }> = {
  crate: { sprite: SPR_CRATE, tint: '#a9702f', cell: 1.0 },
  plank: { sprite: SPR_PLANK, tint: '#d09a4e', cell: 1.0 },
  barrel: { sprite: SPR_BARREL, tint: '#c94b1e', cell: 0.9 },
  sandbag: { sprite: SPR_SANDBAG, tint: '#e4c48a', cell: 1.0 },
};

export interface Barricade {
  alive: boolean;
  z: number;
  x: number;
  cols: number;
  rows: number;
  cell: number;
  kind: BarricadeKind;
  hp: Float32Array;
  cellHp: number;
  /** Bit of per-cell flash, packed the same way as hp. */
  flash: Float32Array;
  remaining: number;
}

export class Barricades {
  readonly list: Barricade[] = [];

  reset(): void {
    this.list.length = 0;
  }

  add(z: number, x: number, cols: number, rows: number, kind: BarricadeKind, cellHp: number): Barricade {
    const art = BARRICADE_ART[kind];
    const b: Barricade = {
      alive: true, z, x, cols, rows, cell: art.cell, kind,
      hp: new Float32Array(cols * rows).fill(cellHp),
      flash: new Float32Array(cols * rows),
      cellHp,
      remaining: cols * rows,
    };
    this.list.push(b);
    return b;
  }

  cull(behindZ: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (b.z < behindZ || b.remaining <= 0) this.list.splice(i, 1);
    }
  }

  update(dt: number): void {
    for (const b of this.list) {
      for (let i = 0; i < b.flash.length; i++) {
        if (b.flash[i] > 0) b.flash[i] = Math.max(0, b.flash[i] - dt * 5);
      }
    }
  }

  /** World-space centre of a cell. */
  cellPos(b: Barricade, col: number, row: number, out: { x: number; y: number; z: number }): void {
    out.x = b.x + (col - (b.cols - 1) / 2) * b.cell;
    out.y = (row + 0.5) * b.cell;
    out.z = b.z;
  }

  draw(p: Painter, cam: Camera, proj: Projected, fogColor: string): void {
    const sorted = this.list.slice().sort((a, b) => b.z - a.z);
    for (const b of sorted) {
      if (b.z - cam.z < 3.4) continue;
      cam.project(proj, b.x, 0, b.z);
      if (!proj.visible) continue;
      const s = proj.s;
      const cellPx = b.cell * s;
      if (cellPx < 1.5) continue;
      const fog = cam.fogAt(b.z);
      const art = BARRICADE_ART[b.kind];
      const left = proj.sx - (b.cols * cellPx) / 2;
      const base = proj.sy;

      for (let row = 0; row < b.rows; row++) {
        for (let col = 0; col < b.cols; col++) {
          const i = row * b.cols + col;
          if (b.hp[i] <= 0) continue;
          const cx = left + (col + 0.5) * cellPx;
          const cy = base - row * cellPx;
          const hurt = 1 - b.hp[i] / b.cellHp;
          const flash = b.flash[i];
          p.sprite(art.sprite, cx, cy, cellPx, {
            tint: flash > 0.4 ? '#ffffff' : undefined,
            variant: flash > 0.4 ? 'flash' : '',
            alpha: 1 - fog * 0.35,
          });
          if (hurt > 0.35) {
            p.rect(cx - cellPx * 0.4, cy - cellPx * 0.8, cellPx * 0.8, cellPx * 0.7, '#2a1408', hurt * 0.35);
          }
        }
      }

      if (fog > 0.04) {
        p.rect(left, base - b.rows * cellPx, b.cols * cellPx, b.rows * cellPx, fogColor, fog * 0.4);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

export interface Coin {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  life: number;
  magnet: boolean;
  value: number;
}

const MAX_COINS = 220;

export class Coins {
  readonly list: Coin[] = [];
  private head = 0;

  constructor() {
    for (let i = 0; i < MAX_COINS; i++) {
      this.list.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, life: 0, magnet: false, value: 1 });
    }
  }

  reset(): void {
    for (const c of this.list) c.alive = false;
  }

  spawn(x: number, y: number, z: number, value = 1, spread = 2.2): void {
    for (let i = 0; i < MAX_COINS; i++) {
      const c = this.list[this.head];
      this.head = (this.head + 1) % MAX_COINS;
      if (c.alive) continue;
      c.alive = true;
      c.x = x;
      c.y = y + 0.3;
      c.z = z;
      c.vx = rnd.sym(spread);
      c.vy = 3 + rnd.next() * 3.5;
      c.vz = rnd.sym(spread) - 1.4;
      c.spin = rnd.next() * 6.28;
      c.life = 6;
      c.magnet = false;
      c.value = value;
      return;
    }
  }

  /** Returns the total value collected this frame. */
  update(dt: number, px: number, pz: number, radius: number, magnetRange: number): number {
    let collected = 0;
    for (const c of this.list) {
      if (!c.alive) continue;
      c.life -= dt;
      c.spin += dt * 9;
      const dx = px - c.x;
      const dz = pz - c.z;
      const d2 = dx * dx + dz * dz;
      if (!c.magnet && d2 < magnetRange * magnetRange) c.magnet = true;
      if (c.magnet) {
        const d = Math.max(0.001, Math.sqrt(d2));
        const pull = 34;
        c.vx += (dx / d) * pull * dt;
        c.vz += (dz / d) * pull * dt;
        c.vy += (0.7 - c.y) * 10 * dt;
        c.vx *= Math.exp(-3 * dt);
        c.vz *= Math.exp(-3 * dt);
      } else {
        c.vy -= 16 * dt;
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      if (c.y < 0.25) {
        c.y = 0.25;
        c.vy = Math.abs(c.vy) * 0.34;
        c.vx *= 0.7;
        c.vz *= 0.7;
      }
      const grab = radius * 0.7 + 0.5;
      if (d2 < grab * grab) {
        c.alive = false;
        collected += c.value;
        continue;
      }
      if (c.life <= 0 || c.z < pz - 8) c.alive = false;
    }
    return collected;
  }

  draw(p: Painter, cam: Camera, proj: Projected): void {
    for (const c of this.list) {
      if (!c.alive) continue;
      cam.project(proj, c.x, c.y, c.z);
      if (!proj.visible) continue;
      const s = proj.s;
      const h = 0.4 * s;
      if (h < 1.2) continue;
      const squash = Math.abs(Math.cos(c.spin));
      p.ellipse(proj.sx, cam.groundY(c.z), s * 0.1, s * 0.04, 'rgba(6,8,14,0.32)');
      p.sprite(ICON_COIN, proj.sx, proj.sy + h / 2, h, { squashX: 0.25 + squash * 0.75 });
      p.additive(true);
      p.ellipse(proj.sx, proj.sy, h * 0.7, h * 0.7, '#ffe27a', 0.22);
      p.additive(false);
    }
  }
}

/** Kept so the shade helper stays exercised by the barricade tinting work. */
export const PROP_HIGHLIGHT = shade('#a9702f', 0.25);
