/**
 * Level bosses.
 *
 * A boss holds station ahead of the squad and closes in over time, so the
 * fight has a clock: kill it before it walks into your formation. It cycles
 * stomps, charges and summons, and carries the classic wide health bar
 * floating just above its shoulders.
 */

import { clamp, damp, easeOutCubic } from '../core/math';
import { fx as rnd } from '../core/rng';
import type { Camera, Projected } from '../render/camera';
import type { Painter } from '../render/pixelbuffer';
import { drawText } from '../render/font';
import type { SpriteDef } from '../render/sprite';
import { SPR_BOSS_MECH, SPR_BOSS_OGRE } from '../render/art';
import type { EnemyKind } from './defs';

export type BossId = 'ogre' | 'mech';

export interface BossDef {
  readonly id: BossId;
  readonly name: string;
  readonly sprite: SpriteDef;
  readonly height: number;
  readonly hp: number;
  readonly closeRate: number;
  readonly adds: EnemyKind[];
  readonly accent: string;
  readonly gore: string;
  readonly ranged: boolean;
}

export const BOSSES: Record<BossId, BossDef> = {
  ogre: {
    id: 'ogre', name: 'GROTHAK THE HUNGRY', sprite: SPR_BOSS_OGRE,
    height: 7.4, hp: 2600, closeRate: 0.30, adds: ['grunt', 'runner'],
    accent: '#ff8b2b', gore: '#ff8b2b', ranged: false,
  },
  mech: {
    id: 'mech', name: 'SLAG WALKER MK-IV', sprite: SPR_BOSS_MECH,
    height: 7.8, hp: 4200, closeRate: 0.24, adds: ['shielder', 'shooter'],
    accent: '#ffd447', gore: '#6d7a91', ranged: true,
  },
};

export type BossState = 'off' | 'enter' | 'fight' | 'dying' | 'dead';

export interface BossAttackEvent {
  kind: 'stomp' | 'charge' | 'summon' | 'shoot';
  x: number;
  z: number;
}

export class Boss {
  state: BossState = 'off';
  def: BossDef = BOSSES.ogre;
  x = 0;
  y = 0;
  z = 0;
  hp = 1;
  maxHp = 1;
  /** Lags `hp` to leave the white "chip damage" tail on the health bar. */
  private hpLag = 1;
  /** Distance the boss keeps ahead of the squad. */
  standoff = 22;
  flash = 0;
  walk = 0;
  private flashCd = 0;
  private stateT = 0;
  private attackT = 2.6;
  private lunge = 0;
  private lungeVel = 0;
  private hurtShake = 0;
  private introT = 0;
  private deathT = 0;
  private summonsLeft = 0;

  get active(): boolean {
    return this.state === 'enter' || this.state === 'fight';
  }

  get healthFrac(): number {
    return clamp(this.hp / this.maxHp, 0, 1);
  }

  spawn(def: BossDef, hpScale: number, playerZ: number): void {
    this.def = def;
    this.state = 'enter';
    this.hp = this.maxHp = this.hpLag = def.hp * hpScale;
    this.standoff = 30;
    this.x = 0;
    this.y = 0;
    this.z = playerZ + this.standoff;
    this.stateT = 0;
    this.introT = 0;
    this.attackT = 3.2;
    this.lunge = 0;
    this.lungeVel = 0;
    this.flash = 0;
    this.flashCd = 0;
    this.deathT = 0;
  }

  clear(): void {
    this.state = 'off';
  }

  damage(amount: number): boolean {
    if (this.state !== 'fight' && this.state !== 'enter') return false;
    this.hp -= amount;
    if (this.flashCd <= 0) {
      this.flash = 1;
      this.flashCd = 0.2;
    }
    this.hurtShake = Math.min(0.35, this.hurtShake + 0.05);
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dying';
      this.deathT = 1.9;
      return true;
    }
    return false;
  }

  /**
   * Advances the fight. Returns an attack event on the frame an attack fires,
   * so the world can spawn shockwaves, adds or projectiles.
   */
  update(dt: number, playerX: number, playerZ: number): BossAttackEvent | null {
    if (this.state === 'off' || this.state === 'dead') return null;
    this.flash = Math.max(0, this.flash - dt * 11);
    if (this.flashCd > 0) this.flashCd -= dt;
    if (this.hpLag > this.hp) this.hpLag = Math.max(this.hp, this.hpLag - this.maxHp * 0.55 * dt);
    else this.hpLag = this.hp;
    this.hurtShake = Math.max(0, this.hurtShake - dt * 1.4);
    this.walk += dt * 3.4;
    this.stateT += dt;

    if (this.state === 'dying') {
      this.deathT -= dt;
      this.y = Math.max(-1.4, this.y - dt * 1.1);
      this.z += dt * 2.2;
      if (this.deathT <= 0) this.state = 'dead';
      return null;
    }

    if (this.state === 'enter') {
      this.introT += dt;
      this.standoff = damp(this.standoff, 15, 1.5, dt);
      this.z = playerZ + this.standoff;
      this.x = damp(this.x, playerX * 0.4, 1.2, dt);
      if (this.introT > 2.2) {
        this.state = 'fight';
        this.stateT = 0;
      }
      return null;
    }

    // Closes in relentlessly; every attack buys the player a little room back.
    this.standoff = Math.max(3.4, this.standoff - this.def.closeRate * dt);

    // Lunge spring.
    this.lungeVel += -this.lunge * 34 * dt;
    this.lungeVel *= Math.exp(-4.5 * dt);
    this.lunge += this.lungeVel * dt;

    this.z = playerZ + this.standoff + this.lunge;
    this.x = damp(this.x, playerX * 0.62, 1.6, dt);
    this.y = Math.abs(Math.sin(this.walk)) * 0.16;

    if (this.summonsLeft > 0) {
      this.summonsLeft--;
      return { kind: 'summon', x: this.x + rnd.sym(2.6), z: this.z - 1.2 };
    }

    this.attackT -= dt;
    if (this.attackT <= 0) {
      const roll = rnd.next();
      const health = this.healthFrac;
      this.attackT = 2.9 - (1 - health) * 1.2 + rnd.range(-0.3, 0.5);
      if (this.def.ranged && roll < 0.34) {
        return { kind: 'shoot', x: this.x, z: this.z };
      }
      if (roll < 0.55) {
        this.lungeVel = -13;
        return { kind: 'charge', x: this.x, z: this.z };
      }
      if (roll < 0.82) {
        this.lungeVel = -5;
        return { kind: 'stomp', x: this.x, z: this.z };
      }
      this.summonsLeft = 5 + Math.floor((1 - health) * 6);
      return { kind: 'summon', x: this.x, z: this.z - 1.2 };
    }
    return null;
  }

  draw(p: Painter, cam: Camera, proj: Projected, time: number): void {
    if (this.state === 'off' || this.state === 'dead') return;
    const shakeX = this.hurtShake > 0 ? Math.sin(time * 60) * this.hurtShake * 0.16 : 0;
    cam.project(proj, this.x + shakeX, this.y, this.z);
    if (!proj.visible) return;
    const s = proj.s;
    const h = this.def.height * s;

    const gy = cam.groundY(this.z);
    p.ellipse(proj.sx, gy, s * 1.5, s * 0.5, 'rgba(6,8,14,0.42)');

    const dying = this.state === 'dying';
    const alpha = dying ? clamp(this.deathT / 1.9, 0, 1) : 1;
    const squashX = 1 + Math.sin(this.walk * 2) * 0.02;
    p.sprite(this.def.sprite, proj.sx, proj.sy, h, { alpha, squashX });
    if (this.flash > 0.02) {
      p.additive(true);
      p.sprite(this.def.sprite, proj.sx, proj.sy, h, {
        tint: '#ffffff',
        variant: 'flash',
        alpha: Math.min(0.42, this.flash * 0.42) * alpha,
        squashX,
      });
      p.additive(false);
    }

    if (this.state === 'enter') {
      const k = clamp(this.stateT / 2.2, 0, 1);
      p.additive(true);
      p.ellipse(proj.sx, proj.sy - h * 0.5, s * 2.2 * (1 - k), s * 2.2 * (1 - k), this.def.accent, (1 - k) * 0.4);
      p.additive(false);
    }

    if (!dying) this.drawHealthBar(p, proj.sx, proj.sy - h - s * 0.55, s);
  }

  private drawHealthBar(p: Painter, cx: number, cy: number, s: number): void {
    const w = Math.max(90, s * 6.6);
    const h = Math.max(11, s * 0.52);
    const x = cx - w / 2;
    const r = Math.max(2, h * 0.22);
    // Capsule shell, like the reference clip's boss bar.
    p.rect(x - r, cy - h / 2, w + r * 2, h, '#0b0d14', 0.92);
    p.rect(x, cy - h / 2 - r * 0.6, w, h + r * 1.2, '#0b0d14', 0.92);
    const inset = Math.max(2, h * 0.2);
    const iw = w - inset * 2;
    const ih = h - inset * 2;
    p.rect(x + inset, cy - ih / 2, iw, ih, '#2a0c10', 1);
    const f = this.healthFrac;
    const lag = clamp(this.hpLag / this.maxHp, 0, 1);
    if (lag > f) {
      p.rect(x + inset + iw * f, cy - ih / 2, iw * (lag - f), ih, '#f4f0e4', 1);
    }
    if (f > 0) {
      p.rect(x + inset, cy - ih / 2, iw * f, ih, '#e0332f', 1);
      p.rect(x + inset, cy - ih / 2, iw * f, Math.max(1, ih * 0.34), '#ff6a52', 1);
    }
    if (this.state === 'enter') {
      const a = 0.5 + 0.5 * Math.sin(this.stateT * 9);
      drawText(p, this.def.name, cx, cy - h * 1.9, Math.max(1, s * 0.05), {
        color: this.def.accent,
        outline: 1,
        align: 'center',
        bold: true,
        alpha: a,
      });
    }
  }

  /** Fraction of the death animation completed, for the level-clear pacing. */
  get deathProgress(): number {
    return this.state === 'dying' ? easeOutCubic(1 - this.deathT / 1.9) : this.state === 'dead' ? 1 : 0;
  }
}
