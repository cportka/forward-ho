/** Pooled projectiles for both sides, drawn as additive pixel streaks. */

import type { Camera, Projected } from '../render/camera';
import type { Painter } from '../render/pixelbuffer';
import type { ProjectileStyle } from './defs';

export interface Bullet {
  alive: boolean;
  hostile: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  pierce: number;
  hitMask: number;
  life: number;
  style: ProjectileStyle;
  color: string;
  glow: string;
  size: number;
  trail: number;
}

const MAX_BULLETS = 900;

export class Bullets {
  readonly list: Bullet[] = [];
  private head = 0;
  live = 0;

  constructor() {
    for (let i = 0; i < MAX_BULLETS; i++) {
      this.list.push({
        alive: false, hostile: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        damage: 0, pierce: 0, hitMask: 0, life: 0,
        style: 'bullet', color: '#fff', glow: '#fff', size: 1, trail: 1,
      });
    }
  }

  reset(): void {
    for (const b of this.list) b.alive = false;
    this.live = 0;
  }

  spawn(
    hostile: boolean,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    damage: number, pierce: number,
    style: ProjectileStyle, color: string, glow: string, size: number, trail: number,
    life = 2.6,
  ): Bullet | null {
    for (let i = 0; i < MAX_BULLETS; i++) {
      const b = this.list[this.head];
      this.head = (this.head + 1) % MAX_BULLETS;
      if (b.alive) continue;
      b.alive = true;
      b.hostile = hostile;
      b.x = x; b.y = y; b.z = z;
      b.vx = vx; b.vy = vy; b.vz = vz;
      b.damage = damage;
      b.pierce = pierce;
      b.hitMask = 0;
      b.life = life;
      b.style = style;
      b.color = color;
      b.glow = glow;
      b.size = size;
      b.trail = trail;
      this.live++;
      return b;
    }
    return null;
  }

  kill(b: Bullet): void {
    if (!b.alive) return;
    b.alive = false;
    this.live--;
  }

  update(dt: number, minZ: number, maxZ: number): void {
    for (const b of this.list) {
      if (!b.alive) continue;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.life <= 0 || b.z > maxZ || b.z < minZ || b.y < -1) this.kill(b);
    }
  }

  draw(p: Painter, cam: Camera, proj: Projected): void {
    p.additive(true);
    for (const b of this.list) {
      if (!b.alive) continue;
      cam.project(proj, b.x, b.y, b.z);
      if (!proj.visible) continue;
      const s = proj.s;
      const hx = proj.sx;
      const hy = proj.sy;

      const back = 0.055 * b.trail;
      cam.project(proj, b.x - b.vx * back, b.y - b.vy * back, b.z - b.vz * back);
      const tx = proj.sx;
      const ty = proj.sy;

      const w = Math.max(1, s * 0.055 * b.size);

      switch (b.style) {
        case 'laser':
          p.line(tx, ty, hx, hy, w * 1.1, b.glow, 0.55);
          p.line(tx, ty, hx, hy, Math.max(1, w * 0.5), b.color, 1);
          break;
        case 'plasma':
          p.line(tx, ty, hx, hy, w * 1.6, b.glow, 0.4);
          p.ellipse(hx, hy, w * 1.5, w * 1.5, b.glow, 0.6);
          p.ellipse(hx, hy, w * 0.85, w * 0.85, b.color, 1);
          break;
        case 'bolt':
          p.line(tx, ty, hx, hy, w * 1.25, b.glow, 0.5);
          p.line(tx, ty, hx, hy, Math.max(1, w * 0.6), b.color, 1);
          p.rect(hx - w * 0.6, hy - w * 0.6, w * 1.2, w * 1.2, b.color, 1);
          break;
        case 'pellet':
          p.rect(hx - w * 0.5, hy - w * 0.5, w, w, b.color, 1);
          p.rect(hx - w, hy - w, w * 2, w * 2, b.glow, 0.28);
          break;
        case 'ball':
          p.ellipse(hx, hy, w * 1.4, w * 1.4, b.glow, 0.4);
          p.ellipse(hx, hy, w * 0.8, w * 0.8, b.color, 1);
          break;
        case 'rocket':
          p.line(tx, ty, hx, hy, w * 2, b.glow, 0.35);
          p.rect(hx - w * 0.7, hy - w * 1.2, w * 1.4, w * 2.4, b.color, 1);
          break;
        default:
          p.line(tx, ty, hx, hy, w, b.glow, 0.42);
          p.rect(hx - w * 0.45, hy - w * 0.9, w * 0.9, w * 1.8, b.color, 1);
      }
    }
    p.additive(false);
  }
}
