/** Static game data: weapons, enemy archetypes, biomes and gate flavours. */

import { PAL } from '../render/palette';
import { SPR_BRUTE, SPR_GRUNT_A, SPR_GRUNT_B, SPR_RUNNER, SPR_SHIELDER, SPR_SHOOTER } from '../render/art';
import type { SpriteDef } from '../render/sprite';

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type ProjectileStyle = 'ball' | 'bullet' | 'pellet' | 'bolt' | 'plasma' | 'laser' | 'rocket';

export interface WeaponDef {
  readonly id: string;
  readonly name: string;
  readonly tier: number;
  /** Seconds between volleys. */
  readonly interval: number;
  readonly damage: number;
  /** World units per second. */
  readonly speed: number;
  readonly pellets: number;
  /** Half-angle of the spread cone, radians. */
  readonly spread: number;
  readonly pierce: number;
  readonly style: ProjectileStyle;
  readonly color: string;
  readonly glow: string;
  readonly trail: number;
  readonly sfx: 'shoot' | 'shootHeavy' | 'laser' | 'shotgun' | 'rocket';
  /** Visual size multiplier. */
  readonly size: number;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'musket', name: 'MUSKET', tier: 0,
    interval: 0.34, damage: 15, speed: 46, pellets: 1, spread: 0.018, pierce: 0,
    style: 'ball', color: '#ffe27a', glow: '#fff6c9', trail: 0.7, sfx: 'shoot', size: 1,
  },
  {
    id: 'rifle', name: 'RIFLE', tier: 1,
    interval: 0.26, damage: 19, speed: 52, pellets: 1, spread: 0.02, pierce: 0,
    style: 'bullet', color: '#ffd447', glow: '#fff3b0', trail: 1.0, sfx: 'shoot', size: 1,
  },
  {
    id: 'carbine', name: 'CARBINE', tier: 2,
    interval: 0.22, damage: 23, speed: 57, pellets: 1, spread: 0.026, pierce: 0,
    style: 'bullet', color: '#ffc25e', glow: '#fff0c4', trail: 1.1, sfx: 'shoot', size: 1.05,
  },
  {
    id: 'scatter', name: 'SCATTER', tier: 3,
    interval: 0.34, damage: 12, speed: 50, pellets: 3, spread: 0.11, pierce: 0,
    style: 'pellet', color: '#ffb04a', glow: '#ffe0a0', trail: 0.8, sfx: 'shotgun', size: 0.9,
  },
  {
    id: 'auto', name: 'AUTO RIFLE', tier: 4,
    interval: 0.155, damage: 17, speed: 62, pellets: 1, spread: 0.032, pierce: 0,
    style: 'bullet', color: '#ffe27a', glow: '#fffbe0', trail: 1.2, sfx: 'shoot', size: 1.1,
  },
  {
    id: 'twinbolt', name: 'TWIN BOLT', tier: 5,
    interval: 0.145, damage: 21, speed: 68, pellets: 2, spread: 0.045, pierce: 1,
    style: 'bolt', color: '#d9f6ff', glow: '#8fd4ff', trail: 1.5, sfx: 'shootHeavy', size: 1.15,
  },
  {
    id: 'stormbolt', name: 'STORM BOLT', tier: 6,
    interval: 0.105, damage: 26, speed: 74, pellets: 2, spread: 0.055, pierce: 1,
    style: 'bolt', color: '#eafcff', glow: '#63d8ff', trail: 1.7, sfx: 'shootHeavy', size: 1.2,
  },
  {
    id: 'plasma', name: 'PLASMA', tier: 7,
    interval: 0.095, damage: 34, speed: 78, pellets: 2, spread: 0.06, pierce: 2,
    style: 'plasma', color: '#b9ffec', glow: '#39f5c8', trail: 1.9, sfx: 'laser', size: 1.35,
  },
  {
    id: 'lance', name: 'ION LANCE', tier: 8,
    interval: 0.075, damage: 44, speed: 92, pellets: 3, spread: 0.05, pierce: 3,
    style: 'laser', color: '#ffffff', glow: '#ff5fd2', trail: 2.4, sfx: 'laser', size: 1.2,
  },
  {
    id: 'annihilator', name: 'ANNIHILATOR', tier: 9,
    interval: 0.06, damage: 58, speed: 100, pellets: 4, spread: 0.075, pierce: 4,
    style: 'plasma', color: '#fff0ff', glow: '#ff8bf0', trail: 2.6, sfx: 'rocket', size: 1.5,
  },
] as const;

export const MAX_WEAPON_TIER = WEAPONS.length - 1;

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export type EnemyKind = 'grunt' | 'runner' | 'shielder' | 'shooter' | 'brute';

export interface EnemyDef {
  readonly kind: EnemyKind;
  readonly hp: number;
  /** World units per second, toward the player. */
  readonly speed: number;
  /** How many squad members it takes out on contact. */
  readonly bite: number;
  /** World-unit height of the sprite. */
  readonly height: number;
  readonly frames: readonly SpriteDef[];
  /** Damage taken multiplier (shields soak). */
  readonly armor: number;
  readonly score: number;
  readonly coins: number;
  /** Fires back at the squad. */
  readonly ranged?: { interval: number; speed: number; damage: number };
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: {
    kind: 'grunt', hp: 12, speed: 3.0, bite: 1, height: 1.5,
    frames: [SPR_GRUNT_A, SPR_GRUNT_B], armor: 1, score: 1, coins: 1,
  },
  runner: {
    kind: 'runner', hp: 7, speed: 6.4, bite: 1, height: 1.15,
    frames: [SPR_RUNNER], armor: 1, score: 1, coins: 1,
  },
  shielder: {
    kind: 'shielder', hp: 90, speed: 2.4, bite: 3, height: 1.7,
    frames: [SPR_SHIELDER], armor: 0.42, score: 6, coins: 4,
  },
  shooter: {
    kind: 'shooter', hp: 26, speed: 2.0, bite: 1, height: 1.5,
    frames: [SPR_SHOOTER], armor: 1, score: 4, coins: 3,
    ranged: { interval: 1.7, speed: 26, damage: 2 },
  },
  brute: {
    kind: 'brute', hp: 260, speed: 2.1, bite: 8, height: 2.9,
    frames: [SPR_BRUTE], armor: 0.6, score: 20, coins: 12,
  },
};

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export type GateOp = 'add' | 'mul' | 'sub' | 'div' | 'weapon' | 'shield' | 'coin' | 'speed';

export interface GateStyle {
  readonly body: string;
  readonly bodyLight: string;
  readonly edge: string;
  readonly text: string;
  readonly good: boolean;
}

export const GATE_STYLES: Record<GateOp, GateStyle> = {
  add: { body: '#2f6ddb', bodyLight: '#63a6ff', edge: '#12306e', text: '#ffffff', good: true },
  mul: { body: '#ffd447', bodyLight: '#fff0a8', edge: '#a8700a', text: '#231a00', good: true },
  sub: { body: '#c22b3f', bodyLight: '#f0574f', edge: '#5e0c1c', text: '#ffffff', good: false },
  div: { body: '#7a1e46', bodyLight: '#c14f7c', edge: '#3a0a20', text: '#ffffff', good: false },
  weapon: { body: '#8a4fff', bodyLight: '#c9a4ff', edge: '#3d1c7a', text: '#ffffff', good: true },
  shield: { body: '#2ec9c0', bodyLight: '#8ff2ec', edge: '#0f5b58', text: '#04211f', good: true },
  coin: { body: '#e8a41c', bodyLight: '#ffd980', edge: '#8a5a05', text: '#2a1a00', good: true },
  speed: { body: '#39f5c8', bodyLight: '#b9ffec', edge: '#0b6a55', text: '#04211f', good: true },
};

export function gateLabel(op: GateOp, value: number): string {
  switch (op) {
    case 'add':
      return `+${value}`;
    case 'sub':
      return `-${value}`;
    case 'mul':
      return `*${value}`;
    case 'div':
      return `/${value}`;
    case 'weapon':
      return 'GUN+';
    case 'shield':
      return 'SHIELD';
    case 'coin':
      return `+${value}$`;
    case 'speed':
      return 'DASH';
  }
}

// ---------------------------------------------------------------------------
// Biomes
// ---------------------------------------------------------------------------

export type BiomeId = 'bridge' | 'foundry' | 'tundra' | 'dunes' | 'neon' | 'void';

export interface BiomeDef {
  readonly id: BiomeId;
  readonly name: string;
  /** Sky gradient, top to bottom. */
  readonly skyTop: string;
  readonly skyBottom: string;
  /** Colour distant geometry fades into. */
  readonly fog: string;
  /** The ground beyond the road. */
  readonly ground: string;
  readonly groundAlt: string;
  /** Road surface. */
  readonly road: string;
  readonly roadEdge: string;
  readonly roadLine: string;
  readonly railColor: string;
  readonly sunColor: string;
  readonly sunY: number;
  /** Ambient particle tint (embers, snow, spray). */
  readonly moteColor: string;
  readonly moteRate: number;
  readonly music: 'run' | 'boss';
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  bridge: {
    id: 'bridge', name: 'IRON STRAIT',
    skyTop: '#1d5fa8', skyBottom: '#9fd8ef', fog: '#8fc7e4',
    ground: '#0f6f9e', groundAlt: '#0a3f66',
    road: '#5a6068', roadEdge: '#3a3f47', roadLine: '#d8dde4',
    railColor: '#8d96a8', sunColor: '#fff3c0', sunY: 0.17,
    moteColor: '#bff0ff', moteRate: 0.5, music: 'run',
  },
  foundry: {
    id: 'foundry', name: 'SLAG WORKS',
    skyTop: '#20120c', skyBottom: '#7a2a10', fog: '#6b2a14',
    ground: '#4a2a1c', groundAlt: '#2a1610',
    road: '#5b4436', roadEdge: '#33241c', roadLine: '#c07a3a',
    railColor: '#7a4630', sunColor: '#ff8b2b', sunY: 0.22,
    moteColor: '#ffb04a', moteRate: 2.6, music: 'run',
  },
  tundra: {
    id: 'tundra', name: 'FROST REACH',
    skyTop: '#26406e', skyBottom: '#bcd8ef', fog: '#cfe4f2',
    ground: '#dceaf4', groundAlt: '#a9c6dc',
    road: '#8fa6bb', roadEdge: '#5f7a92', roadLine: '#eff8ff',
    railColor: '#5f9fc4', sunColor: '#eaf6ff', sunY: 0.14,
    moteColor: '#ffffff', moteRate: 3.2, music: 'run',
  },
  dunes: {
    id: 'dunes', name: 'BRASS DUNES',
    skyTop: '#c2701f', skyBottom: '#f3cf8a', fog: '#e0b877',
    ground: '#d9ab5f', groundAlt: '#b1813d',
    road: '#a98a5c', roadEdge: '#7a5c34', roadLine: '#f5e3b8',
    railColor: '#8a6a3a', sunColor: '#fff0b0', sunY: 0.19,
    moteColor: '#e4c48a', moteRate: 2.0, music: 'run',
  },
  neon: {
    id: 'neon', name: 'NEON MILE',
    skyTop: '#0a0620', skyBottom: '#3a1466', fog: '#2a1252',
    ground: '#160e2c', groundAlt: '#0d0820',
    road: '#251a3f', roadEdge: '#120c22', roadLine: '#ff3fa4',
    railColor: '#39f5c8', sunColor: '#ff3fa4', sunY: 0.2,
    moteColor: '#39f5c8', moteRate: 1.6, music: 'run',
  },
  void: {
    id: 'void', name: 'THE LAST MILE',
    skyTop: '#05060f', skyBottom: '#181038', fog: '#12102c',
    ground: '#0a0a18', groundAlt: '#050510',
    road: '#1a1830', roadEdge: '#0a0a16', roadLine: '#8a4fff',
    railColor: '#5b3aa8', sunColor: '#c9a4ff', sunY: 0.13,
    moteColor: '#c9a4ff', moteRate: 1.2, music: 'boss',
  },
};

/** Convenience so callers can keep the palette import meaningful. */
export const UI_ACCENT = PAL.gold;
