/**
 * Level construction.
 *
 * A level is a flat, ordered list of things placed at depths along the road.
 * The world streams them in as the squad approaches, which keeps memory flat
 * and makes runs perfectly reproducible from a seed.
 */

import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { BiomeId, EnemyKind, GateOp } from './defs';
import type { BossId } from './boss';
import type { BarricadeKind, Reward } from './props';
import type { UnitSkin } from './squad';
import { ROAD_HALF } from '../render/camera';

export type PlanItem =
  | { t: 'gate'; z: number; x: number; halfW: number; op: GateOp; value: number }
  | { t: 'ladder'; z: number; x: number; halfW: number; op: GateOp; value: number; count: number; spacing: number }
  | { t: 'board'; z: number; x: number; hp: number; reward: Reward; w: number; h: number }
  | { t: 'barricade'; z: number; x: number; cols: number; rows: number; kind: BarricadeKind; cellHp: number }
  | { t: 'horde'; z: number; length: number; x: number; halfW: number; count: number; kinds: EnemyKind[]; hpScale: number }
  | { t: 'squad'; z: number; kind: EnemyKind; x: number; hpScale: number; count: number; spread: number }
  | { t: 'coins'; z: number; x: number; count: number }
  | { t: 'boss'; z: number; boss: BossId; hpScale: number }
  | { t: 'banner'; z: number; text: string; sub: string };

export interface LevelPlan {
  index: number;
  name: string;
  biome: BiomeId;
  skin: UnitSkin;
  length: number;
  startUnits: number;
  startWeapon: number;
  hpScale: number;
  items: PlanItem[];
  bossId: BossId;
  parTime: number;
}

interface LevelSeedDef {
  biome: BiomeId;
  skin: UnitSkin;
  name: string;
  boss: BossId;
}

const CAMPAIGN: LevelSeedDef[] = [
  { biome: 'bridge', skin: 'blue', name: 'IRON STRAIT', boss: 'ogre' },
  { biome: 'foundry', skin: 'blue', name: 'SLAG WORKS', boss: 'mech' },
  { biome: 'tundra', skin: 'blue', name: 'FROST REACH', boss: 'ogre' },
  { biome: 'dunes', skin: 'red', name: 'BRASS DUNES', boss: 'mech' },
  { biome: 'neon', skin: 'blue', name: 'NEON MILE', boss: 'ogre' },
  { biome: 'void', skin: 'ally', name: 'THE LAST MILE', boss: 'mech' },
];

export const CAMPAIGN_LENGTH = CAMPAIGN.length;

export function levelName(index: number): string {
  const base = CAMPAIGN[index % CAMPAIGN.length];
  const loop = Math.floor(index / CAMPAIGN.length);
  return loop === 0 ? base.name : `${base.name} +${loop}`;
}

export function levelBiome(index: number): BiomeId {
  return CAMPAIGN[index % CAMPAIGN.length].biome;
}

/** Deterministically builds level `index`. */
export function buildLevel(index: number, seed: number, startUnits: number): LevelPlan {
  const def = CAMPAIGN[index % CAMPAIGN.length];
  const loop = Math.floor(index / CAMPAIGN.length);
  const rng = new Rng((seed ^ (index * 0x9e3779b1)) >>> 0);

  const diff = index * 0.62 + loop * 1.4;
  const hpScale = 1 + diff * 0.5;
  const length = 620 + index * 55 + loop * 120;
  const items: PlanItem[] = [];

  const lane = ROAD_HALF - 1.05;
  const push = (i: PlanItem) => items.push(i);

  push({ t: 'banner', z: 4, text: levelName(index), sub: `SECTOR ${index + 1}` });

  // --- Opening: a friendly ladder so the crowd gets rolling immediately.
  push({
    t: 'ladder', z: 18, x: -lane, halfW: 0.82, op: 'add', value: 1,
    count: 11 + Math.floor(rng.range(0, 5)), spacing: 3.2,
  });
  push({
    t: 'ladder', z: 20, x: lane, halfW: 0.82, op: 'add', value: 1,
    count: 9, spacing: 3.6,
  });
  push({
    t: 'horde', z: 96, length: 120, x: 0.4, halfW: 1.55,
    count: 70 + Math.floor(diff * 22), kinds: ['grunt'], hpScale,
  });

  let z = 128;
  let beat = 0;
  const bossZ = length - 70;

  while (z < bossZ - 60) {
    const roll = rng.next();
    const phase = z / bossZ;

    if (roll < 0.16) {
      // Choice gates: a good one and a tempting-but-bad one.
      const good: GateOp = rng.bool(0.62) ? 'add' : 'mul';
      const goodVal = good === 'add' ? 10 + Math.floor(rng.range(4, 26) + diff * 3) : 2;
      const badRoll = rng.next();
      const bad: GateOp = badRoll < 0.5 ? 'sub' : badRoll < 0.8 ? 'div' : 'add';
      const badVal = bad === 'sub' ? 8 + Math.floor(rng.range(2, 14) + diff * 2) : bad === 'div' ? 2 : 3;
      const leftIsGood = rng.bool();
      push({ t: 'gate', z, x: -lane * 0.55, halfW: 1.25, op: leftIsGood ? good : bad, value: leftIsGood ? goodVal : badVal });
      push({ t: 'gate', z, x: lane * 0.55, halfW: 1.25, op: leftIsGood ? bad : good, value: leftIsGood ? badVal : goodVal });
      z += 34;
    } else if (roll < 0.32) {
      // Long side ladder — brush along it to stack up units.
      const side = rng.bool() ? -1 : 1;
      push({
        t: 'ladder', z, x: side * lane, halfW: 0.82, op: 'add', value: 1,
        count: 9 + Math.floor(rng.range(0, 7)), spacing: 3.2,
      });
      // ...with a big-ticket ladder on the far side to make it a real choice.
      push({
        t: 'ladder', z: z + 6, x: -side * lane, halfW: 0.82, op: rng.bool(0.7) ? 'add' : 'coin',
        value: rng.bool(0.7) ? 33 + Math.floor(diff * 6) : 25,
        count: 4 + Math.floor(rng.range(0, 4)), spacing: 5.2,
      });
      push({
        t: 'horde', z: z + 10, length: 108, x: 0, halfW: 1.3,
        count: 96 + Math.floor(diff * 26), kinds: ['grunt', 'runner'], hpScale,
      });
      z += 54;
    } else if (roll < 0.52) {
      // Shoot-through reward board, exactly like the reference clips.
      const rewardRoll = rng.next();
      const reward: Reward =
        rewardRoll < 0.34
          ? { kind: 'weapon', steps: 1 }
          : rewardRoll < 0.72
            ? { kind: 'units', amount: 20 + Math.floor(rng.range(6, 34) + diff * 5) }
            : rewardRoll < 0.88
              ? { kind: 'coins', amount: 40 + Math.floor(diff * 12) }
              : { kind: 'shield', seconds: 6 };
      const hp = Math.round((reward.kind === 'weapon' ? 260 : 400) * (1 + diff * 0.55) * rng.range(0.85, 1.2));
      push({ t: 'board', z, x: rng.range(-0.7, 0.7), hp, reward, w: 4.2, h: 4.0 });
      push({
        t: 'horde', z: z + 20, length: 104, x: rng.range(-1, 1), halfW: 1.35,
        count: 88 + Math.floor(diff * 24), kinds: ['grunt'], hpScale,
      });
      push({
        t: 'ladder', z: z + 22, x: (rng.bool() ? -1 : 1) * lane, halfW: 0.82, op: 'add', value: 1,
        count: 8 + Math.floor(rng.range(0, 5)), spacing: 3.2,
      });
      z += 56;
    } else if (roll < 0.64) {
      // Barricade to blast through.
      const kinds: BarricadeKind[] = ['crate', 'plank', 'barrel', 'sandbag'];
      const kind = kinds[Math.floor(rng.range(0, kinds.length))];
      const cols = 5 + Math.floor(rng.range(0, 3));
      const rows = 2 + Math.floor(rng.range(0, 2) + phase * 1.5);
      push({
        t: 'barricade', z, x: rng.range(-1.2, 1.2), cols, rows, kind,
        cellHp: Math.round(38 * (1 + diff * 0.42)),
      });
      push({ t: 'coins', z: z + 8, x: rng.range(-1.6, 1.6), count: 6 + Math.floor(rng.range(0, 6)) });
      z += 32;
    } else if (roll < 0.82) {
      // A proper wall of bodies — the marching invasion.
      const kinds: EnemyKind[] = phase > 0.55 ? ['grunt', 'shielder', 'runner'] : ['grunt', 'runner'];
      push({
        t: 'horde', z, length: 150 + rng.range(0, 70), x: rng.range(-0.8, 0.8), halfW: 1.6 + rng.range(0, 0.8),
        count: 170 + Math.floor(diff * 42), kinds, hpScale,
      });
      // Ladders down both shoulders, the way the reference clips frame a wall
      // of bodies: whichever side you hug, you are stacking up while you fight.
      push({
        t: 'ladder', z: z + 4, x: -lane, halfW: 0.82, op: 'add', value: 1,
        count: 8 + Math.floor(rng.range(0, 6)), spacing: 3.2,
      });
      push({
        t: 'ladder', z: z + 6, x: lane, halfW: 0.82, op: 'add', value: 1,
        count: 8 + Math.floor(rng.range(0, 6)), spacing: 3.2,
      });
      z += 104;
    } else if (roll < 0.92) {
      // Elite pack.
      const kind: EnemyKind = phase > 0.6 && rng.bool(0.5) ? 'brute' : rng.bool(0.5) ? 'shielder' : 'shooter';
      push({
        t: 'squad', z, kind, x: rng.range(-1.4, 1.4), hpScale,
        count: kind === 'brute' ? 1 : 3 + Math.floor(rng.range(0, 3)), spread: 1.8,
      });
      push({ t: 'gate', z: z + 18, x: 0, halfW: 1.35, op: rng.bool(0.5) ? 'shield' : 'speed', value: 1 });
      z += 40;
    } else {
      // Weapon shrine: a purple gate that always upgrades.
      push({ t: 'gate', z, x: rng.range(-1.2, 1.2), halfW: 1.4, op: 'weapon', value: 1 });
      push({ t: 'coins', z: z + 6, x: rng.range(-1.6, 1.6), count: 10 });
      z += 34;
    }

    beat++;
    if (beat % 4 === 3) {
      push({ t: 'coins', z: z - 12, x: rng.range(-2, 2), count: 8 });
    }
  }

  // --- Guaranteed reward boards. The random beats may or may not roll one, and
  // the shoot-the-number-down board is too central to the game to leave to luck.
  const boardHp = (k: number) => Math.round(320 * k * (1 + diff * 0.55));
  push({ t: 'board', z: 186, x: rng.range(-0.3, 0.3), hp: boardHp(0.8), reward: { kind: 'weapon', steps: 1 }, w: 4.6, h: 4.4 });
  push({
    t: 'board', z: Math.round(bossZ * 0.48) - 22, x: -1.55, hp: boardHp(1.1),
    reward: { kind: 'weapon', steps: 1 }, w: 3.3, h: 4.2,
  });
  // Twin panels, side by side, exactly like the reference clip: pick which
  // prize to shoot down before you run past them.
  push({
    t: 'board', z: Math.round(bossZ * 0.48) - 22, x: 1.55, hp: boardHp(1.35),
    reward: { kind: 'units', amount: 45 + Math.floor(diff * 14) }, w: 3.3, h: 4.6,
  });
  push({ t: 'board', z: Math.round(bossZ * 0.74), x: rng.range(-0.4, 0.4), hp: boardHp(1.5), reward: { kind: 'weapon', steps: 1 }, w: 4.6, h: 4.4 });

  // --- Boss approach.
  push({ t: 'banner', z: bossZ - 46, text: 'BOSS AHEAD', sub: 'HOLD THE LINE' });
  push({
    t: 'ladder', z: bossZ - 40, x: -lane, halfW: 0.82, op: 'add', value: 2,
    count: 6, spacing: 3.4,
  });
  push({
    t: 'ladder', z: bossZ - 40, x: lane, halfW: 0.82, op: 'add', value: 2,
    count: 6, spacing: 3.4,
  });
  push({ t: 'gate', z: bossZ - 16, x: 0, halfW: 1.5, op: 'shield', value: 1 });
  push({ t: 'boss', z: bossZ, boss: def.boss, hpScale: 1 + diff * 0.75 });

  items.sort((a, b) => a.z - b.z);

  return {
    index,
    name: levelName(index),
    biome: def.biome,
    skin: def.skin,
    length,
    startUnits,
    startWeapon: clamp(Math.floor(index / 2), 0, 3),
    hpScale,
    items,
    bossId: def.boss,
    parTime: 70 + index * 6,
  };
}
