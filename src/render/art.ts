/**
 * The pixel-art bank.
 *
 * Everything here is hand-authored as ASCII matrices. Sprites are drawn from
 * behind for friendlies (we chase them) and from the front for enemies (they
 * march at us), which is what sells the "marching forward" framing.
 */

import { PAL } from './palette';
import { defineSprite, recolor, type SpriteDef } from './sprite';

// ---------------------------------------------------------------------------
// Friendly infantry — seen from behind
// ---------------------------------------------------------------------------

/**
 * Friendly infantry, seen from behind.
 *
 * Field-green army palette with hard black outlines: dark helmet with a pale
 * unit flash on the crown, tan neck, layered greens on the pack and fatigues,
 * brown gloves and boots, and a grey rifle carried out to the right so the
 * muzzle clears the rank in front.
 */
const SOLDIER_KEY = {
  k: '#05070a', // outline
  h: '#1c4520', // helmet shadow / rim
  H: '#2f7030', // helmet
  m: '#dcefe2', // unit flash
  M: '#a9c9b4', // unit flash shade
  s: '#e8c48c', // skin
  t: '#c9a066', // skin shadow
  C: '#5e9c4a', // fatigues, lit
  c: '#4a8038', // fatigues, mid
  d: '#37642a', // fatigues, shadow
  w: '#7cc063', // webbing highlight
  b: '#3d2814', // belt
  B: '#5c3d22', // boots / gloves
  G: '#98a3b4', // rifle, lit
  g: '#5b6472', // rifle, body
  P: '#2f5626', // trousers — deliberately darker than the tunic so the legs
  N: '#24421d', // read as legs and not as more torso
};

/**
 * Head, torso and rifle — identical across the march cycle.
 *
 * Palette slots, in order, are what the recolour maps below index into:
 * 1 k outline, 2 h helmet shadow, 3 H helmet, 4 m flash, 5 M flash shade,
 * 6 s skin, 7 t skin shadow, 8 C fatigues lit, 9 c fatigues mid,
 * 10 d fatigues shadow, 11 w webbing, 12 b belt, 13 B leather, 14 G rifle lit,
 * 15 g rifle body.
 */
const SOLDIER_TOP = [
  '......kkk......',
  '....kkHHHkk....',
  '...khHHHHHhk...',
  '...khHmmmHhk...',
  '...khHHHHHhk...',
  '....khhhhhk....',
  '.....kstsk.....',
  '...kkcCCCckk...',
  '..kdcCCCCCcdk..',
  '..kdcCwwwCcdk.G',
  '.kBdcCwwwCcdBGG',
  '.kBdcCCCCCcdBgG',
  '..kdcCCCCCcdk..',
  '..kkbbbbbbbkk..',
];

/**
 * Legs: a four-beat march. Narrow, wide-left, narrow, wide-right, so the whole
 * column reads as one cadence rather than a field of independent animations.
 */
const SOLDIER_LEGS: string[][] = [
  ['..kPPPPPPPk....', '...kPNk.kNPk...', '...kBBk.kBBk...', '...kkkk.kkkk...'],
  ['..kPPPPPPPk....', '..kPNk...kNPk..', '..kBBk...kBBk..', '..kkkk...kkkk..'],
  ['..kPPPPPPPk....', '...kPNk.kNPk...', '...kBBk.kBBk...', '...kkkk.kkkk...'],
  ['..kPPPPPPPk....', '....kPNk.kNPk..', '....kBBk.kBBk..', '....kkkk.kkkk..'],
];

function soldier(id: string, legs: number): SpriteDef {
  return defineSprite(id, [...SOLDIER_TOP, ...SOLDIER_LEGS[legs]], SOLDIER_KEY);
}

export const SPR_SOLDIER_A = soldier('sol_a', 0);
export const SPR_SOLDIER_B = soldier('sol_b', 1);
export const SPR_SOLDIER_C = soldier('sol_c', 2);
export const SPR_SOLDIER_D = soldier('sol_d', 3);

/** Firing pose: rifle up and braced, shoulders squared into the recoil. */
export const SPR_SOLDIER_FIRE = defineSprite(
  'sol_f',
  [
    '......kkk......',
    '....kkHHHkk....',
    '...khHHHHHhk...',
    '...khHmmmHhk..G',
    '...khHHHHHhk.GG',
    '....khhhhhk.GG.',
    '.....kstsk.Bk..',
    '...kkcCCCckg...',
    '..kdcCCCCCcdk..',
    '..kdcCwwwCcdk..',
    '.kBdcCwwwCcdk..',
    '.kBdcCCCCCcdk..',
    '..kdcCCCCCcdk..',
    '..kkbbbbbbbkk..',
    '..kPPPPPPPk....',
    '...kPNk.kNPk...',
    '...kBBk.kBBk...',
    '...kkkk.kkkk...',
  ],
  SOLDIER_KEY,
);

/** Crimson-and-gold line infantry for the desert campaign. */
const REDCOAT_MAP = {
  2: '#4a1220', 3: '#8e2440',
  8: '#e2564f', 9: '#c22b3f', 10: '#7c1226',
  11: '#ffd447', 13: '#4a2a16',
  16: '#7c1226', 17: '#5a0d1c',
};
export const SPR_REDCOAT_A = recolor(SPR_SOLDIER_A, 'red_a', REDCOAT_MAP);
export const SPR_REDCOAT_B = recolor(SPR_SOLDIER_B, 'red_b', REDCOAT_MAP);
export const SPR_REDCOAT_C = recolor(SPR_SOLDIER_C, 'red_c', REDCOAT_MAP);
export const SPR_REDCOAT_D = recolor(SPR_SOLDIER_D, 'red_d', REDCOAT_MAP);
export const SPR_REDCOAT_FIRE = recolor(SPR_SOLDIER_FIRE, 'red_f', REDCOAT_MAP);

/** Recruits picked up mid-run wear pale winter kit so they read as new. */
const ALLY_MAP = {
  2: '#2f4763', 3: '#6f9ec4',
  8: '#eef6ff', 9: '#c3d6e8', 10: '#8ba4bd',
  11: '#63d8ff', 13: '#4a5567',
  16: '#8ba4bd', 17: '#6d8398',
};
export const SPR_ALLY_A = recolor(SPR_SOLDIER_A, 'ally_a', ALLY_MAP);
export const SPR_ALLY_B = recolor(SPR_SOLDIER_B, 'ally_b', ALLY_MAP);
export const SPR_ALLY_C = recolor(SPR_SOLDIER_C, 'ally_c', ALLY_MAP);
export const SPR_ALLY_D = recolor(SPR_SOLDIER_D, 'ally_d', ALLY_MAP);
export const SPR_ALLY_FIRE = recolor(SPR_SOLDIER_FIRE, 'ally_f', ALLY_MAP);

// ---------------------------------------------------------------------------
// Enemies — seen from the front
// ---------------------------------------------------------------------------

const GRUNT_KEY = {
  k: '#2a0508',
  h: '#8a1218',
  H: '#ff8b70',
  R: '#ff6a52',
  r: '#e0332f',
  f: '#f7d8b0',
  e: '#2a0c0c',
  p: '#5c1220',
  o: '#2a0a0e',
  g: '#6b4a24',
  G: '#c2ccda',
};

const GRUNT_TOP = [
  '..khhhhk..',
  '.khHHHHhk.',
  '.khffffhk.',
  '.kfeffefk.',
  '..kfffk..G',
  '.kkRRRRkkG',
  'kRRrrrrRRg',
  'kRrrrrrrRg',
  '.krrrrrrkg',
  '.kRrrrrRkg',
  '..krrrrk..',
];

export const SPR_GRUNT_A = defineSprite(
  'gru_a',
  [...GRUNT_TOP, '..pp..pp..', '..pp..pp..', '..oo..oo..', '..kk..kk..'],
  GRUNT_KEY,
);

export const SPR_GRUNT_B = defineSprite(
  'gru_b',
  [...GRUNT_TOP, '...pppp...', '..pp..pp..', '.oo....oo.', '.kk....kk.'],
  GRUNT_KEY,
);

/** Heavier front-line enemy with a slab shield. */
export const SPR_SHIELDER = defineSprite(
  'shld',
  [
    '...kkkkk....',
    '..kRRRRRk...',
    '..kRffffk...',
    '..kRefeRk...',
    '.kRRRRRRRk..',
    'AAAArrrrrRk.',
    'AAAArrrrrRk.',
    'AAAArrrrrk..',
    'AAAArrrrrk..',
    'AAAA.rrrk...',
    'AAAA.pp.pp..',
    '.kk..pp.pp..',
    '.....oo.oo..',
    '.....oo.oo..',
    '.....kk.kk..',
  ],
  { ...GRUNT_KEY, A: '#8d96a8', a: '#4a5468' },
);

/** Heavy elite: same silhouette, bruised iron palette. */
export const SPR_BRUTE = recolor(SPR_SHIELDER, 'brute', {
  1: '#1c0a14',
  2: '#5a2038',
  3: '#8a2f4a',
  4: '#3a1424',
  5: '#c46b8a',
  6: '#7a1a30',
  7: '#f7d8b0',
  10: '#c8a44a',
  11: '#6b5220',
});

/** Ranged enemy that lobs shots back down the lane. */
export const SPR_SHOOTER = defineSprite(
  'shtr',
  [
    '...kkkk...',
    '..kMMMMk..',
    '..kMffMk..',
    '..kMefeMk.',
    '.kMMMMMMk.',
    'kMmmmmmmMk',
    'kMmmmmmmMk',
    'GGGGmmmmk.',
    '.g..mmmmk.',
    '..kmmmmk..',
    '..pp..pp..',
    '..pp..pp..',
    '..oo..oo..',
    '..oo..oo..',
    '..kk..kk..',
  ],
  {
    k: '#2a0a2a',
    M: '#c46bff',
    m: '#7a2fb8',
    f: '#f7d8b0',
    e: '#2a0c0c',
    p: '#3d1050',
    o: '#1c0620',
    G: '#8d96a8',
    g: '#3a3f4d',
  },
);

/** Fast, weak swarm enemy. */
export const SPR_RUNNER = defineSprite(
  'runr',
  [
    '..kkkk..',
    '.kYYYYk.',
    '.kfffhk.',
    '.kefekk.',
    'kYYYYYYk',
    'kyyyyyyk',
    'kyyyyyyk',
    '.kyyyyk.',
    '.kp..pk.',
    '.ko..ok.',
    '.kk..kk.',
  ],
  {
    k: '#3b2a06', Y: '#ffd447', y: '#e09a12', f: '#f7d8b0',
    e: '#2a0c0c', h: '#a86a08', p: '#6b4a08', o: '#2a1c04',
  },
);

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

const OGRE_KEY = {
  k: '#5c1d05',
  o: '#ff8b2b',
  O: '#ffc25e',
  d: '#a8410c',
  t: '#f3e4c0',
  e: '#fff27a',
  m: '#ff5fd2',
  M: '#ffb0ea',
  a: '#3a2340',
  A: '#7a5a8c',
};

export const SPR_BOSS_OGRE = defineSprite(
  'boss_ogre',
  [
    '.....tt...........tt........',
    '....kttk.........kttk.......',
    '.....ktk..........ktk.......',
    '......kkooooooooookk........',
    '.......koOOOOOOOOok.........',
    '.......koeOOOOOOeok.........',
    '.......kodOOOOOOdok.........',
    '........koddttddok..........',
    '.....kkkkooooooookkkk.......',
    '...kkoooooooooooooooookk....',
    '..kooOOOoooooooooooOOOookk..',
    '.kooOOOOooooooooooooOOOOook.',
    'kooooooo.aaaaaaaaa.ooooooook',
    'koooooo.aAAAAAAAAAa.oooooook',
    'koooooo.aAAmmmmmAAa.oooooook',
    'koooooo.aAAmMMMmAAa.oooooook',
    'koooooo.aAAAAAAAAAa.oooooook',
    'kooooooo.aAAAAAAAa.ooooooook',
    'kdoooooo..aaaaaaa..ooooooodk',
    '.kdoooooooooooooooooooooodk.',
    '.kmmmk.ddddddddddddd.kmmmk..',
    '.kMMMk.doooooooooood.kMMMk..',
    '.kmmmk.doooooooooood.kmmmk..',
    '..kkk..dmmmmmmmmmmmd..kkk...',
    '.......dMMMMMMMMMMMd........',
    '.......dmmmmmmmmmmmd........',
    '......kdooooooooooodk.......',
    '.....koooook...koooook......',
    '.....kooo0Ok...kOooook......',
    '.....kooooOk...kOooook......',
    '....kkoooookk.kkoooookk.....',
    '....kkkkkkkkk.kkkkkkkkk.....',
  ],
  { ...OGRE_KEY, '0': '#ffc25e' },
);

const MECH_KEY = {
  k: '#0c1018',
  s: '#4a5468',
  S: '#8d96a8',
  D: '#2c3444',
  e: '#ff3b2f',
  E: '#ffd447',
  r: '#7a4630',
  y: '#ffb02b',
};

export const SPR_BOSS_MECH = defineSprite(
  'boss_mech',
  [
    '.........kkkkkkkkkk.........',
    '........kSSSSSSSSSSk........',
    '.......kSSDDDDDDDDSSk.......',
    '.......kSDeeeDDeeeDSk.......',
    '.......kSDDDDDDDDDDSk.......',
    '........kSSSSSSSSSSk........',
    '......kkkSSSSSSSSSSkkk......',
    '....kkSSSSSSSSSSSSSSSSkk....',
    '..kkSSSSSSSSSSSSSSSSSSSSkk..',
    '.kSSSSSSkkkkkkkkkkkkSSSSSSk.',
    'kSSSSSSkDDDDDDDDDDDDkSSSSSSk',
    'kSSSSSkDDEEEEEEEEEEDDkSSSSSk',
    'kSSSSSkDDEyyyyyyyyEDDkSSSSSk',
    'kSSSSSkDDEEEEEEEEEEDDkSSSSSk',
    'kSSSSSSkDDDDDDDDDDDDkSSSSSSk',
    'kSSSSSSSkkkkkkkkkkkkSSSSSSSk',
    'kSSSSSSSSSSSSSSSSSSSSSSSSSSk',
    '.kSSSSSSSSSSSSSSSSSSSSSSSSk.',
    '..kkSSSSSSSSSSSSSSSSSSSSkk..',
    '....kkrrrSSSSSSSSSSrrrkk....',
    '......kkrrDDDDDDDDrrkk......',
    '........kDDDDDDDDDDk........',
    '.......kDDsssssssDDk........',
    '.......kDDsSSSSSsDDk........',
    '.......kDDsssssssDDk........',
    '......kkDDDDDDDDDDDkk.......',
    '.....kSSSSSk...kSSSSSk......',
    '.....kSssSSk...kSSssSk......',
    '.....kSssSSk...kSSssSk......',
    '....kkSSSSSkk.kkSSSSSkk.....',
    '....kkkkkkkkk.kkkkkkkkk.....',
  ],
  MECH_KEY,
);

// ---------------------------------------------------------------------------
// Obstacles and props
// ---------------------------------------------------------------------------

export const SPR_CRATE = defineSprite(
  'crate',
  [
    'kkkkkkkk',
    'kWwwwwwk',
    'kwWwwwWk',
    'kwwWwWwk',
    'kwwwWwwk',
    'kwwWwWwk',
    'kwWwwwWk',
    'kkkkkkkk',
  ],
  { k: '#4a2c0c', w: '#a9702f', W: '#d09a4e' },
);

export const SPR_PLANK = defineSprite(
  'plank',
  ['kkkkkkkkkkkk', 'kWWwwwwwwWWk', 'kwwwwwwwwwwk', 'kWwwwwwwwwWk', 'kkkkkkkkkkkk'],
  { k: '#4a2c0c', w: '#a9702f', W: '#d09a4e' },
);

export const SPR_BARREL = defineSprite(
  'barrel',
  [
    '.kkkkkk.',
    'kRRRRRRk',
    'kRrrrrRk',
    'kkkkkkkk',
    'kRrrrrRk',
    'kRrrrrRk',
    'kkkkkkkk',
    'kRrrrrRk',
    'kRrrrrRk',
    'kRRRRRRk',
    '.kkkkkk.',
  ],
  { k: '#2a1408', R: '#c94b1e', r: '#8a2c0c' },
);

export const SPR_SANDBAG = defineSprite(
  'sandbag',
  ['.kkkkkkkk.', 'kSSssSSssk', 'kssSSssSSk', '.kkkkkkkk.', 'kSSssSSssk', 'kssSSssSSk', '.kkkkkkkk.'],
  { k: '#5a4a24', S: '#e4c48a', s: '#b99a5e' },
);

export const SPR_RAIL_POST = defineSprite(
  'railpost',
  ['kSSk', 'kSSk', 'kSSk', 'kSSk', 'kSSk', 'kSSk', 'kSSk', 'kSSk', 'kkkk'],
  { k: '#1d232e', S: '#8d96a8' },
);

export const SPR_FENCE = defineSprite(
  'fence',
  ['kkkkkkkkkk', 'kSSSSSSSSk', 'k.s....s.k', 'k.s....s.k', 'kSSSSSSSSk', 'k.s....s.k', 'k.s....s.k', 'kkkkkkkkkk'],
  { k: '#1d232e', S: '#6d7a91', s: '#3f4a5c' },
);

export const SPR_GRATE = defineSprite(
  'grate',
  [
    'kkkkkkkkkkkk',
    'kDDkDDkDDkDk',
    'kkkkkkkkkkkk',
    'kDDkDDkDDkDk',
    'kkkkkkkkkkkk',
    'kDDkDDkDDkDk',
    'kkkkkkkkkkkk',
    'kDDkDDkDDkDk',
    'kkkkkkkkkkkk',
  ],
  { k: '#3b3026', D: '#171a14' },
);

export const SPR_PALM = defineSprite(
  'palm',
  [
    '..gg..gg..',
    '.gGGggGGg.',
    'gGG.gg.GGg',
    '...gtttg..',
    '....ttt...',
    '....ttt...',
    '....ttt...',
    '...tttt...',
    '..ssssss..',
  ],
  { g: '#22662f', G: '#3f9f4a', t: '#6c4116', s: '#e4c48a' },
);

export const SPR_ROCK = defineSprite(
  'rock',
  ['..kkkk..', '.kSSSSk.', 'kSSssSSk', 'kSssssSk', 'kSssssSk', '.kSssSk.', '..kkkk..'],
  { k: '#2c3444', S: '#6d7a91', s: '#4a5468' },
);

export const SPR_GANTRY = defineSprite(
  'gantry',
  [
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kSSSSSSSSSSSSSSSSSSSSSSk',
    'kSDDDDDDDDDDDDDDDDDDDDSk',
    'kSSSSSSSSSSSSSSSSSSSSSSk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    '..kSSk............kSSk..',
    '..kSSk............kSSk..',
    '..kSSk............kSSk..',
    '..kSSk............kSSk..',
    '..kSSk............kSSk..',
    '..kSSk............kSSk..',
    '..kSSk............kSSk..',
    '..kkkk............kkkk..',
  ],
  { k: '#1d232e', S: '#6d7a91', D: '#3f4a5c' },
);

export const SPR_CHEST = defineSprite(
  'chest',
  [
    '.kkkkkkkkkk.',
    'kYYYYYYYYYYk',
    'kYwwwwwwwwYk',
    'kYYYYYYYYYYk',
    'kkkkkkkkkkkk',
    'kwwwwYYwwwwk',
    'kwwwwYYwwwwk',
    'kwwwwYYwwwwk',
    'kkkkkkkkkkkk',
  ],
  { k: '#3a2408', Y: '#ffd447', w: '#a9702f' },
);

export const SPR_TURRET = defineSprite(
  'turret',
  [
    '....kkkk....',
    '...kSSSSk...',
    '..kSDDDDSk..',
    '..kSDeeDSk..',
    '..kSDDDDSk..',
    '.kSSSSSSSSk.',
    'kSSSSSSSSSSk',
    'kSDDDDDDDDSk',
    'kSSSSSSSSSSk',
    '.kkkkkkkkkk.',
  ],
  { k: '#151a24', S: '#6d7a91', D: '#3f4a5c', e: '#ff3b2f' },
);

export const SPR_SPIKES = defineSprite(
  'spikes',
  ['.k..k..k..k.', 'kSk.kSk.kSk.', 'kSk.kSk.kSk.', 'kkkkkkkkkkkk', 'kDDDDDDDDDDk', 'kkkkkkkkkkkk'],
  { k: '#20242c', S: '#b9c2d0', D: '#4a5468' },
);

export const SPR_FLAG = defineSprite(
  'flag',
  [
    'kFFFFFFk',
    'kFffffFk',
    'kFffffFk',
    'kFFFFFFk',
    'k.......',
    'k.......',
    'k.......',
    'k.......',
    'k.......',
    'k.......',
  ],
  { k: '#2a2a2a', F: '#ffd447', f: '#c22b3f' },
);

// ---------------------------------------------------------------------------
// Icons — used on gates, boards and the HUD
// ---------------------------------------------------------------------------

export const ICON_RIFLE = defineSprite(
  'ic_rifle',
  [
    '............gg..',
    '.kkkkkkkkkkkGGk.',
    'kSSSSSSSSSSSGGk.',
    'kSDDDDDDDDDDDkk.',
    '.kkkkSSkkkkkk...',
    '....kSSk........',
    '....kSSk........',
    '.....kk.........',
  ],
  { k: '#12151c', S: '#8d96a8', D: '#3f4a5c', g: '#ffd447', G: '#c58a15' },
  { ax: 8, ay: 8 },
);

export const ICON_SOLDIER = defineSprite(
  'ic_sol',
  [
    '...kkkk...',
    '..kWWWWk..',
    '..kWWWWk..',
    '.kWWWWWWk.',
    'kWWWWWWWWk',
    'kWWWWWWWWk',
    'kWWWWWWWWk',
    '.kWWWWWWk.',
    '..kWW.WWk.',
    '..kWk.kWk.',
    '..kWk.kWk.',
    '..kkk.kkk.',
  ],
  { k: '#12151c', W: '#eef2f7' },
  { ax: 5, ay: 12 },
);

export const ICON_SHIELD = defineSprite(
  'ic_shield',
  [
    'kkkkkkkkkk',
    'kBBBBBBBBk',
    'kBbbbbbbBk',
    'kBbBBBBbBk',
    'kBbBBBBbBk',
    'kBbbbbbbBk',
    '.kBBBBBBk.',
    '..kBBBBk..',
    '...kBBk...',
    '....kk....',
  ],
  { k: '#0d1a2e', B: '#63a6ff', b: '#2f6ddb' },
  { ax: 5, ay: 10 },
);

export const ICON_COIN = defineSprite(
  'ic_coin',
  ['..kkkk..', '.kYYYYk.', 'kYYddYYk', 'kYdYYdYk', 'kYdYYdYk', 'kYYddYYk', '.kYYYYk.', '..kkkk..'],
  { k: '#6b4a08', Y: '#ffd447', d: '#c58a15' },
  { ax: 4, ay: 8 },
);

export const ICON_SKULL = defineSprite(
  'ic_skull',
  ['.kkkkkk.', 'kWWWWWWk', 'kWkkWkWk', 'kWkkWkWk', 'kWWWWWWk', '.kWkWkk.', '.kWWWWk.', '..kkkk..'],
  { k: '#12151c', W: '#e8e2d0' },
  { ax: 4, ay: 8 },
);

export const ICON_BOLT = defineSprite(
  'ic_bolt',
  ['...kk.', '..kYk.', '.kYYk.', 'kYYkk.', 'kkYYk.', '..kYk.', '..kYk.', '...kk.'],
  { k: '#6b4a08', Y: '#ffd447' },
  { ax: 3, ay: 8 },
);

export const ICON_HEART = defineSprite(
  'ic_heart',
  ['.kk.kk.', 'kRRkRRk', 'kRRRRRk', 'kRRRRRk', '.kRRRk.', '..kRk..', '...k...'],
  { k: '#5a0d18', R: '#e0332f' },
  { ax: 3.5, ay: 7 },
);

export const ICON_STAR = defineSprite(
  'ic_star',
  ['...k...', '..kYk..', '.kYYYk.', 'kYYYYYk', '.kYYYk.', '.kY.Yk.', '.k...k.'],
  { k: '#6b4a08', Y: '#ffd447' },
  { ax: 3.5, ay: 7 },
);

export const ICON_MAGNET = defineSprite(
  'ic_magnet',
  ['kkk..kkk', 'kRRk.kRRk', 'kRRk.kRRk', 'kRRkkkRRk', 'kRRRRRRRk', '.kkkkkkk.'],
  { k: '#2a2a2a', R: '#e0332f' },
  { ax: 4, ay: 6 },
);

export const ICON_BOOT = defineSprite(
  'ic_boot',
  ['kk......', 'kBk.....', 'kBk.....', 'kBk.....', 'kBBkkkk.', 'kBBBBBBk', 'kkkkkkkk'],
  { k: '#20140a', B: '#a9702f' },
  { ax: 4, ay: 7 },
);

export const ICON_TARGET = defineSprite(
  'ic_target',
  ['..kkkk..', '.kRRRRk.', 'kRWWWWRk', 'kRWkkWRk', 'kRWkkWRk', 'kRWWWWRk', '.kRRRRk.', '..kkkk..'],
  { k: '#2a0a0a', R: '#e0332f', W: '#fdfdf6' },
  { ax: 4, ay: 8 },
);

// ---------------------------------------------------------------------------
// Background dressing
// ---------------------------------------------------------------------------

export const SPR_CLOUD = defineSprite(
  'cloud',
  ['....wwww....', '..wwWWWWww..', '.wWWWWWWWWw.', 'wWWWWWWWWWWw', '.wwwwwwwwww.'],
  { w: '#c9dcf0', W: '#f2f8ff' },
  { ax: 6, ay: 5 },
);

export const SPR_BIRD = defineSprite('bird', ['k...k', '.k.k.', '..k..'], { k: '#1d232e' }, { ax: 2.5, ay: 3 });

export const SPR_SHIP = defineSprite(
  'ship',
  ['...k....', '...k....', '..kkk...', '.kSSSk..', 'kSSSSSk.', '.kkkkk..'],
  { k: '#1d232e', S: '#8d96a8' },
  { ax: 4, ay: 6 },
);

export const SPR_TOWER = defineSprite(
  'tower',
  [
    '..kk..',
    '.kSSk.',
    '.kSSk.',
    'kSSSSk',
    'kSDDSk',
    'kSSSSk',
    'kSDDSk',
    'kSSSSk',
    'kSDDSk',
    'kSSSSk',
    'kkkkkk',
  ],
  { k: '#1d232e', S: '#4a5468', D: '#2c3444' },
  { ax: 3, ay: 11 },
);

export const SPR_PINE = defineSprite(
  'pine',
  ['..gg..', '.gGGg.', '.gGGg.', 'gGGGGg', 'gGGGGg', '..tt..', '..tt..'],
  { g: '#1c4a2a', G: '#2f7a42', t: '#4a2c0c' },
  { ax: 3, ay: 7 },
);

export const SPR_CACTUS = defineSprite(
  'cactus',
  ['..gg..', 'g.gg..', 'gGgg.g', 'gGggGg', '.Ggggg', '..gg..', '..gg..', '..gg..'],
  { g: '#2f7a42', G: '#4fae5e' },
  { ax: 3, ay: 8 },
);

export const SPR_CRYSTAL = defineSprite(
  'crystal',
  ['..I..', '.IiI.', 'IiiiI', 'IiiiI', '.IiI.', '.IiI.', '..k..'],
  { I: '#bfe9ff', i: '#5f9fc4', k: '#2c3444' },
  { ax: 2.5, ay: 7 },
);

/** All sprites, keyed by id — the debug gallery walks this. */
export const ART_INDEX: Record<string, SpriteDef> = {
  SPR_SOLDIER_A,
  SPR_SOLDIER_B,
  SPR_SOLDIER_C,
  SPR_SOLDIER_D,
  SPR_SOLDIER_FIRE,
  SPR_REDCOAT_A,
  SPR_REDCOAT_C,
  SPR_ALLY_A,
  SPR_ALLY_C,
  SPR_GRUNT_A,
  SPR_GRUNT_B,
  SPR_SHIELDER,
  SPR_BRUTE,
  SPR_SHOOTER,
  SPR_RUNNER,
  SPR_BOSS_OGRE,
  SPR_BOSS_MECH,
  SPR_CRATE,
  SPR_PLANK,
  SPR_BARREL,
  SPR_SANDBAG,
  SPR_RAIL_POST,
  SPR_FENCE,
  SPR_GRATE,
  SPR_PALM,
  SPR_ROCK,
  SPR_GANTRY,
  SPR_CHEST,
  SPR_TURRET,
  SPR_SPIKES,
  SPR_FLAG,
  ICON_RIFLE,
  ICON_SOLDIER,
  ICON_SHIELD,
  ICON_COIN,
  ICON_SKULL,
  ICON_BOLT,
  ICON_HEART,
  ICON_STAR,
  ICON_MAGNET,
  ICON_BOOT,
  ICON_TARGET,
  SPR_CLOUD,
  SPR_BIRD,
  SPR_SHIP,
  SPR_TOWER,
  SPR_PINE,
  SPR_CACTUS,
  SPR_CRYSTAL,
};

/** Referenced so the palette import is not dead weight in tree-shaken builds. */
export const ART_ACCENT = PAL.gold;
