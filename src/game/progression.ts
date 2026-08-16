/** Persistent meta-progression: gold, barracks upgrades and records. */

import { clamp } from '../core/math';
import { loadJson, saveJson, clearAll } from '../core/storage';
import { ICON_BOLT, ICON_COIN, ICON_HEART, ICON_MAGNET, ICON_RIFLE, ICON_SOLDIER } from '../render/art';
import type { SpriteDef } from '../render/sprite';

export type UpgradeId = 'troops' | 'firerate' | 'damage' | 'magnet' | 'revive' | 'speed';

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly name: string;
  readonly blurb: string;
  readonly icon: SpriteDef;
  readonly maxLevel: number;
  readonly baseCost: number;
  readonly growth: number;
  /** Human-readable value at a given level. */
  readonly format: (level: number) => string;
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'troops', name: 'RECRUITS', blurb: 'START WITH MORE TROOPS',
    icon: ICON_SOLDIER, maxLevel: 12, baseCost: 60, growth: 1.42,
    format: (l) => `${9 + l * 2} START`,
  },
  {
    id: 'firerate', name: 'DRILL', blurb: 'FASTER RATE OF FIRE',
    icon: ICON_RIFLE, maxLevel: 10, baseCost: 90, growth: 1.5,
    format: (l) => `+${Math.round(l * 4)}% ROF`,
  },
  {
    id: 'damage', name: 'POWDER', blurb: 'HEAVIER SHOT',
    icon: ICON_BOLT, maxLevel: 10, baseCost: 110, growth: 1.52,
    format: (l) => `+${Math.round(l * 9)}% DMG`,
  },
  {
    id: 'magnet', name: 'SUPPLY', blurb: 'PULL GOLD FROM FURTHER',
    icon: ICON_MAGNET, maxLevel: 6, baseCost: 70, growth: 1.45,
    format: (l) => `+${(l * 0.9).toFixed(1)} PULL`,
  },
  {
    id: 'revive', name: 'RALLY', blurb: 'REGROUP ONCE PER RUN',
    icon: ICON_HEART, maxLevel: 3, baseCost: 240, growth: 2.1,
    format: (l) => `${l} SAVES`,
  },
  {
    id: 'speed', name: 'MARCH', blurb: 'ADVANCE FASTER',
    icon: ICON_COIN, maxLevel: 6, baseCost: 80, growth: 1.48,
    format: (l) => `+${Math.round(l * 5)}% PACE`,
  },
] as const;

export interface MetaState {
  gold: number;
  upgrades: Record<UpgradeId, number>;
  levelsCleared: number;
  highestLevel: number;
  bestTroops: number;
  bestScore: number;
  totalKills: number;
  runs: number;
  muted: boolean;
  seenHelp: boolean;
}

const DEFAULT_META: MetaState = {
  gold: 0,
  upgrades: { troops: 0, firerate: 0, damage: 0, magnet: 0, revive: 0, speed: 0 },
  levelsCleared: 0,
  highestLevel: 0,
  bestTroops: 0,
  bestScore: 0,
  totalKills: 0,
  runs: 0,
  muted: false,
  seenHelp: false,
};

export class Meta {
  state: MetaState;

  constructor() {
    const loaded = loadJson<MetaState>('meta', DEFAULT_META);
    // Merge nested upgrade record explicitly — loadJson only shallow-merges.
    loaded.upgrades = { ...DEFAULT_META.upgrades, ...(loaded.upgrades ?? {}) };
    this.state = loaded;
  }

  save(): void {
    saveJson('meta', this.state);
  }

  wipe(): void {
    clearAll();
    this.state = JSON.parse(JSON.stringify(DEFAULT_META)) as MetaState;
    this.save();
  }

  level(id: UpgradeId): number {
    return this.state.upgrades[id] ?? 0;
  }

  def(id: UpgradeId): UpgradeDef {
    return UPGRADES.find((u) => u.id === id)!;
  }

  cost(id: UpgradeId): number {
    const d = this.def(id);
    const l = this.level(id);
    if (l >= d.maxLevel) return Infinity;
    return Math.round(d.baseCost * Math.pow(d.growth, l));
  }

  canAfford(id: UpgradeId): boolean {
    return this.state.gold >= this.cost(id);
  }

  buy(id: UpgradeId): boolean {
    const c = this.cost(id);
    if (!isFinite(c) || this.state.gold < c) return false;
    this.state.gold -= c;
    this.state.upgrades[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  addGold(n: number): void {
    this.state.gold = Math.max(0, Math.round(this.state.gold + n));
  }

  // --- Derived run parameters -------------------------------------------

  get startTroops(): number {
    return 9 + this.level('troops') * 2;
  }

  get fireRateMul(): number {
    return 1 / (1 + this.level('firerate') * 0.04);
  }

  get damageMul(): number {
    return 1 + this.level('damage') * 0.09;
  }

  get magnetRange(): number {
    return 2.4 + this.level('magnet') * 0.9;
  }

  get revives(): number {
    return this.level('revive');
  }

  get speedMul(): number {
    return 1 + this.level('speed') * 0.05;
  }

  recordRun(result: { cleared: boolean; level: number; troops: number; score: number; kills: number; gold: number }): void {
    const s = this.state;
    s.runs++;
    s.totalKills += result.kills;
    s.bestTroops = Math.max(s.bestTroops, result.troops);
    s.bestScore = Math.max(s.bestScore, result.score);
    if (result.cleared) {
      s.levelsCleared++;
      s.highestLevel = Math.max(s.highestLevel, result.level + 1);
    }
    this.addGold(result.gold);
    this.save();
  }

  /** Highest level the player is allowed to start from. */
  get unlockedLevels(): number {
    return clamp(this.state.highestLevel + 1, 1, 99);
  }
}
