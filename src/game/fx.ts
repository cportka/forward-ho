/**
 * Particles, floating text and ground shockwaves.
 *
 * Everything is pooled and drawn on the `fx` plane, which has a coarser pixel
 * size than the world plane — sparks and smoke read as chunky pixel clusters
 * rather than fine dust, which is the look we want.
 */

import { clamp, easeOutCubic, TAU } from '../core/math';
import { fx as rnd } from '../core/rng';
import type { Camera, Projected } from '../render/camera';
import type { Painter } from '../render/pixelbuffer';
import { drawText } from '../render/font';
import { withAlpha } from '../render/palette';

export type ParticleKind = 'spark' | 'chunk' | 'smoke' | 'ember' | 'shard' | 'mote' | 'flash';

interface Particle {
  alive: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  grav: number;
  drag: number;
  color: string;
  fade: number;
  additive: boolean;
}

interface FloatText {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  outline: string;
  size: number;
  bold: boolean;
}

interface Shockwave {
  alive: boolean;
  x: number;
  z: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: string;
  thickness: number;
}

const MAX_PARTICLES = 1400;
const MAX_TEXTS = 64;
const MAX_WAVES = 24;

export class FxSystem {
  private parts: Particle[] = [];
  private texts: FloatText[] = [];
  private waves: Shockwave[] = [];
  private partHead = 0;
  private textHead = 0;
  private waveHead = 0;

  /** Full-screen colour flash, drained each frame. */
  flashColor = '#ffffff';
  flashAmount = 0;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.parts.push({
        alive: false, kind: 'spark', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0.1, grav: 0, drag: 0, color: '#fff', fade: 1, additive: false,
      });
    }
    for (let i = 0; i < MAX_TEXTS; i++) {
      this.texts.push({
        alive: false, x: 0, y: 0, z: 0, vy: 0, life: 0, maxLife: 1,
        text: '', color: '#fff', outline: '#000', size: 1, bold: true,
      });
    }
    for (let i = 0; i < MAX_WAVES; i++) {
      this.waves.push({ alive: false, x: 0, z: 0, r: 0, maxR: 1, life: 0, maxLife: 1, color: '#fff', thickness: 0.2 });
    }
  }

  reset(): void {
    for (const p of this.parts) p.alive = false;
    for (const t of this.texts) t.alive = false;
    for (const w of this.waves) w.alive = false;
    this.flashAmount = 0;
  }

  private nextParticle(): Particle {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.parts[this.partHead];
      this.partHead = (this.partHead + 1) % MAX_PARTICLES;
      if (!p.alive) return p;
    }
    const p = this.parts[this.partHead];
    this.partHead = (this.partHead + 1) % MAX_PARTICLES;
    return p;
  }

  particle(
    kind: ParticleKind,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number, color: string,
    grav = 0, drag = 0, additive = false,
  ): void {
    const p = this.nextParticle();
    p.alive = true;
    p.kind = kind;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = p.maxLife = life;
    p.size = size;
    p.color = color;
    p.grav = grav;
    p.drag = drag;
    p.fade = 1;
    p.additive = additive;
  }

  /** Muzzle flash at a unit's rifle. */
  muzzle(x: number, y: number, z: number, color: string, scale = 1): void {
    this.particle('flash', x, y, z, 0, 0, 6 * scale, 0.075, 0.34 * scale, color, 0, 0, true);
    for (let i = 0; i < 2; i++) {
      this.particle(
        'spark',
        x, y, z,
        rnd.sym(2.2), rnd.sym(1.4) + 0.6, 9 + rnd.next() * 8,
        0.1 + rnd.next() * 0.08, 0.07 * scale, color, -3, 3, true,
      );
    }
  }

  /** Bullet hitting something solid. */
  impact(x: number, y: number, z: number, color: string, power = 1): void {
    const n = 3 + Math.floor(power * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd.next() * TAU;
      const sp = (2 + rnd.next() * 5) * power;
      this.particle(
        'spark', x, y, z,
        Math.cos(a) * sp, Math.abs(Math.sin(a)) * sp * 0.8 + 1.5, -rnd.next() * 3 - 0.6,
        0.16 + rnd.next() * 0.16, 0.06 + rnd.next() * 0.05 * power, color, -12, 1.6, true,
      );
    }
    this.particle('flash', x, y, z, 0, 0, 0, 0.07, 0.22 * power, color, 0, 0, true);
  }

  /** Enemy death: a puff of pale smoke plus body chunks, like the reference clips. */
  death(x: number, y: number, z: number, tint: string, scale = 1): void {
    for (let i = 0; i < 4; i++) {
      const a = rnd.next() * TAU;
      const sp = (0.8 + rnd.next() * 2.4) * scale;
      this.particle(
        'smoke', x, y + rnd.next() * 0.6 * scale, z,
        Math.cos(a) * sp, 1.4 + rnd.next() * 2.4, Math.sin(a) * sp * 0.5,
        0.34 + rnd.next() * 0.26, (0.11 + rnd.next() * 0.13) * scale, '#e9eef5', -1.4, 2.4,
      );
    }
    for (let i = 0; i < 4; i++) {
      const a = rnd.next() * TAU;
      const sp = (2.4 + rnd.next() * 4.5) * scale;
      this.particle(
        'chunk', x, y + 0.4 * scale, z,
        Math.cos(a) * sp, 3 + rnd.next() * 4.5, Math.sin(a) * sp * 0.6,
        0.5 + rnd.next() * 0.4, (0.09 + rnd.next() * 0.1) * scale, tint, -16, 0.6,
      );
    }
  }

  /** Big boom: fireball core, ring, debris. */
  explosion(x: number, y: number, z: number, scale = 1, hot = '#ffd447', cool = '#ff5a1f'): void {
    this.particle('flash', x, y, z, 0, 0, 0, 0.15, Math.min(2.2, 0.7 * scale), '#fffbe0', 0, 0, true);
    for (let i = 0; i < 16; i++) {
      const a = rnd.next() * TAU;
      const sp = (3 + rnd.next() * 9) * scale;
      this.particle(
        'ember', x, y + rnd.next() * 0.6, z,
        Math.cos(a) * sp, 2 + rnd.next() * 9, Math.sin(a) * sp * 0.6,
        0.4 + rnd.next() * 0.5, (0.16 + rnd.next() * 0.2) * scale,
        rnd.bool(0.5) ? hot : cool, -14, 1.1, true,
      );
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd.next() * TAU;
      const sp = (1.5 + rnd.next() * 4) * scale;
      this.particle(
        'smoke', x, y + rnd.next() * 1.2 * scale, z,
        Math.cos(a) * sp, 1.5 + rnd.next() * 3, Math.sin(a) * sp * 0.5,
        0.7 + rnd.next() * 0.7, (0.3 + rnd.next() * 0.4) * scale, '#6a6a72', -1, 2.2,
      );
    }
    this.shockwave(x, z, 5.5 * scale, 0.45, hot, 0.22 * scale);
  }

  /** Splintering wood / shattering panel. */
  shatter(x: number, y: number, z: number, color: string, count = 10, scale = 1): void {
    for (let i = 0; i < count; i++) {
      const a = rnd.next() * TAU;
      const sp = (2 + rnd.next() * 6) * scale;
      this.particle(
        'shard', x + rnd.sym(0.3 * scale), y + rnd.next() * 1.2 * scale, z,
        Math.cos(a) * sp, 2.5 + rnd.next() * 6, Math.sin(a) * sp * 0.5 - 1.5,
        0.45 + rnd.next() * 0.45, (0.1 + rnd.next() * 0.16) * scale, color, -18, 0.5,
      );
    }
  }

  /** Ambient drifting motes — snow, embers, sea spray. */
  mote(x: number, y: number, z: number, color: string, size: number, life: number, vy: number, vx = 0): void {
    this.particle('mote', x, y, z, vx, vy, 0, life, size, color, 0, 0.15);
  }

  shockwave(x: number, z: number, maxR: number, life: number, color: string, thickness = 0.2): void {
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waves[this.waveHead];
      this.waveHead = (this.waveHead + 1) % MAX_WAVES;
      if (!w.alive) {
        w.alive = true;
        w.x = x; w.z = z; w.r = 0.2; w.maxR = maxR;
        w.life = w.maxLife = life; w.color = color; w.thickness = thickness;
        return;
      }
    }
  }

  text(
    x: number, y: number, z: number, text: string,
    color = '#ffffff', size = 1, life = 0.95, outline = '#0b0d14', bold = true,
  ): void {
    for (let i = 0; i < MAX_TEXTS; i++) {
      const t = this.texts[this.textHead];
      this.textHead = (this.textHead + 1) % MAX_TEXTS;
      if (!t.alive) {
        t.alive = true;
        t.x = x; t.y = y; t.z = z;
        t.vy = 2.6;
        t.life = t.maxLife = life;
        t.text = text; t.color = color; t.outline = outline; t.size = size; t.bold = bold;
        return;
      }
    }
  }

  flash(color: string, amount: number): void {
    if (amount > this.flashAmount) {
      this.flashAmount = amount;
      this.flashColor = color;
    }
  }

  update(dt: number, minZ: number): void {
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0 || p.z < minZ - 6) {
        p.alive = false;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = (p.vy + p.grav * dt) * d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0 && p.kind !== 'smoke' && p.kind !== 'mote' && p.kind !== 'flash') {
        p.y = 0;
        p.vy *= -0.32;
        p.vx *= 0.6;
        p.vz *= 0.6;
        if (Math.abs(p.vy) < 0.6) p.vy = 0;
      }
    }
    for (const t of this.texts) {
      if (!t.alive) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.alive = false;
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.2 * dt);
    }
    for (const w of this.waves) {
      if (!w.alive) continue;
      w.life -= dt;
      if (w.life <= 0) {
        w.alive = false;
        continue;
      }
      w.r = w.maxR * easeOutCubic(1 - w.life / w.maxLife);
    }
    this.flashAmount = Math.max(0, this.flashAmount - dt * 3.4);
  }

  draw(p: Painter, cam: Camera, proj: Projected): void {
    // Ground shockwaves first so particles sit on top.
    for (const w of this.waves) {
      if (!w.alive) continue;
      cam.project(proj, w.x, 0, w.z);
      if (!proj.visible) continue;
      const a = clamp(w.life / w.maxLife, 0, 1);
      p.ring(
        proj.sx, proj.sy,
        w.r * proj.s, w.r * proj.s * 0.36,
        Math.max(1, w.thickness * proj.s),
        w.color, a * 0.85,
      );
    }

    let additive = false;
    for (const q of this.parts) {
      if (!q.alive) continue;
      cam.project(proj, q.x, q.y, q.z);
      if (!proj.visible) continue;
      const t = q.life / q.maxLife;
      let alpha = 1;
      let size = q.size;
      switch (q.kind) {
        case 'smoke':
          alpha = clamp(t * 0.6, 0, 0.42);
          size = q.size * (1.8 - t * 0.8);
          break;
        case 'flash':
          alpha = clamp(t * 1.1, 0, 0.78);
          size = q.size * (0.5 + (1 - t) * 0.9);
          break;
        case 'mote':
          alpha = clamp(t * 1.6, 0, 0.75);
          break;
        default:
          alpha = clamp(t * 1.5, 0, 1);
      }
      if (alpha <= 0.02) continue;

      if (q.additive !== additive) {
        p.additive(q.additive);
        additive = q.additive;
      }

      const px = size * proj.s;
      if (px < 0.4) continue;
      if (q.kind === 'flash') {
        p.ellipse(proj.sx, proj.sy, px, px * 0.85, q.color, alpha);
      } else if (q.kind === 'smoke') {
        p.ellipse(proj.sx, proj.sy, px, px * 0.9, withAlpha(q.color, 1), alpha);
      } else {
        p.rect(proj.sx - px * 0.5, proj.sy - px * 0.5, px, px, q.color, alpha);
      }
    }
    if (additive) p.additive(false);

    for (const t of this.texts) {
      if (!t.alive) continue;
      cam.project(proj, t.x, t.y, t.z);
      if (!proj.visible) continue;
      const k = t.life / t.maxLife;
      const alpha = clamp(k * 2.2, 0, 1);
      const px = Math.max(1, (proj.s * 0.036 * t.size) | 0);
      drawText(p, t.text, proj.sx, proj.sy, px, {
        color: t.color,
        outline: 1,
        outlineColor: t.outline,
        align: 'center',
        bold: t.bold,
        alpha,
      });
    }
  }

  /** Count of live particles — surfaced in the debug readout. */
  get liveParticles(): number {
    let n = 0;
    for (const p of this.parts) if (p.alive) n++;
    return n;
  }
}
