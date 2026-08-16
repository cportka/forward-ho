/**
 * A single run down the road: streaming the level, firing, collisions,
 * scoring and the draw order for every plane.
 */

import { clamp, formatCount, TAU } from '../core/math';
import { fx as rnd } from '../core/rng';
import { Camera, NEAR_Z, ROAD_HALF, scratchProjection } from '../render/camera';
import type { PixelStage } from '../render/pixelbuffer';
import { drawSky, drawFar, drawGround, drawRoad, drawTrackside } from '../render/backdrop';
import { BIOMES, GATE_STYLES, MAX_WEAPON_TIER, WEAPONS, type BiomeDef, type WeaponDef } from './defs';
import { Boss, BOSSES } from './boss';
import { Bullets } from './bullets';
import { EnemyManager, type Enemy } from './enemies';
import { FxSystem } from './fx';
import { buildLevel, type LevelPlan } from './levels';
import type { Meta } from './progression';
import { Barricades, Boards, Coins, Gates, rewardLabel, type Reward } from './props';
import { Squad, type MuzzlePoint } from './squad';
import { audio } from './audio';

export type RunPhase = 'running' | 'clear' | 'failed';

export interface RunStats {
  troops: number;
  peakTroops: number;
  kills: number;
  gold: number;
  score: number;
  combo: number;
  bestCombo: number;
  distance: number;
  time: number;
  weaponTier: number;
  boardsBroken: number;
  gatesTaken: number;
}

interface PendingHazard {
  t: number;
  x: number;
  z: number;
  radius: number;
  loss: number;
}

const BUCKET = 2.4;
const SPAWN_AHEAD = 150;

export class World {
  readonly cam = new Camera();
  readonly squad = new Squad();
  readonly bullets = new Bullets();
  readonly enemies = new EnemyManager();
  readonly boss = new Boss();
  readonly gates = new Gates();
  readonly boards = new Boards();
  readonly barricades = new Barricades();
  readonly coins = new Coins();
  readonly fx = new FxSystem();

  plan!: LevelPlan;
  biome: BiomeDef = BIOMES.bridge;
  phase: RunPhase = 'running';
  time = 0;
  weaponTier = 0;
  revivesLeft = 0;

  stats: RunStats = {
    troops: 0, peakTroops: 0, kills: 0, gold: 0, score: 0,
    combo: 0, bestCombo: 0, distance: 0, time: 0, weaponTier: 0,
    boardsBroken: 0, gatesTaken: 0,
  };

  bannerText = '';
  bannerSub = '';
  bannerT = 0;
  toastText = '';
  toastT = 0;
  /** Fires once when the run ends, for the shell to react to. */
  endReason: 'boss' | 'wiped' | 'finished' | null = null;

  private planIdx = 0;
  private prevZ = 0;
  private fireTimer = 0;
  private comboTimer = 0;
  private muzzleBuf: MuzzlePoint[] = [];
  private tailBuf: { x: number; y: number; z: number }[] = [];
  private buckets = new Map<number, number[]>();
  private hazards: PendingHazard[] = [];
  private meta!: Meta;
  private endDelay = 0;
  private sampleBuf = { x: 0, y: 0, z: 0 };

  constructor() {
    for (let i = 0; i < 32; i++) this.muzzleBuf.push({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < 64; i++) this.tailBuf.push({ x: 0, y: 0, z: 0 });
  }

  get weapon(): WeaponDef {
    return WEAPONS[clamp(this.weaponTier, 0, MAX_WEAPON_TIER)];
  }

  start(levelIndex: number, seed: number, meta: Meta): void {
    this.meta = meta;
    this.plan = buildLevel(levelIndex, seed, meta.startTroops);
    this.biome = BIOMES[this.plan.biome];
    this.phase = 'running';
    this.time = 0;
    this.planIdx = 0;
    this.fireTimer = 0;
    this.comboTimer = 0;
    this.endDelay = 0;
    this.endReason = null;
    this.hazards.length = 0;
    this.weaponTier = this.plan.startWeapon;
    this.revivesLeft = meta.revives;

    this.squad.reset(meta.startTroops, this.plan.skin, 0);
    this.squad.baseSpeed = 12 * meta.speedMul;
    this.squad.speed = this.squad.baseSpeed;
    this.bullets.reset();
    this.enemies.reset();
    this.boss.clear();
    this.gates.reset();
    this.boards.reset();
    this.barricades.reset();
    this.coins.reset();
    this.fx.reset();
    this.prevZ = this.squad.z;

    this.stats = {
      troops: this.squad.count, peakTroops: this.squad.count, kills: 0, gold: 0, score: 0,
      combo: 0, bestCombo: 0, distance: 0, time: 0, weaponTier: this.weaponTier,
      boardsBroken: 0, gatesTaken: 0,
    };

    this.bannerText = '';
    this.bannerT = 0;
    this.toastT = 0;
    this.cam.dollyTarget = 0;
    this.cam.liftTarget = 0;
    this.cam.x = 0;
    this.cam.z = -12;
  }

  resize(w: number, h: number): void {
    this.cam.resize(w, h);
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  update(dt: number, steer: number, push = 0): void {
    this.time += dt;
    if (this.phase === 'running') {
      this.stats.time = this.time;
      this.stream();
      this.squad.update(dt, steer, push);
      this.updateFiring(dt);
    } else {
      // Let the world settle for a beat before the results screen.
      this.squad.update(dt, steer * 0.2, 0);
      this.endDelay -= dt;
    }

    const pz = this.squad.z;
    this.enemies.update(dt, this.squad.x, pz, this.cam.z - 6);
    this.bullets.update(dt, this.cam.z - 4, pz + 190);
    this.gates.update(dt);
    this.boards.update(dt);
    this.barricades.update(dt);
    this.updateBoss(dt);
    this.updateHazards(dt);

    this.rebuildBuckets();
    this.collideBullets(dt);
    if (this.phase === 'running') {
      this.collideGates();
      this.collideBarricades();
      this.collideBoards();
      this.collideEnemies();
    }

    const picked = this.coins.update(dt, this.squad.x, pz, this.squad.radius, this.meta.magnetRange);
    if (picked > 0) {
      this.stats.gold += picked;
      audio.sfx('coin', { vol: 0.5, rate: 1 + Math.min(0.5, picked * 0.02) });
      for (let i = 0; i < 4; i++) {
        this.fx.particle(
          'spark', this.squad.x + rnd.sym(this.squad.radius), 0.7 + rnd.next() * 0.6, pz,
          rnd.sym(1.6), 2.4 + rnd.next() * 2, rnd.sym(1.2),
          0.28, 0.05, '#ffe27a', -9, 1.6, true,
        );
      }
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.stats.combo = 0;
    }

    this.emitMarchDust();
    this.fx.update(dt, this.cam.z - 8);
    this.cam.follow(this.squad.x, this.squad.railZ, dt, this.squad.pushOffset);
    this.cam.update(dt);

    this.gates.cull(this.cam.z - 8);
    this.boards.cull(this.cam.z - 8);
    this.barricades.cull(this.cam.z - 8);

    this.stats.troops = this.squad.count;
    this.stats.peakTroops = Math.max(this.stats.peakTroops, this.squad.count);
    this.stats.distance = Math.max(0, pz);
    this.stats.weaponTier = this.weaponTier;
    this.stats.score =
      this.stats.kills * 10 + this.stats.peakTroops * 6 + this.stats.gold * 2 + this.stats.bestCombo * 15;

    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.toastT > 0) this.toastT -= dt;

    if (this.phase === 'running') {
      if (this.squad.count <= 0) this.onWipe();
      else if (this.boss.state === 'dead') this.finish('boss');
      else if (pz >= this.plan.length) this.finish('finished');
    }

    this.prevZ = pz;
  }

  private stream(): void {
    const limit = this.squad.z + SPAWN_AHEAD;
    while (this.planIdx < this.plan.items.length && this.plan.items[this.planIdx].z <= limit) {
      const it = this.plan.items[this.planIdx++];
      switch (it.t) {
        case 'gate':
          this.gates.add(it.z, it.x, it.halfW, it.op, it.value);
          break;
        case 'ladder':
          this.gates.addLadder(it.z, it.x, it.halfW, it.op, it.value, it.count, it.spacing);
          break;
        case 'board': {
          const hp = this.scaleForPower(it.hp, 8.5);
          this.boards.add(it.z, it.x, hp, it.reward, it.w, it.h);
          break;
        }
        case 'barricade': {
          // Size the wall so it takes roughly a second and a half to chew through.
          const cells = Math.max(1, it.cols * it.rows);
          const cellHp = clamp((this.currentDps() * 1.6) / cells, it.cellHp * 0.5, it.cellHp * 40);
          this.barricades.add(it.z, it.x, it.cols, it.rows, it.kind, cellHp);
          break;
        }
        case 'horde':
          this.enemies.addField(
            it.z, it.length, it.x, it.halfW, it.count, it.kinds, it.hpScale,
            this.biome.id === 'tundra' ? '#c23a5c' : '#e0332f',
            this.biome.id === 'tundra' ? '#6a0f26' : '#8a1418',
          );
          break;
        case 'squad':
          for (let i = 0; i < it.count; i++) {
            this.enemies.spawn(it.kind, it.x + rnd.sym(it.spread), it.z + rnd.sym(1.6), it.hpScale);
          }
          break;
        case 'coins':
          for (let i = 0; i < it.count; i++) {
            this.coins.spawn(it.x + rnd.sym(1.4), 0.6, it.z + rnd.sym(2.4), 1, 0.6);
          }
          break;
        case 'boss': {
          const def = BOSSES[it.boss];
          this.boss.spawn(def, 1, this.squad.z);
          this.boss.hp = this.boss.maxHp = Math.max(
            def.hp * it.hpScale,
            this.currentDps() * (9 + this.plan.index * 1.5),
          );
          this.cam.dollyTarget = 3.4;
          this.cam.liftTarget = 1.2;
          audio.sfx('bossRoar');
          audio.setMusic('boss');
          this.showBanner(def.name, 'BOSS');
          break;
        }
        case 'banner':
          this.showBanner(it.text, it.sub);
          break;
      }
    }
  }

  /**
   * Boots on the road. The column steps in unison, so each footfall gets a
   * short puff of dust under a handful of units and one soft footstep cue.
   */
  private emitMarchDust(): void {
    if (this.phase !== 'running' || !this.squad.takeFootfall() || this.squad.count <= 0) return;
    const puffs = Math.min(5, 1 + Math.floor(this.squad.count / 12));
    const dust = this.squad.dustColor;
    for (let i = 0; i < puffs; i++) {
      if (!this.squad.sampleUnit(this.sampleBuf)) break;
      const b = this.sampleBuf;
      this.fx.particle(
        'smoke', b.x + rnd.sym(0.16), 0.06, b.z - 0.1,
        rnd.sym(0.5), 0.5 + rnd.next() * 0.5, -1.2 - rnd.next(),
        0.3 + rnd.next() * 0.2, 0.07 + rnd.next() * 0.06, dust, 0.4, 3.2,
      );
    }
    audio.sfx('march', { vol: clamp(0.1 + this.squad.count * 0.002, 0.1, 0.3), rate: 0.9 + rnd.next() * 0.25 });
  }

  /** Current theoretical damage per second, used to size destructible HP. */
  currentDps(): number {
    const w = this.weapon;
    const power = Math.pow(Math.max(1, this.squad.count), 0.9);
    return (w.damage * power * this.meta.damageMul) / (w.interval * this.meta.fireRateMul);
  }

  private scaleForPower(base: number, seconds: number): number {
    return Math.max(base * 0.45, Math.min(base * 60, this.currentDps() * seconds));
  }

  private updateFiring(dt: number): void {
    if (this.squad.count <= 0) return;
    const w = this.weapon;
    const interval = (w.interval * this.meta.fireRateMul) / this.squad.fireRateMul;
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    this.fireTimer += Math.max(0.016, interval);

    const n = this.squad.muzzles(this.muzzleBuf);
    const perBullet = (w.damage * Math.pow(Math.max(1, this.squad.count), 0.9) * this.meta.damageMul) / (n * w.pellets);

    for (let i = 0; i < n; i++) {
      const m = this.muzzleBuf[i];
      for (let k = 0; k < w.pellets; k++) {
        const a = rnd.sym(w.spread) + (w.pellets > 1 ? (k / (w.pellets - 1) - 0.5) * w.spread * 1.6 : 0);
        const vx = Math.sin(a) * w.speed;
        const vz = Math.cos(a) * w.speed;
        this.bullets.spawn(
          false, m.x, m.y, m.z, vx, rnd.sym(0.6), vz,
          perBullet, w.pierce, w.style, w.color, w.glow, w.size, w.trail,
        );
      }
      if (i < 8) this.fx.muzzle(m.x, m.y, m.z, w.glow, 0.8 + w.size * 0.3);
      // Spent brass arcs out to the right and tinks off the road.
      if (i < 4) {
        this.fx.particle(
          'shard', m.x + 0.2, m.y - 0.05, m.z,
          2.6 + rnd.next() * 1.8, 1.6 + rnd.next() * 1.4, -1.4 - rnd.next(),
          0.55 + rnd.next() * 0.3, 0.045, '#ffd447', -14, 0.4,
        );
      }
    }
    audio.sfx(w.sfx, { vol: clamp(0.16 + n * 0.012, 0.16, 0.4), rate: 0.94 + rnd.next() * 0.12 });
    audio.sfx('shell', { vol: 0.1, rate: 1.1 + rnd.next() * 0.3 });
  }

  private updateBoss(dt: number): void {
    if (this.boss.state === 'off') return;
    const ev = this.boss.update(dt, this.squad.x, this.squad.z);
    if (this.boss.state === 'dead' && this.cam.dollyTarget !== 0) {
      this.cam.dollyTarget = 0;
      this.cam.liftTarget = 0;
    }
    if (!ev) return;
    switch (ev.kind) {
      case 'stomp':
        this.fx.shockwave(ev.x, ev.z, 7, 0.55, this.boss.def.accent, 0.3);
        this.cam.addShake(9);
        audio.sfx('stomp');
        this.hazards.push({ t: 0.5, x: ev.x, z: ev.z, radius: 3.6, loss: 0.14 });
        break;
      case 'charge':
        this.cam.addShake(6);
        audio.sfx('warning', { vol: 0.5 });
        this.fx.text(ev.x, 3.4, ev.z, 'CHARGE!', '#ff6a52', 1.2, 0.8);
        break;
      case 'summon': {
        const kind = this.boss.def.adds[(rnd.next() * this.boss.def.adds.length) | 0];
        this.enemies.spawn(kind, ev.x, ev.z, this.plan.hpScale * 0.8);
        this.fx.impact(ev.x, 0.3, ev.z, this.boss.def.accent, 1.2);
        break;
      }
      case 'shoot': {
        for (let i = -1; i <= 1; i++) {
          const a = i * 0.09;
          this.bullets.spawn(
            true, ev.x, 2.4, ev.z - 1.2,
            Math.sin(a) * -22 + (this.squad.x - ev.x) * 1.4, -0.4, -22,
            0, 0, 'plasma', '#ff6a52', '#ffd447', 2.2, 1.6, 3.4,
          );
        }
        audio.sfx('rocket', { vol: 0.4 });
        break;
      }
    }
  }

  private updateHazards(dt: number): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t -= dt;
      if (h.t > 0) continue;
      this.hazards.splice(i, 1);
      const dx = this.squad.x - h.x;
      const dz = this.squad.z - h.z;
      if (dx * dx + dz * dz < (h.radius + this.squad.radius) * (h.radius + this.squad.radius)) {
        this.hurtSquad(Math.ceil(this.squad.count * h.loss) + 1, 'stomp');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Collision
  // -------------------------------------------------------------------------

  private rebuildBuckets(): void {
    this.buckets.clear();
    const list = this.enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.dying > 0) continue;
      const key = Math.floor(e.z / BUCKET);
      let arr = this.buckets.get(key);
      if (!arr) {
        arr = [];
        this.buckets.set(key, arr);
      }
      arr.push(i);
    }
  }

  private collideBullets(dt: number): void {
    const list = this.enemies.list;
    const boss = this.boss;

    for (const b of this.bullets.list) {
      if (!b.alive) continue;

      if (b.hostile) {
        // Enemy fire only threatens the squad.
        const dx = b.x - this.squad.x;
        const dz = b.z - this.squad.z;
        const r = this.squad.radius + 0.4;
        if (dx * dx + dz * dz < r * r) {
          this.bullets.kill(b);
          this.fx.impact(b.x, b.y, b.z, '#ff6a52', 1.2);
          this.hurtSquad(2, 'shot');
        }
        continue;
      }

      const z0 = b.z - b.vz * dt;
      const z1 = b.z;

      // Boss.
      if (boss.active) {
        const bw = boss.def.height * 0.42;
        if (z1 > boss.z - bw && z0 < boss.z + bw && Math.abs(b.x - boss.x) < bw * 1.05) {
          const killed = boss.damage(b.damage);
          this.fx.impact(b.x, b.y, boss.z - bw, boss.def.accent, 1);
          audio.sfx('bossHit', { vol: 0.2 });
          this.bullets.kill(b);
          if (killed) this.onBossKilled();
          continue;
        }
      }

      // Boards.
      let consumed = false;
      for (const bd of this.boards.list) {
        if (!bd.alive) continue;
        if (z1 > bd.z - 0.35 && z0 <= bd.z + 0.35 && Math.abs(b.x - bd.x) < bd.w * 0.5) {
          bd.hp -= b.damage;
          bd.flash = 1;
          bd.shake = 0.25;
          this.fx.impact(b.x, b.y, bd.z - 0.2, '#ffd447', 0.8);
          audio.sfx('boardHit', { vol: 0.12, rate: 0.9 + rnd.next() * 0.3 });
          this.bullets.kill(b);
          if (bd.hp <= 0) this.breakBoard(bd.x, bd.z, bd.reward, bd);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;

      // Barricades.
      for (const ba of this.barricades.list) {
        if (ba.remaining <= 0) continue;
        if (!(z1 > ba.z - 0.4 && z0 <= ba.z + 0.4)) continue;
        const col = Math.round((b.x - ba.x) / ba.cell + (ba.cols - 1) / 2);
        if (col < 0 || col >= ba.cols) continue;
        const row = clamp(Math.floor(b.y / ba.cell), 0, ba.rows - 1);
        let hit = -1;
        for (let r = row; r >= 0; r--) {
          if (ba.hp[r * ba.cols + col] > 0) {
            hit = r;
            break;
          }
        }
        if (hit < 0) {
          for (let r = row + 1; r < ba.rows; r++) {
            if (ba.hp[r * ba.cols + col] > 0) {
              hit = r;
              break;
            }
          }
        }
        if (hit < 0) continue;
        const idx = hit * ba.cols + col;
        ba.hp[idx] -= b.damage;
        ba.flash[idx] = 1;
        this.fx.impact(b.x, (hit + 0.5) * ba.cell, ba.z - 0.2, '#d09a4e', 0.8);
        audio.sfx('crateHit', { vol: 0.12, rate: 0.85 + rnd.next() * 0.4 });
        if (ba.hp[idx] <= 0) {
          ba.remaining--;
          this.fx.shatter(b.x, (hit + 0.5) * ba.cell, ba.z, '#a9702f', 9, 0.9);
          audio.sfx('crateBreak', { vol: 0.3 });
        }
        this.bullets.kill(b);
        consumed = true;
        break;
      }
      if (consumed) continue;

      // Enemies, through a coarse depth bucket grid.
      const kMin = Math.floor(Math.min(z0, z1) / BUCKET) - 1;
      const kMax = Math.floor(Math.max(z0, z1) / BUCKET) + 1;
      for (let k = kMin; k <= kMax && b.alive; k++) {
        const arr = this.buckets.get(k);
        if (!arr) continue;
        for (let ii = 0; ii < arr.length; ii++) {
          const e = list[arr[ii]];
          if (!e.alive || e.dying > 0) continue;
          if (b.hitMask === e.id) continue;
          const half = e.def.height * 0.28;
          if (e.z < Math.min(z0, z1) - half || e.z > Math.max(z0, z1) + half) continue;
          if (Math.abs(e.x - b.x) > half * 1.25) continue;
          if (b.y > e.def.height * 1.15) continue;

          const died = this.enemies.damage(e, b.damage);
          this.fx.impact(b.x, e.def.height * 0.55, e.z, b.glow, 0.9);
          if (died) this.onEnemyKilled(e);
          b.hitMask = e.id;
          if (b.pierce > 0) {
            b.pierce--;
            b.damage *= 0.82;
          } else {
            this.bullets.kill(b);
          }
          break;
        }
      }
    }
  }

  private collideGates(): void {
    const z0 = this.prevZ;
    const z1 = this.squad.z;
    if (z1 <= z0) return;
    const reach = this.squad.radius * 0.42;
    for (const g of this.gates.list) {
      if (g.taken || g.z < z0 || g.z > z1) continue;
      if (Math.abs(g.x - this.squad.x) > g.halfW + reach) continue;
      g.taken = true;
      g.flash = 1;
      // A little burst right where the rank touched the plate.
      const cx = clamp(this.squad.x, g.x - g.halfW, g.x + g.halfW);
      for (let i = 0; i < 7; i++) {
        this.fx.particle(
          'spark', cx + rnd.sym(g.halfW * 0.8), 0.3 + rnd.next() * 1.1, g.z,
          rnd.sym(2.4), 2 + rnd.next() * 3, rnd.sym(1.6),
          0.3 + rnd.next() * 0.25, 0.06, GATE_STYLES[g.op].bodyLight, -8, 1.4, true,
        );
      }
      this.applyGate(g.op, g.value, g.x, g.z);
      this.stats.gatesTaken++;
    }
  }

  private applyGate(op: string, value: number, x: number, z: number): void {
    const before = this.squad.count;
    switch (op) {
      case 'add':
        this.squad.add(value);
        break;
      case 'sub':
        // Penalties are capped as a share of the army. A flat -14 is a slap at
        // 200 troops and a death sentence at 16; proportional keeps it a
        // mistake rather than a run-ender.
        this.loseUnits(Math.max(1, Math.min(value, Math.ceil(before * 0.38))), x, z);
        break;
      case 'mul':
        this.squad.add(before * (value - 1));
        break;
      case 'div':
        this.loseUnits(before - Math.max(1, Math.floor(before / value)), x, z);
        break;
      case 'weapon':
        this.upgradeWeapon(1, x, z);
        return;
      case 'shield':
        this.squad.applyShield(7);
        this.fx.text(x, 2.4, z, 'SHIELD', '#8ff2ec', 1.2);
        audio.sfx('shield');
        return;
      case 'speed':
        this.squad.applyDash(4.5);
        this.fx.text(x, 2.4, z, 'DOUBLE TIME', '#39f5c8', 1.1);
        audio.sfx('gateBig');
        return;
      case 'coin':
        for (let i = 0; i < Math.min(24, value); i++) this.coins.spawn(x + rnd.sym(1), 1, z, Math.ceil(value / 24));
        audio.sfx('coin');
        return;
    }

    const delta = this.squad.count - before;
    if (delta > 0) {
      this.fx.text(x, 2.2, z, `+${formatCount(delta)}`, '#8fd4ff', 1.15);
      audio.sfx(delta >= 20 ? 'gateBig' : 'gate', { vol: clamp(0.25 + delta * 0.004, 0.25, 0.6) });
      this.fx.flash('#63a6ff', 0.12);
    } else if (delta < 0) {
      this.fx.text(x, 2.2, z, `${formatCount(delta)}`, '#ff8b7a', 1.15);
      audio.sfx('gateBad');
      this.cam.addShake(5);
      this.fx.flash('#ff3b2f', 0.18);
    }
  }

  private collideBarricades(): void {
    const z0 = this.prevZ;
    const z1 = this.squad.z;
    const reach = this.squad.radius;
    for (const ba of this.barricades.list) {
      if (ba.remaining <= 0 || ba.z < z0 || ba.z > z1) continue;
      let hitCells = 0;
      for (let col = 0; col < ba.cols; col++) {
        const cx = ba.x + (col - (ba.cols - 1) / 2) * ba.cell;
        if (Math.abs(cx - this.squad.x) > reach + ba.cell * 0.5) continue;
        for (let row = 0; row < ba.rows; row++) {
          const i = row * ba.cols + col;
          if (ba.hp[i] <= 0) continue;
          ba.hp[i] = 0;
          ba.remaining--;
          hitCells++;
          this.fx.shatter(cx, (row + 0.5) * ba.cell, ba.z, '#a9702f', 7, 1);
        }
      }
      if (hitCells > 0) {
        audio.sfx('crateBreak', { vol: 0.5 });
        this.cam.addShake(7);
        this.hurtSquad(hitCells * 2, 'crash');
      }
    }
  }

  private collideBoards(): void {
    const z0 = this.prevZ;
    const z1 = this.squad.z;
    for (const bd of this.boards.list) {
      if (!bd.alive || bd.z < z0 || bd.z > z1) continue;
      if (Math.abs(bd.x - this.squad.x) > bd.w * 0.5 + this.squad.radius * 0.6) continue;
      // Ran into it before shooting it down — costly, but it still gives way.
      const loss = Math.ceil(this.squad.count * 0.3 * clamp(bd.hp / bd.maxHp, 0, 1)) + 2;
      this.hurtSquad(loss, 'crash');
      this.cam.addShake(11);
      bd.alive = false;
      this.fx.shatter(bd.x, bd.h * 0.5, bd.z, '#e8eaef', 18, 1.4);
      audio.sfx('boardBreak');
    }
  }

  private collideEnemies(): void {
    if (this.squad.count <= 0) return;
    const exposure = this.squad.exposure;
    const r = (this.squad.radius + 0.35) * exposure;
    const zBand = (this.squad.radius + 0.5) * exposure;
    for (const e of this.enemies.list) {
      if (!e.alive || e.dying > 0) continue;
      if (Math.abs(e.z - this.squad.z) > zBand) continue;
      if (Math.abs(e.x - this.squad.x) > r) continue;

      if (this.squad.shieldTime > 0) {
        this.enemies.damage(e, 1e9);
        this.onEnemyKilled(e);
        this.fx.impact(e.x, 0.8, e.z, '#8ff2ec', 1.4);
        continue;
      }

      this.hurtSquad(e.def.bite, 'melee');
      this.enemies.damage(e, 1e9);
      this.onEnemyKilled(e);
    }

    if (this.boss.state === 'fight') {
      const gap = this.boss.z - this.squad.z;
      if (gap < this.squad.radius + 1.9) {
        this.hurtSquad(Math.ceil(this.squad.count * 0.1) + 3, 'boss');
        this.cam.addShake(14);
        this.boss.standoff = Math.max(this.boss.standoff, 7.5);
        this.fx.explosion(this.boss.x, 0.6, this.boss.z - 1.4, 1.3, this.boss.def.accent);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private onEnemyKilled(e: Enemy): void {
    this.stats.kills++;
    this.stats.combo++;
    this.comboTimer = 2.2;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.stats.combo);
    this.fx.death(e.x, 0.5, e.z, e.kind === 'runner' ? '#ffd447' : '#e0332f', e.def.height * 0.7);
    this.enemies.creditField(e.z);
    if (e.def.coins > 0 && rnd.bool(0.35)) this.coins.spawn(e.x, 0.5, e.z, e.def.coins);
    audio.sfx('enemyDie', { vol: 0.14, rate: 0.85 + rnd.next() * 0.5 });
    if (this.stats.combo > 0 && this.stats.combo % 50 === 0) {
      this.fx.text(this.squad.x, 3.4, this.squad.z + 3, `${this.stats.combo} COMBO`, '#ffd447', 1.4, 1.2);
      audio.sfx('countUp');
    }
  }

  private onBossKilled(): void {
    this.fx.explosion(this.boss.x, 2.2, this.boss.z, 3.4, this.boss.def.accent, '#ffffff');
    this.cam.addShake(26);
    this.fx.flash('#ffffff', 0.7);
    audio.sfx('bossDie');
    for (let i = 0; i < 40; i++) {
      this.coins.spawn(this.boss.x + rnd.sym(2.6), 1.6, this.boss.z + rnd.sym(2), 5, 4);
    }
    this.showBanner('BOSS DOWN', 'ADVANCE!');
  }

  private breakBoard(x: number, z: number, reward: Reward, board: { alive: boolean }): void {
    board.alive = false;
    this.stats.boardsBroken++;
    this.fx.explosion(x, 1.4, z, 1.5, '#ffffff', '#8fd4ff');
    this.fx.shatter(x, 1.4, z, '#e8eaef', 16, 1.2);
    this.cam.addShake(8);
    audio.sfx('boardBreak');
    this.grantReward(reward, x, z);
  }

  grantReward(reward: Reward, x: number, z: number): void {
    switch (reward.kind) {
      case 'units': {
        const added = this.squad.add(reward.amount, true, 'ally');
        this.fx.text(x, 2.6, z, `+${formatCount(added)}`, '#eef6ff', 1.5, 1.2);
        audio.sfx('recruit');
        this.fx.flash('#8fd4ff', 0.2);
        break;
      }
      case 'weapon':
        this.upgradeWeapon(reward.steps, x, z);
        break;
      case 'coins':
        for (let i = 0; i < Math.min(30, reward.amount); i++) {
          this.coins.spawn(x + rnd.sym(1.4), 1.2, z, Math.ceil(reward.amount / 30), 3);
        }
        audio.sfx('coin');
        break;
      case 'shield':
        this.squad.applyShield(reward.seconds);
        this.fx.text(x, 2.6, z, 'SHIELD', '#8ff2ec', 1.4);
        audio.sfx('shield');
        break;
      case 'dash':
        this.squad.applyDash(reward.seconds);
        audio.sfx('gateBig');
        break;
    }
    this.showToast(rewardLabel(reward));
  }

  upgradeWeapon(steps: number, x: number, z: number): void {
    const before = this.weaponTier;
    this.weaponTier = clamp(this.weaponTier + steps, 0, MAX_WEAPON_TIER);
    if (this.weaponTier === before) {
      for (let i = 0; i < 12; i++) this.coins.spawn(x + rnd.sym(1.2), 1, z, 3);
      this.showToast('MAX WEAPON — GOLD INSTEAD');
      return;
    }
    this.fx.text(x, 3.0, z, this.weapon.name, '#c9a4ff', 1.5, 1.4);
    this.fx.flash(this.weapon.glow, 0.3);
    this.cam.addShake(6);
    audio.sfx('weaponUp');
    for (let i = 0; i < 22; i++) {
      const a = rnd.next() * TAU;
      this.fx.particle(
        'ember', this.squad.x, 1, this.squad.z,
        Math.cos(a) * 6, 4 + rnd.next() * 5, Math.sin(a) * 4,
        0.7, 0.14, this.weapon.glow, -10, 1, true,
      );
    }
  }

  private loseUnits(n: number, x: number, z: number): void {
    const lost = this.hurtSquad(n, 'gate');
    if (lost > 0) this.fx.text(x, 2.2, z, `-${formatCount(lost)}`, '#ff8b7a', 1.15);
  }

  /** Removes units with the right feedback; returns how many were lost. */
  hurtSquad(n: number, _cause: string): number {
    if (n <= 0 || this.squad.count <= 0) return 0;
    const want = Math.min(n, this.squad.count);
    // Puffs are capped: a 200-unit wipe would otherwise white out the screen.
    const k = this.squad.tailPositions(Math.min(6, want), this.tailBuf);
    for (let i = 0; i < k; i++) {
      const t = this.tailBuf[i];
      this.fx.death(t.x, t.y + 0.35, t.z, '#8fb6d8', 0.8);
    }
    const lost = this.squad.remove(want);
    if (lost > 0) {
      audio.sfx('crowdDie', { vol: clamp(0.2 + lost * 0.01, 0.2, 0.55) });
      this.cam.addShake(clamp(2 + lost * 0.25, 2, 12));
      this.fx.flash('#ff3b2f', clamp(0.08 + lost * 0.01, 0.08, 0.35));
      this.stats.combo = 0;
    }
    return lost;
  }

  private onWipe(): void {
    if (this.revivesLeft > 0) {
      this.revivesLeft--;
      this.squad.add(Math.max(8, Math.floor(this.stats.peakTroops * 0.25)), true);
      this.squad.applyShield(4);
      this.showBanner('RALLY!', `${this.revivesLeft} LEFT`);
      this.fx.flash('#ffd447', 0.5);
      audio.sfx('win', { vol: 0.5 });
      return;
    }
    this.phase = 'failed';
    this.endReason = 'wiped';
    this.endDelay = 1.2;
    audio.sfx('lose');
    audio.setMusic('none');
    this.cam.addShake(18);
  }

  private finish(reason: 'boss' | 'finished'): void {
    this.phase = 'clear';
    this.endReason = reason;
    this.endDelay = 1.6;
    audio.sfx('win');
    audio.setMusic('victory');
    this.showBanner('SECTOR CLEAR', this.plan.name);
  }

  get readyToScore(): boolean {
    return this.phase !== 'running' && this.endDelay <= 0;
  }

  showBanner(text: string, sub: string): void {
    this.bannerText = text;
    this.bannerSub = sub;
    this.bannerT = 2.4;
  }

  showToast(text: string): void {
    this.toastText = text;
    this.toastT = 1.8;
  }

  /** 0..1 progress along the level, for the HUD track. */
  get progress(): number {
    return clamp(this.squad.z / this.plan.length, 0, 1);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  draw(stage: PixelStage): void {
    const cam = this.cam;
    const proj = scratchProjection;
    const b = this.biome;

    drawSky(stage.layers.sky, b, cam, this.time);
    drawFar(stage.layers.far, b, cam, this.time);
    drawGround(stage.layers.mid, b, cam, this.time);

    const w = stage.layers.world;
    drawRoad(w, b, cam, this.time);
    drawTrackside(w, b, cam, this.time);
    this.enemies.drawFields(w, cam, proj, b.fog);
    this.barricades.draw(w, cam, proj, b.fog);
    this.boards.draw(w, cam, proj, b.fog);
    this.gates.draw(w, cam, proj, b.fog, this.time);
    this.coins.draw(w, cam, proj);
    this.enemies.drawEnemies(w, cam, proj, b.fog);
    this.boss.draw(w, cam, proj, this.time);
    this.squad.draw(w, cam, proj, this.time);

    const f = stage.layers.fx;
    this.bullets.draw(f, cam, proj);
    this.fx.draw(f, cam, proj);
    if (this.fx.flashAmount > 0.01) {
      f.rect(0, 0, cam.width, cam.height, this.fx.flashColor, Math.min(0.72, this.fx.flashAmount));
    }
  }

  /** Snapshot for the debug hook / screenshot harness. */
  snapshot(): Record<string, unknown> {
    return {
      phase: this.phase,
      level: this.plan?.index ?? -1,
      levelName: this.plan?.name ?? '',
      biome: this.biome.id,
      troops: this.squad.count,
      z: Math.round(this.squad.z * 10) / 10,
      progress: Math.round(this.progress * 1000) / 1000,
      weapon: this.weapon.name,
      weaponTier: this.weaponTier,
      push: Math.round(this.squad.push * 100) / 100,
      fireRateMul: Math.round(this.squad.fireRateMul * 100) / 100,
      kills: this.stats.kills,
      gold: this.stats.gold,
      score: this.stats.score,
      enemies: this.enemies.live,
      bullets: this.bullets.live,
      particles: this.fx.liveParticles,
      gates: this.gates.list.length,
      boards: this.boards.list.length,
      board0: this.boards.list[0]
        ? {
            z: Math.round(this.boards.list[0].z),
            hp: Math.round(this.boards.list[0].hp),
            x: Math.round(this.boards.list[0].x * 100) / 100,
            alive: this.boards.list[0].alive,
          }
        : null,
      boss: this.boss.state,
      bossHp: Math.round(this.boss.healthFrac * 100) / 100,
    };
  }
}

/** Keeps the near-plane constant referenced from a single place. */
export const WORLD_NEAR_Z = NEAR_Z;
export const WORLD_ROAD_HALF = ROAD_HALF;
