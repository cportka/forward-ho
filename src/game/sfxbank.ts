/**
 * Sound effects from the `8bit-sfx` catalogue.
 *
 * The package synthesises 8888 chip effects on demand from their names, so
 * nothing is downloaded and nothing is bundled as audio. We render the ~31
 * effects the game actually uses into AudioBuffers once, then play them
 * through the existing voice pool so mute, master volume, panning, the voice
 * cap and the per-effect repeat guard all still apply.
 *
 * Two deliberate choices:
 *
 * - The package is loaded with a dynamic import, off the first user gesture.
 *   It is a large module and the game is playable before a single sound is
 *   needed, so it must never sit in the critical path.
 * - Every effect is peak-normalised to a per-event target on the way in.
 *   The catalogue spans a wide loudness range and a gunshot that fires ten
 *   times a second has to sit far below a boss roar; normalising at bake time
 *   means the mix is a property of the table below rather than of whichever
 *   effect happened to be picked.
 */

import type { SfxName } from './audio';

/** Catalogue effect chosen for each game event. */
export const SFX_SOURCE: Record<SfxName, string> = {
  // Weapons — short, dry, and cheap to retrigger.
  shoot: 'hit_057', // noise-forward impact, 177 Hz thud under the burst
  shootHeavy: 'hit_015', // same shape, wider body
  laser: 'laser_095', // clean falling zap, 1686 → 178 Hz
  shotgun: 'hit_128', // tone-forward impact, heavier thud
  rocket: 'explosion_104', // noise boom with sub-rumble

  // Combat feedback.
  hit: 'hit_101',
  enemyDie: 'voice_175', // throaty grunt, 110 Hz pitch-drop
  crowdDie: 'voice_032', // weary sigh — your own troops going down

  // Gates.
  gate: 'powerup_125', // major-triad climb, 4 notes
  gateBad: 'ui_085', // error buzz, double burst
  gateBig: 'powerup_018', // 6-note reedy major climb

  // Lane furniture.
  boardHit: 'ui_131', // metallic snap with a thock
  boardBreak: 'impact_112', // bright steel slam with a wide clang
  crateHit: 'footstep_042', // wood-plank knock with a ringing overtone
  crateBreak: 'mech_196', // deep thud into a crunch

  // Rewards.
  recruit: 'voice_028', // chip "hey!" shout — the new troops calling in
  weaponUp: 'rpg_levelup', // four-note rising fanfare with a sparkle tail
  shield: 'rpg_004', // ice spell, 7 glassy shards
  coin: 'coin_048', // two-note pickup blip

  // Boss.
  bossRoar: 'monster_071', // deep chest roar, 55 Hz under a 32 Hz growl
  bossHit: 'impact_063', // steel crack with a tight clang
  bossDie: 'explosion_146', // long-fade boom, 40% sub-rumble
  stomp: 'monster_011', // heavy footfall with gravelly debris

  // World & UI.
  explosion: 'explosion_178',
  uiClick: 'ui_138', // hollow mouse click
  uiBack: 'ui_193', // reedy mouse click
  countUp: 'ui_043', // gritty keyboard tick
  lose: 'rpg_collapse', // long sawtooth fall, 440 → 52 Hz
  win: 'jingle_068', // 6-note zigzag stinger resolving up
  levelStart: 'jingle_098', // 4-note stinger
  warning: 'alarm_009', // frantic two-tone siren

  // The little indications: boots on the road, brass hitting the deck.
  march: 'footstep_180', // gravel-crunch step, light thud
  shell: 'mech_007', // toggle click — a spent casing tinking away
};

/**
 * Peak amplitude each effect is normalised to. This is the game's mix: things
 * that fire constantly sit low, one-shot events sit high.
 */
const TARGET_PEAK: Record<SfxName, number> = {
  shoot: 0.42,
  shootHeavy: 0.5,
  laser: 0.44,
  shotgun: 0.55,
  rocket: 0.6,
  hit: 0.4,
  enemyDie: 0.36,
  crowdDie: 0.6,
  gate: 0.65,
  gateBad: 0.7,
  gateBig: 0.8,
  boardHit: 0.3,
  boardBreak: 0.75,
  crateHit: 0.34,
  crateBreak: 0.6,
  recruit: 0.7,
  weaponUp: 0.85,
  shield: 0.7,
  coin: 0.5,
  bossRoar: 0.95,
  bossHit: 0.34,
  bossDie: 1,
  stomp: 0.8,
  explosion: 0.85,
  uiClick: 0.45,
  uiBack: 0.45,
  countUp: 0.4,
  lose: 0.85,
  win: 0.9,
  levelStart: 0.8,
  warning: 0.7,
  march: 0.22,
  shell: 0.14,
};

/** Baked first, because these are the first sounds a player ever hears. */
const PRIORITY: SfxName[] = [
  'uiClick', 'uiBack', 'levelStart', 'shoot', 'enemyDie', 'gate', 'coin', 'crowdDie',
];

const bank = new Map<SfxName, AudioBuffer>();
let started = false;
let failed = false;

export function sfxBuffer(name: SfxName): AudioBuffer | null {
  return bank.get(name) ?? null;
}

export interface BankStatus {
  loaded: number;
  total: number;
  failed: boolean;
}

export function sfxBankStatus(): BankStatus {
  return { loaded: bank.size, total: Object.keys(SFX_SOURCE).length, failed };
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: object) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => resolve(), { timeout: 120 });
    else setTimeout(resolve, 0);
  });
}

/**
 * Renders the bank in the background. Safe to call repeatedly; the first call
 * wins. Until a buffer lands, `audio.ts` falls back to its own synthesis, so
 * the game is never silent while this runs.
 */
export function primeSfxBank(ctx: BaseAudioContext): void {
  if (started) return;
  started = true;

  void (async () => {
    let render: ((name: string) => Float32Array) | null = null;
    try {
      const mod = await import('8bit-sfx');
      if (typeof mod.render === 'function') render = mod.render;
    } catch {
      failed = true;
      return;
    }
    if (!render) {
      failed = true;
      return;
    }

    const all = Object.keys(SFX_SOURCE) as SfxName[];
    const order = [...PRIORITY, ...all.filter((n) => !PRIORITY.includes(n))];

    for (const name of order) {
      if (bank.has(name)) continue;
      try {
        const samples = render(SFX_SOURCE[name]);
        if (!samples || samples.length === 0) continue;

        let peak = 0;
        for (let i = 0; i < samples.length; i++) {
          const a = samples[i] < 0 ? -samples[i] : samples[i];
          if (a > peak) peak = a;
        }
        const gain = peak > 1e-4 ? (TARGET_PEAK[name] ?? 0.6) / peak : 1;

        const buf = ctx.createBuffer(1, samples.length, 22050);
        const out = buf.getChannelData(0);
        for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
        bank.set(name, buf);
      } catch {
        // A single effect failing is not fatal — that event keeps its
        // synthesised fallback.
      }
      await idle();
    }
  })();
}
