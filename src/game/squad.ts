/**
 * The player's marching crowd.
 *
 * Units sit on a phyllotaxis disc squashed along Z so the formation reads as a
 * wedge from the chase camera. Each unit springs toward its slot, which makes
 * the whole blob slosh when you steer — the signature feel of the genre.
 */

import { clamp, damp, TAU } from '../core/math';
import { fx as rnd } from '../core/rng';
import { ROAD_HALF, type Camera, type Projected } from '../render/camera';
import type { Painter } from '../render/pixelbuffer';
import type { SpriteDef } from '../render/sprite';
import {
  SPR_ALLY_A, SPR_ALLY_B, SPR_ALLY_FIRE,
  SPR_REDCOAT_A, SPR_REDCOAT_B, SPR_REDCOAT_FIRE,
  SPR_SOLDIER_A, SPR_SOLDIER_B, SPR_SOLDIER_FIRE,
} from '../render/art';
import { withAlpha } from '../render/palette';

export const MAX_UNITS = 480;
/** Spacing between formation slots, in world units. */
const SLOT = 0.30;
/**
 * Packing exponent. A true disc would use 0.5; going tighter than that lets the
 * crowd overlap more and more as it grows, which is what keeps a 400-strong
 * army looking like a dense wedge instead of swallowing the whole road.
 */
const PACK = 0.42;
/** Hard cap on the formation radius so the crowd never spills off the road. */
const MAX_RADIUS = 2.7;
const GOLDEN = 2.39996323;

export type UnitSkin = 'blue' | 'red' | 'ally';

const SKINS: Record<UnitSkin, { walk: [SpriteDef, SpriteDef]; fire: SpriteDef; ring: string }> = {
  blue: { walk: [SPR_SOLDIER_A, SPR_SOLDIER_B], fire: SPR_SOLDIER_FIRE, ring: '#63d8ff' },
  red: { walk: [SPR_REDCOAT_A, SPR_REDCOAT_B], fire: SPR_REDCOAT_FIRE, ring: '#5cff8f' },
  ally: { walk: [SPR_ALLY_A, SPR_ALLY_B], fire: SPR_ALLY_FIRE, ring: '#b9ffec' },
};

interface Unit {
  active: boolean;
  slot: number;
  /** Current world position. */
  x: number;
  z: number;
  y: number;
  /** Vertical velocity for the join hop. */
  vy: number;
  gait: number;
  fireGlow: number;
  spawn: number;
  skin: UnitSkin;
}

export interface MuzzlePoint {
  x: number;
  y: number;
  z: number;
}

export class Squad {
  units: Unit[] = [];
  /** Live unit count — the number the player actually watches. */
  count = 0;

  x = 0;
  z = 0;
  /** Forward speed in world units per second. */
  speed = 12;
  baseSpeed = 12;

  /** Lateral velocity, for lean and slosh. */
  vx = 0;
  lean = 0;

  skin: UnitSkin = 'blue';

  shieldTime = 0;
  dashTime = 0;
  hurtFlash = 0;

  private order: number[] = [];
  private orderDirty = true;
  private gaitClock = 0;
  private formScale = 1;
  private slotBuf = { ox: 0, oz: 0 };

  constructor() {
    for (let i = 0; i < MAX_UNITS; i++) {
      this.units.push({
        active: false, slot: i, x: 0, z: 0, y: 0, vy: 0,
        gait: 0, fireGlow: 0, spawn: 0, skin: 'blue',
      });
    }
  }

  reset(count: number, skin: UnitSkin, z = 0): void {
    this.skin = skin;
    this.x = 0;
    this.z = z;
    this.vx = 0;
    this.lean = 0;
    this.shieldTime = 0;
    this.dashTime = 0;
    this.hurtFlash = 0;
    this.count = 0;
    for (const u of this.units) {
      u.active = false;
      u.y = 0;
      u.vy = 0;
      u.spawn = 0;
      u.fireGlow = 0;
      u.skin = skin;
    }
    this.add(Math.max(1, count), false);
    for (const u of this.units) {
      if (!u.active) continue;
      u.spawn = 1;
      this.slot(u.slot, this.slotBuf);
      u.x = this.x + this.slotBuf.ox;
      u.z = this.z + this.slotBuf.oz;
    }
    this.orderDirty = true;
  }

  /** Radius of the formation disc, world units. */
  get radius(): number {
    return Math.min(MAX_RADIUS, SLOT * Math.pow(Math.max(1, this.count), PACK)) + 0.2;
  }

  /** Shrinks slot offsets once the army outgrows the road. */
  private updateForm(): void {
    const want = SLOT * Math.pow(Math.max(1, this.count), PACK);
    this.formScale = want > MAX_RADIUS ? MAX_RADIUS / want : 1;
  }

  private slot(i: number, out: { ox: number; oz: number }): void {
    const s = slotOffset(i);
    out.ox = s.ox * this.formScale;
    out.oz = s.oz * this.formScale;
  }

  get alive(): boolean {
    return this.count > 0;
  }

  add(n: number, animate = true, skin?: UnitSkin): number {
    const target = Math.min(MAX_UNITS, this.count + Math.max(0, Math.floor(n)));
    const added = target - this.count;
    this.count = target;
    this.updateForm();
    for (let i = target - added; i < target; i++) {
      const u = this.units[i];
      u.active = true;
      u.slot = i;
      u.skin = skin ?? this.skin;
      const s = this.slotBuf;
      this.slot(i, s);
      if (animate) {
        // New recruits drop in from the side with a hop.
        u.x = this.x + s.ox * 1.9 + rnd.sym(0.6);
        u.z = this.z + s.oz * 1.9;
        u.y = 1.6 + rnd.next() * 1.2;
        u.vy = 2.2;
        u.spawn = 0;
      } else {
        u.x = this.x + s.ox;
        u.z = this.z + s.oz;
        u.y = 0;
        u.vy = 0;
        u.spawn = 1;
      }
      u.gait = rnd.next() * TAU;
      u.fireGlow = 0;
    }
    this.orderDirty = true;
    return added;
  }

  /** Removes up to `n` units; returns how many were actually lost. */
  remove(n: number): number {
    const lost = Math.min(this.count, Math.max(0, Math.floor(n)));
    for (let i = this.count - lost; i < this.count; i++) this.units[i].active = false;
    this.count -= lost;
    if (lost > 0) {
      this.hurtFlash = 1;
      this.orderDirty = true;
      this.updateForm();
    }
    return lost;
  }

  /** World positions of the units about to be removed — used for death puffs. */
  tailPositions(n: number, out: { x: number; y: number; z: number }[]): number {
    const k = Math.min(n, this.count, out.length);
    for (let i = 0; i < k; i++) {
      const u = this.units[this.count - 1 - i];
      out[i].x = u.x;
      out[i].y = u.y;
      out[i].z = u.z;
    }
    return k;
  }

  applyShield(seconds: number): void {
    this.shieldTime = Math.max(this.shieldTime, seconds);
  }

  applyDash(seconds: number): void {
    this.dashTime = Math.max(this.dashTime, seconds);
  }

  /** How many units visibly fire; the rest contribute damage through them. */
  get shooterCount(): number {
    return clamp(Math.round(Math.sqrt(this.count) * 1.9), 1, 26);
  }

  /** Damage multiplier applied to each bullet so DPS scales with the crowd. */
  get firepower(): number {
    return this.count / this.shooterCount;
  }

  /** Fills `out` with muzzle points for the frontmost units. */
  muzzles(out: MuzzlePoint[]): number {
    const n = Math.min(this.shooterCount, this.count, out.length);
    for (let i = 0; i < n; i++) {
      const u = this.units[frontSlot(i, this.count)];
      out[i].x = u.x + 0.12;
      out[i].y = u.y + 0.78;
      out[i].z = u.z + 0.18;
      u.fireGlow = 1;
    }
    return n;
  }

  update(dt: number, steer: number, roadHalf = ROAD_HALF): void {
    const dashing = this.dashTime > 0;
    if (dashing) this.dashTime = Math.max(0, this.dashTime - dt);
    if (this.shieldTime > 0) this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3.2);

    this.speed = damp(this.speed, this.baseSpeed * (dashing ? 1.85 : 1), 3.4, dt);
    this.z += this.speed * dt;

    const limit = Math.max(0.4, roadHalf - this.radius * 0.55);
    const targetX = clamp(steer * roadHalf * 1.06, -limit, limit);
    const prevX = this.x;
    this.x = damp(this.x, targetX, 9.5, dt);
    this.vx = dt > 0 ? (this.x - prevX) / dt : 0;
    this.lean = damp(this.lean, clamp(this.vx / 9, -1, 1), 8, dt);

    this.gaitClock += dt * (7.5 + this.speed * 0.22);

    if (this.orderDirty) this.rebuildOrder();

    const springs = 13 + Math.min(9, this.count * 0.02);
    for (let i = 0; i < this.count; i++) {
      const u = this.units[i];
      const s = this.slotBuf;
      this.slot(i, s);
      // Units at the back trail a touch more, which makes the blob deform.
      const lag = 1 - clamp((s.oz + this.radius) / (this.radius * 2 + 0.001), 0, 1) * 0.35;
      u.x = damp(u.x, this.x + s.ox, springs * lag, dt);
      u.z = damp(u.z, this.z + s.oz, springs * lag * 1.15, dt);
      if (u.y > 0 || u.vy !== 0) {
        u.vy -= 15 * dt;
        u.y += u.vy * dt;
        if (u.y <= 0) {
          u.y = 0;
          u.vy = 0;
        }
      }
      if (u.spawn < 1) u.spawn = Math.min(1, u.spawn + dt * 3.6);
      u.gait += dt * (7.5 + this.speed * 0.22);
      if (u.fireGlow > 0) u.fireGlow = Math.max(0, u.fireGlow - dt * 9);
    }
  }

  private rebuildOrder(): void {
    this.order.length = this.count;
    for (let i = 0; i < this.count; i++) this.order[i] = i;
    // Painter's algorithm: draw the far rows first.
    this.order.sort((a, b) => slotOffset(b).oz - slotOffset(a).oz);
    this.orderDirty = false;
  }

  draw(p: Painter, cam: Camera, proj: Projected, time: number): void {
    if (this.orderDirty) this.rebuildOrder();
    const skin = SKINS[this.skin];
    const shield = this.shieldTime > 0;
    const hurt = this.hurtFlash > 0.02;

    // Ground rings & shadows. Above a certain size the per-unit shadows stack
    // into a black disc, so the crowd gets one pooled shadow instead.
    const dense = this.count > 110;
    if (dense) {
      cam.project(proj, this.x, 0, this.z);
      if (proj.visible) {
        p.ellipse(proj.sx, proj.sy, this.radius * proj.s * 1.05, this.radius * proj.s * 0.44, 'rgba(6,8,14,0.34)');
      }
    }
    for (let i = 0; i < this.order.length; i++) {
      const u = this.units[this.order[i]];
      if (!u.active) continue;
      cam.project(proj, u.x, 0, u.z);
      if (!proj.visible) continue;
      const s = proj.s;
      if (s < 3) continue;
      if (!dense) p.ellipse(proj.sx, proj.sy, s * 0.13, s * 0.055, 'rgba(6,8,14,0.4)');
      if (s > 9 && this.count < 130) {
        const pulse = 0.55 + 0.45 * Math.sin(time * 3.4 + u.slot * 0.7);
        p.ring(proj.sx, proj.sy, s * 0.16, s * 0.065, Math.max(1, s * 0.018), skin.ring, 0.45 + pulse * 0.3);
      }
    }

    for (let i = 0; i < this.order.length; i++) {
      const u = this.units[this.order[i]];
      if (!u.active) continue;
      cam.project(proj, u.x, u.y, u.z);
      if (!proj.visible) continue;
      const s = proj.s;
      const h = 0.98 * s * (0.55 + 0.45 * u.spawn);
      if (h < 1.5) continue;

      const firing = u.fireGlow > 0.25;
      const def = firing ? skin.fire : skin.walk[(Math.floor(u.gait / Math.PI) & 1) as 0 | 1];
      const tint = hurt && this.hurtFlash > 0.5 ? '#ffd6d6' : undefined;
      p.sprite(def, proj.sx, proj.sy, h, {
        tint,
        variant: tint ? 'hurt' : '',
        squashX: 1 + this.lean * 0.1,
      });

      if (firing && s > 8) {
        p.additive(true);
        p.ellipse(proj.sx + s * 0.16, proj.sy - h * 0.72, s * 0.09, s * 0.07, '#fff6c9', u.fireGlow * 0.9);
        p.additive(false);
      }
    }

    if (shield) {
      cam.project(proj, this.x, 0.9, this.z);
      if (proj.visible) {
        const r = (this.radius + 0.7) * proj.s;
        const a = 0.28 + 0.16 * Math.sin(time * 9);
        p.ring(proj.sx, proj.sy, r, r * 0.42, Math.max(2, proj.s * 0.05), '#8ff2ec', a + 0.35);
        p.ellipse(proj.sx, proj.sy, r, r * 0.42, withAlpha('#2ec9c0', 1), a * 0.5);
      }
    }
  }
}

// Slot geometry is pure and hot, so it is cached in flat arrays.
const slotX = new Float32Array(MAX_UNITS);
const slotZ = new Float32Array(MAX_UNITS);
{
  for (let i = 0; i < MAX_UNITS; i++) {
    const a = i * GOLDEN;
    const r = SLOT * Math.pow(i + 0.6, PACK);
    slotX[i] = Math.cos(a) * r;
    // Squashed along Z: the crowd is wider than it is deep, like the reference.
    slotZ[i] = Math.sin(a) * r * 0.72;
  }
}

const slotScratch = { ox: 0, oz: 0 };
function slotOffset(i: number): { ox: number; oz: number } {
  const k = i < 0 ? 0 : i >= MAX_UNITS ? MAX_UNITS - 1 : i;
  slotScratch.ox = slotX[k];
  slotScratch.oz = slotZ[k];
  return slotScratch;
}

/** Index of the `i`-th frontmost unit, for muzzle placement. */
const frontOrderCache: { count: number; order: Int32Array } = { count: -1, order: new Int32Array(0) };
function frontSlot(i: number, count: number): number {
  if (frontOrderCache.count !== count) {
    const idx = new Int32Array(count);
    for (let k = 0; k < count; k++) idx[k] = k;
    const arr = Array.from(idx).sort((a, b) => slotZ[b] - slotZ[a]);
    frontOrderCache.order = Int32Array.from(arr);
    frontOrderCache.count = count;
  }
  const o = frontOrderCache.order;
  return o.length === 0 ? 0 : o[i % o.length];
}
