/** Shared colour vocabulary. Warm-lit arcade palette with punchy team colours. */

export const PAL = {
  // Neutrals
  ink: '#0b0d14',
  ink2: '#161a26',
  shadow: 'rgba(6,8,14,0.45)',
  steel: '#4a5468',
  steelLight: '#6d7a91',
  steelDark: '#2c3444',
  bone: '#e8e2d0',
  boneDark: '#b9b19a',
  white: '#fdfdf6',

  // Player blue team
  blue: '#2f6ddb',
  blueLight: '#63a6ff',
  blueDark: '#1b3d84',
  blueGlow: '#8fd4ff',

  // Player crimson/gold team (bridge level, like the reference redcoats)
  crimson: '#c22b3f',
  crimsonLight: '#f0574f',
  crimsonDark: '#7c1226',
  gold: '#ffd447',
  goldDark: '#c58a15',
  teal: '#2ec9c0',
  tealDark: '#16706e',

  // Enemy red
  red: '#e0332f',
  redLight: '#ff6a52',
  redDark: '#8a1418',
  rot: '#8f3b3b',

  // Boss orange
  orange: '#ff8b2b',
  orangeLight: '#ffc25e',
  orangeDark: '#a8410c',
  magenta: '#ff5fd2',
  violet: '#8a4fff',

  // Nature / environment
  ocean: '#0f6f9e',
  oceanLight: '#31a8cf',
  oceanDeep: '#0a3f66',
  foam: '#bff0ff',
  sand: '#e4c48a',
  grass: '#3f9f4a',
  grassDark: '#22662f',
  wood: '#a9702f',
  woodLight: '#d09a4e',
  woodDark: '#6c4116',
  lava: '#ff5a1f',
  lavaLight: '#ffc93c',
  lavaDark: '#8f1f06',
  rust: '#7a4630',
  ice: '#bfe9ff',
  iceDark: '#5f9fc4',
  snow: '#f2fbff',
  night: '#141c33',
  neon: '#39f5c8',
  neonPink: '#ff3fa4',
  purple: '#5b3aa8',
  asphalt: '#4d5158',
  asphaltLight: '#666b74',
  asphaltDark: '#33363c',
  dust: '#c8b898',
} as const;

export type PaletteKey = keyof typeof PAL;

/** Mixes two hex colours. Used for fog and lighting ramps. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function parseHex(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Darkens (t<0) or lightens (t>0) a colour. */
export function shade(hex: string, t: number): string {
  return t >= 0 ? mixHex(hex, '#ffffff', t) : mixHex(hex, '#000000', -t);
}

const rampCache = new Map<string, string[]>();

/** Precomputed fog ramp so per-frame drawing never parses hex. */
export function fogRamp(hex: string, fogColor: string, steps = 12): string[] {
  const key = `${hex}|${fogColor}|${steps}`;
  const hit = rampCache.get(key);
  if (hit) return hit;
  const out: string[] = [];
  for (let i = 0; i < steps; i++) out.push(mixHex(hex, fogColor, i / (steps - 1)));
  rampCache.set(key, out);
  return out;
}

export function pickRamp(ramp: string[], t: number): string {
  const i = Math.round(t * (ramp.length - 1));
  return ramp[i < 0 ? 0 : i >= ramp.length ? ramp.length - 1 : i];
}
