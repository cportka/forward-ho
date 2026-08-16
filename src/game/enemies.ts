/**
 * The invasion.
 *
 * Two representations, blended together: individual marchers you can shoot,
 * and a "horde field" — the dense carpet of bodies stretching to the horizon
 * that recedes as you grind through it. The field spawns marchers off its near
 * edge, so the carpet and the fight are the same army.
 */

import { clamp, damp, hash2 } from '../core/math';
import { fx as rnd } from '../core/rng';
import type { Camera, Projected } from '../render/camera';
import type { Painter } from '../render/pixelbuffer';
import { mixHex } from '../render/palette';
import { ENEMIES, type EnemyDef, type EnemyKind } from './defs';

export interface Enemy {
  alive: boolean;
  id: number;
  kind: EnemyKind;
  def: EnemyDef;
  x: number;
  y: number;
  z: number;
  vx: number;
  hp: number;
  maxHp: number;
  gait: number;
  flash: number;
  fireT: number;
  /** Re-trigger guard so sustained fire strobes instead of bleaching. */
  flashCd: number;
  /** Death animation countdown; > 0 means it is falling apart. */
  dying: number;
  /** Slight per-enemy scale variation. */
  scale: number;
}

export interface HordeField {
  alive: boolean;
  /** Near edge (moves away as the horde is destroyed) and far edge. */
  z0: number;
  zStart: number;
  z1: number;
  x: number;
  halfW: number;
  remaining: number;
  total: number;
  /** Bodies the carpet loses per marcher killed — the mass is bigger than the
   * number of enemies actually simulated, which is what lets a horde stretch to
   * the horizon without burying the player. */
  perKill: number;
  spawnTimer: number;
  spawnInterval: number;
  kinds: EnemyKind[];
  hpScale: number;
  color: string;
  colorDark: string;
}

const MAX_ENEMIES = 260;
const MAX_FIELDS = 6;

export class EnemyManager {
  readonly list: Enemy[] = [];
  readonly fields: HordeField[] = [];
  live = 0;
  private head = 0;
  private nextId = 1;
  private order: number[] = [];

  constructor() {
    for (let i = 0; i < MAX_ENEMIES; i++) {
      this.list.push({
        alive: false, id: 0, kind: 'grunt', def: ENEMIES.grunt,
        x: 0, y: 0, z: 0, vx: 0, hp: 1, maxHp: 1,
        gait: 0, flash: 0, fireT: 0, flashCd: 0, dying: 0, scale: 1,
      });
    }
    for (let i = 0; i < MAX_FIELDS; i++) {
      this.fields.push({
        alive: false, z0: 0, zStart: 0, z1: 0, x: 0, halfW: 1,
        remaining: 0, total: 1, perKill: 1, spawnTimer: 0, spawnInterval: 0.3,
        kinds: ['grunt'], hpScale: 1, color: '#e0332f', colorDark: '#8a1418',
      });
    }
  }

  reset(): void {
    for (const e of this.list) e.alive = false;
    for (const f of this.fields) f.alive = false;
    this.live = 0;
  }

  spawn(kind: EnemyKind, x: number, z: number, hpScale = 1): Enemy | null {
    const def = ENEMIES[kind];
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.list[this.head];
      this.head = (this.head + 1) % MAX_ENEMIES;
      if (e.alive) continue;
      e.alive = true;
      e.id = this.nextId++;
      e.kind = kind;
      e.def = def;
      e.x = x;
      e.y = 0;
      e.z = z;
      e.vx = 0;
      e.hp = e.maxHp = def.hp * hpScale;
      e.gait = rnd.next() * 6.28;
      e.flash = 0;
      e.flashCd = 0;
      e.fireT = rnd.range(0.3, 1.4);
      e.dying = 0;
      e.scale = 0.92 + rnd.next() * 0.16;
      this.live++;
      return e;
    }
    return null;
  }

  addField(
    zStart: number, length: number, x: number, halfW: number,
    total: number, kinds: EnemyKind[], hpScale: number,
    color = '#e0332f', colorDark = '#8a1418',
  ): HordeField | null {
    for (const f of this.fields) {
      if (f.alive) continue;
      f.alive = true;
      f.zStart = f.z0 = zStart;
      f.z1 = zStart + length;
      f.x = x;
      f.halfW = halfW;
      f.remaining = f.total = Math.max(1, total);
      // Simulate only a slice of the mass as real marchers.
      const marchers = clamp(Math.round(total * 0.26), 10, 56);
      f.perKill = Math.max(1, total / marchers);
      f.spawnTimer = 0;
      // Pour those marchers out over the time it takes the squad to cross.
      f.spawnInterval = clamp(length / (marchers * 13), 0.05, 0.5);
      f.kinds = kinds;
      f.hpScale = hpScale;
      f.color = color;
      f.colorDark = colorDark;
      return f;
    }
    return null;
  }

  get fieldsRemaining(): number {
    let n = 0;
    for (const f of this.fields) if (f.alive) n += f.remaining;
    return n;
  }

  /** Called when a marcher that came from a field dies, so the carpet recedes. */
  creditField(z: number): void {
    let best: HordeField | null = null;
    let bestD = Infinity;
    for (const f of this.fields) {
      if (!f.alive || f.remaining <= 0) continue;
      const d = Math.abs(f.z0 - z);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) return;
    best.remaining = Math.max(0, best.remaining - best.perKill);
    const t = 1 - best.remaining / best.total;
    best.z0 = best.zStart + (best.z1 - best.zStart) * t;
    if (best.remaining <= 0) best.alive = false;
  }

  update(dt: number, playerX: number, playerZ: number, cullBehind: number): void {
    for (const f of this.fields) {
      if (!f.alive) continue;
      if (f.z0 > f.z1 || f.z1 < playerZ - 4) {
        f.alive = false;
        continue;
      }
      // Only pour enemies out once the player is close enough to see it.
      if (f.z0 - playerZ < 46) {
        f.spawnTimer -= dt;
        while (f.spawnTimer <= 0 && f.remaining > 0) {
          f.spawnTimer += f.spawnInterval;
          const kind = f.kinds[(Math.random() * f.kinds.length) | 0];
          const x = f.x + rnd.sym(f.halfW * 0.92);
          this.spawn(kind, x, f.z0 + rnd.range(-0.6, 1.4), f.hpScale);
        }
      }
    }

    for (const e of this.list) {
      if (!e.alive) continue;
      if (e.dying > 0) {
        e.dying -= dt;
        e.y = Math.max(0, e.y - dt * 2);
        if (e.dying <= 0) {
          e.alive = false;
          this.live--;
        }
        continue;
      }
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 9);
      if (e.flashCd > 0) e.flashCd -= dt;
      e.gait += dt * (4 + e.def.speed * 0.9);
      e.z -= e.def.speed * dt;
      // Gentle homing so the horde funnels onto the squad.
      const dx = playerX - e.x;
      e.vx = damp(e.vx, clamp(dx, -1, 1) * e.def.speed * 0.34, 2.2, dt);
      e.x += e.vx * dt;
      if (e.z < cullBehind) {
        e.alive = false;
        this.live--;
      }
    }
  }

  /** Applies damage; returns true if this hit killed the enemy. */
  damage(e: Enemy, amount: number): boolean {
    if (!e.alive || e.dying > 0) return false;
    e.hp -= amount * e.def.armor;
    if (e.flashCd <= 0) {
      e.flash = 1;
      e.flashCd = 0.17;
    }
    if (e.hp <= 0) {
      e.dying = 0.16;
      return true;
    }
    return false;
  }

  killImmediate(e: Enemy): void {
    if (!e.alive) return;
    e.alive = false;
    this.live--;
  }

  drawFields(p: Painter, cam: Camera, _proj: Projected, fogColor: string): void {
    for (const f of this.fields) {
      if (!f.alive) continue;
      const near = Math.max(f.z0, cam.z + 1.5);
      const far = Math.min(f.z1, cam.z + 190);
      if (far <= near) continue;

      // The bulk of the army: a tapering carpet with banded shading.
      let z = near;
      let guard = 0;
      while (z < far && guard++ < 420) {
        const s = cam.scaleAt(z);
        const rowDepth = Math.max(0.28, 2.4 / Math.max(0.6, s * 0.03));
        const zNext = Math.min(far, z + rowDepth);
        const sNext = cam.scaleAt(zNext);
        const y0 = cam.groundY(z);
        const y1 = cam.groundY(zNext);
        const x0 = cam.screenX(f.x - f.halfW, z);
        const x1 = cam.screenX(f.x + f.halfW, z);
        const x2 = cam.screenX(f.x + f.halfW, zNext);
        const x3 = cam.screenX(f.x - f.halfW, zNext);
        const fog = cam.fogAt(z);
        const band = hash2(Math.floor(z * 1.7), 3, 91);
        const base = band < 0.34 ? f.colorDark : f.color;
        p.quad(x0, y0, x1, y0, x2, y1, x3, y1, mixHex(base, fogColor, fog * 0.72));

        // Heads: a scatter of lighter pixels so the mass reads as bodies.
        const bodyH = 1.35 * s;
        const step = Math.max(1.2, 0.42 * s);
        const span = x1 - x0;
        if (span > 4 && bodyH > 2.5) {
          const cols = Math.min(46, Math.max(2, Math.floor(span / step)));
          for (let c = 0; c < cols; c++) {
            const t = (c + 0.5) / cols;
            const hx = x0 + span * t;
            const jitter = hash2(c, Math.floor(z * 3.1), 17);
            if (jitter < 0.22) continue;
            const hh = bodyH * (0.55 + jitter * 0.4);
            const hw = Math.max(1, step * 0.52);
            p.rect(hx - hw * 0.5, y0 - hh, hw, hh, mixHex(f.color, fogColor, fog * 0.6), 1);
            p.rect(
              hx - hw * 0.5, y0 - hh, hw, Math.max(1, hh * 0.3),
              mixHex('#ff9a86', fogColor, fog * 0.6), 0.85,
            );
          }
        }
        z = zNext;
        if (sNext > s * 4) break;
      }

      // A dark lip on the leading edge so the carpet has weight.
      const sy = cam.groundY(near);
      const lx0 = cam.screenX(f.x - f.halfW, near);
      const lx1 = cam.screenX(f.x + f.halfW, near);
      const s0 = cam.scaleAt(near);
      p.rect(lx0, sy - s0 * 0.06, lx1 - lx0, s0 * 0.12, '#000000', 0.3);
    }
  }

  drawEnemies(p: Painter, cam: Camera, proj: Projected, fogColor: string): void {
    this.order.length = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].alive) this.order.push(i);
    this.order.sort((a, b) => this.list[b].z - this.list[a].z);

    for (const idx of this.order) {
      const e = this.list[idx];
      cam.project(proj, e.x, e.y, e.z);
      if (!proj.visible) continue;
      const s = proj.s;
      const h = e.def.height * s * e.scale;
      if (h < 1.2) continue;

      const gy = cam.groundY(e.z);
      p.ellipse(proj.sx, gy, s * 0.18, s * 0.07, 'rgba(6,8,14,0.38)');

      const frames = e.def.frames;
      const frame = frames[frames.length > 1 ? (Math.floor(e.gait / Math.PI) & 1) % frames.length : 0];
      const fog = cam.fogAt(e.z);
      const dying = e.dying > 0;

      p.sprite(frame, proj.sx, proj.sy, h, {
        alpha: dying ? clamp(e.dying / 0.16, 0, 1) : 1,
        squashX: dying ? 1.25 : 1,
      });
      // Hit feedback is an additive wash, not a full white silhouette — under
      // sustained fire a hard tint would bleach the whole front line.
      if (e.flash > 0.02) {
        p.additive(true);
        p.sprite(frame, proj.sx, proj.sy, h, {
          tint: '#ffffff',
          variant: 'flash',
          alpha: Math.min(0.5, e.flash * 0.5),
          squashX: dying ? 1.25 : 1,
        });
        p.additive(false);
      }

      if (fog > 0.05) {
        // Cheap depth haze: a translucent slab of fog colour over the sprite.
        p.rect(proj.sx - h * 0.34, proj.sy - h, h * 0.68, h, fogColor, fog * 0.55);
      }

      // Health pips for the beefy ones.
      if (e.maxHp > 60 && e.hp < e.maxHp && s > 10) {
        const w = h * 0.72;
        const bh = Math.max(1, s * 0.035);
        p.rect(proj.sx - w / 2, proj.sy - h - bh * 2.4, w, bh, '#12151c', 0.9);
        p.rect(proj.sx - w / 2, proj.sy - h - bh * 2.4, w * clamp(e.hp / e.maxHp, 0, 1), bh, '#ff4a3d', 1);
      }
    }
  }
}
