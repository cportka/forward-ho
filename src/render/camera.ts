/**
 * Pseudo-3D chase camera.
 *
 * The world uses (x = lateral, y = up, z = forward). Everything is projected
 * with a single perspective divide, which is all a lane runner needs and keeps
 * the maths cheap enough to project thousands of horde pixels every frame.
 */

import { clamp, damp } from '../core/math';

/** Half-width of the playable lane, in world units. */
export const ROAD_HALF = 3.6;
/** How far in front of the camera the squad sits. */
export const PLAYER_DZ = 9.0;
/** Anything nearer than this is behind the near plane and must not be drawn. */
export const NEAR_Z = 0.55;

export interface Projected {
  sx: number;
  sy: number;
  /** Device pixels per world unit at this depth. */
  s: number;
  visible: boolean;
}

export class Camera {
  width = 1;
  height = 1;
  focal = 1;
  horizonY = 0;

  x = 0;
  y = 6;
  z = -PLAYER_DZ;

  /** Where the camera would like to be laterally (follows the squad). */
  targetX = 0;
  /** Extra depth offset used for boss pull-backs and intro sweeps. */
  dolly = 0;
  dollyTarget = 0;
  /** Extra height used for boss pull-backs. */
  lift = 0;
  liftTarget = 0;

  shakeX = 0;
  shakeY = 0;
  private shakeMag = 0;
  private shakeTime = 0;
  private shakePhase = 0;

  /** Fraction of screen height where the squad sits. */
  private anchorY = 0.755;

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.focal = width * 1.02;
    this.horizonY = height * 0.285;
    const scale0 = this.focal / PLAYER_DZ;
    this.y = (height * this.anchorY - this.horizonY) / scale0;
  }

  /** Device pixels per world unit at world depth `z`. */
  scaleAt(z: number): number {
    const dz = z - this.z;
    if (dz < NEAR_Z) return this.focal / NEAR_Z;
    return this.focal / dz;
  }

  project(out: Projected, x: number, y: number, z: number): Projected {
    const dz = z - this.z;
    if (dz < NEAR_Z) {
      out.visible = false;
      out.s = this.focal / NEAR_Z;
      out.sx = this.width * 0.5 + (x - this.x) * out.s + this.shakeX;
      out.sy = this.horizonY + (this.y + this.lift - y) * out.s + this.shakeY;
      return out;
    }
    const s = this.focal / dz;
    out.s = s;
    out.sx = this.width * 0.5 + (x - this.x) * s + this.shakeX;
    out.sy = this.horizonY + (this.y + this.lift - y) * s + this.shakeY;
    out.visible = out.sy > -this.height && out.sy < this.height * 2;
    return out;
  }

  screenX(x: number, z: number): number {
    return this.width * 0.5 + (x - this.x) * this.scaleAt(z) + this.shakeX;
  }

  groundY(z: number): number {
    return this.horizonY + (this.y + this.lift) * this.scaleAt(z) + this.shakeY;
  }

  /** Inverse projection at a known depth — used to turn drags into lane positions. */
  worldXAt(screenX: number, z: number): number {
    return this.x + (screenX - this.width * 0.5 - this.shakeX) / this.scaleAt(z);
  }

  /** Depth of the horizon-adjacent draw limit; nothing beyond needs drawing. */
  get farZ(): number {
    return this.z + this.focal / 1.4;
  }

  addShake(mag: number): void {
    this.shakeMag = Math.min(46, Math.max(this.shakeMag, mag));
    this.shakeTime = Math.max(this.shakeTime, 0.16 + mag * 0.006);
  }

  /**
   * `railZ` is the auto-advancing rail; `pushOffset` is how far the player has
   * driven the column ahead of (or behind) it. The camera only takes part of
   * the push, so marching forward visibly walks the squad up the screen and
   * hanging back brings it toward the viewer.
   */
  follow(x: number, railZ: number, dt: number, pushOffset = 0, lateralRate = 7): void {
    this.targetX = x * 0.62;
    this.x = damp(this.x, this.targetX, lateralRate, dt);
    this.dolly = damp(this.dolly, this.dollyTarget, 2.4, dt);
    this.lift = damp(this.lift, this.liftTarget, 2.4, dt);
    // Asymmetric on purpose: charging forward walks the column up the screen
    // (the camera keeps less of the push), while holding back barely enlarges
    // it, so the crowd never crawls off the bottom edge.
    const share = pushOffset > 0 ? 0.45 : 0.78;
    this.z = railZ + pushOffset * share - PLAYER_DZ - this.dolly;
  }

  update(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      this.shakePhase += dt * 47;
      const k = clamp(this.shakeTime * 4.5, 0, 1);
      const m = this.shakeMag * k * k;
      this.shakeX = Math.sin(this.shakePhase * 1.7) * m;
      this.shakeY = Math.cos(this.shakePhase * 2.3) * m * 0.7;
      if (this.shakeTime <= 0) {
        this.shakeMag = 0;
        this.shakeX = 0;
        this.shakeY = 0;
      }
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** 0 near the camera, 1 at the far draw distance — drives atmospheric fade. */
  fogAt(z: number): number {
    const dz = z - this.z;
    return clamp((dz - 14) / 90, 0, 1);
  }
}

export const scratchProjection: Projected = { sx: 0, sy: 0, s: 1, visible: true };
