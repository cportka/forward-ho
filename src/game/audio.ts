/**
 * audio.ts — fully procedural WebAudio engine. No audio assets: every sound and
 * every note of music is synthesised at runtime from oscillators, one shared
 * white-noise buffer, biquad filters and scheduled gain envelopes.
 *
 * Design
 * ------
 * - Lazy context: the AudioContext is only constructed inside init()/unlock(),
 *   never at module scope (autoplay policy + SSR safety). If the browser has no
 *   AudioContext, `ready` stays false and every method degrades to a no-op.
 * - Graph: sources -> voice gain -> (StereoPanner | passthrough) -> bus
 *          sfxBus ─┐
 *          musicBus┴-> masterGain -> DynamicsCompressor (soft limiter) -> destination
 *   Music has two parallel slot gains (A/B) hanging off musicBus so that
 *   switching tracks can crossfade: the outgoing track keeps playing its
 *   already-scheduled tail into the fading slot while the new one ramps up.
 * - Voices: pooled records holding the reusable per-voice gain + panner. Active
 *   voices are pruned in update() by in-place compaction (no allocation). Sfx
 *   voices are capped (MAX_SFX_VOICES) and the oldest is stolen when over
 *   budget; the whole engine is capped again by MAX_VOICES.
 * - Repeat guard: each SfxName has a minimum retrigger gap (shoot coalesces to
 *   ~28/s) and a pitch-jitter amount so machine-gun fire never phase-cancels.
 * - Music: a lookahead scheduler. update(dt) walks a 16th-note cursor and emits
 *   every note that falls inside the next ~0.1s window, timed against
 *   ctx.currentTime. No setTimeout, no per-note timers, so the groove stays
 *   sample-accurate even when frames hitch.
 */

import { clamp, lerp } from '../core/math';
import { fx } from '../core/rng';

export type SfxName =
  | 'shoot' | 'shootHeavy' | 'laser' | 'shotgun' | 'rocket'
  | 'hit' | 'enemyDie' | 'crowdDie'
  | 'gate' | 'gateBad' | 'gateBig'
  | 'boardHit' | 'boardBreak' | 'crateHit' | 'crateBreak'
  | 'recruit' | 'weaponUp' | 'shield' | 'coin'
  | 'bossRoar' | 'bossHit' | 'bossDie' | 'stomp'
  | 'explosion' | 'uiClick' | 'uiBack' | 'countUp'
  | 'lose' | 'win' | 'levelStart' | 'warning';

export type MusicTrack = 'none' | 'menu' | 'run' | 'boss' | 'victory';

export interface AudioOptions {
  vol?: number;
  rate?: number;
  pan?: number;
}

export interface AudioEngine {
  readonly ready: boolean;
  readonly muted: boolean;
  init(): void;
  unlock(): void;
  setMuted(m: boolean): void;
  toggleMuted(): boolean;
  setMasterVolume(v: number): void;
  setMusic(track: MusicTrack): void;
  sfx(name: SfxName, opts?: AudioOptions): void;
  update(dt: number): void;
  suspend(): void;
  resume(): void;
}

// ---------------------------------------------------------------------------
// tuning constants
// ---------------------------------------------------------------------------

const MAX_VOICES = 48;
const MAX_SFX_VOICES = 24;
const NOISE_SECONDS = 2;
const SFX_BUS_GAIN = 0.85;
const MUSIC_BUS_GAIN = 0.5;
const XFADE = 0.55;
const BASE_LOOKAHEAD = 0.1;
const MIN_GAP_DEFAULT = 0.018;

/** Per-sfx minimum retrigger interval in seconds. */
const MIN_GAP: Partial<Record<SfxName, number>> = {
  shoot: 1 / 28,
  shootHeavy: 1 / 14,
  laser: 1 / 22,
  shotgun: 1 / 9,
  rocket: 1 / 7,
  hit: 1 / 26,
  enemyDie: 1 / 16,
  crowdDie: 1 / 8,
  boardHit: 1 / 18,
  crateHit: 1 / 18,
  coin: 1 / 20,
  countUp: 1 / 30,
  stomp: 1 / 8,
  explosion: 1 / 7,
  bossHit: 1 / 12,
  bossRoar: 0.6,
  bossDie: 1.5,
  win: 1.0,
  lose: 1.0,
  levelStart: 0.5,
  warning: 0.4,
};

/** Per-sfx random pitch jitter (fraction of playback rate). */
const JITTER: Partial<Record<SfxName, number>> = {
  shoot: 0.075,
  shootHeavy: 0.05,
  laser: 0.05,
  shotgun: 0.05,
  hit: 0.09,
  enemyDie: 0.07,
  crowdDie: 0.05,
  boardHit: 0.08,
  crateHit: 0.08,
  bossHit: 0.05,
  stomp: 0.05,
  explosion: 0.06,
  coin: 0.02,
  countUp: 0.04,
  uiClick: 0.01,
  uiBack: 0.01,
};

/** Nominal length of each sfx at rate 1. Also drives the voice lifetime. */
const SFX_DUR: Record<SfxName, number> = {
  shoot: 0.13,
  shootHeavy: 0.26,
  laser: 0.3,
  shotgun: 0.4,
  rocket: 0.6,
  hit: 0.1,
  enemyDie: 0.36,
  crowdDie: 0.6,
  gate: 0.5,
  gateBad: 0.45,
  gateBig: 0.8,
  boardHit: 0.12,
  boardBreak: 0.5,
  crateHit: 0.14,
  crateBreak: 0.55,
  recruit: 0.32,
  weaponUp: 0.6,
  shield: 0.55,
  coin: 0.4,
  bossRoar: 1.4,
  bossHit: 0.24,
  bossDie: 1.9,
  stomp: 0.42,
  explosion: 0.85,
  uiClick: 0.07,
  uiBack: 0.1,
  countUp: 0.06,
  lose: 1.3,
  win: 1.2,
  levelStart: 0.75,
  warning: 0.75,
};

// ---------------------------------------------------------------------------
// engine state
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxBus: GainNode | null = null;
let slotA: GainNode | null = null;
let slotB: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let hasPanner = false;
let readyFlag = false;
let initFailed = false;
let mutedFlag = false;
let masterVol = 0.85;
let blipDone = false;

const lastPlay = new Map<string, number>();

interface Voice {
  out: GainNode;
  pan: StereoPannerNode | null;
  tail: AudioNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  endsAt: number;
  isSfx: boolean;
}

const voices: Voice[] = [];
const pool: Voice[] = [];

function noop(): void {
  /* swallow rejected promises from suspend/resume */
}

/**
 * clamp() propagates NaN (NaN < lo and NaN > hi are both false), and a NaN
 * reaching an AudioParam either throws or silences that node for good. Every
 * caller-supplied number is funnelled through here first.
 */
function num(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

type CtxCtor = new () => AudioContext;

function findCtor(): CtxCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: CtxCtor;
    webkitAudioContext?: CtxCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function buildNoise(c: AudioContext): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * NOISE_SECONDS));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  // Slightly low-passed white noise: less fizzy than raw, still broadband.
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const w = fx.sym(1);
    prev = prev * 0.16 + w * 0.84;
    data[i] = prev;
  }
  return buf;
}

function init(): void {
  if (ctx || initFailed) return;
  const Ctor = findCtor();
  if (!Ctor) {
    initFailed = true;
    return;
  }
  let c: AudioContext;
  try {
    c = new Ctor();
  } catch {
    initFailed = true;
    return;
  }

  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 22;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(c.destination);

  const master = c.createGain();
  master.gain.value = mutedFlag ? 0 : masterVol;
  master.connect(comp);

  const sfxb = c.createGain();
  sfxb.gain.value = SFX_BUS_GAIN;
  sfxb.connect(master);

  const musicBus = c.createGain();
  musicBus.gain.value = MUSIC_BUS_GAIN;
  musicBus.connect(master);

  const a = c.createGain();
  a.gain.value = 0;
  a.connect(musicBus);
  const b = c.createGain();
  b.gain.value = 0;
  b.connect(musicBus);

  hasPanner =
    typeof (c as unknown as { createStereoPanner?: unknown }).createStereoPanner === 'function';

  ctx = c;
  masterGain = master;
  sfxBus = sfxb;
  slotA = a;
  slotB = b;
  noiseBuf = buildNoise(c);
  readyFlag = true;

  if (curTrack !== 'none') startTrack(curTrack, true);
}

function applyMasterGain(): void {
  if (!ctx || !masterGain) return;
  const t = ctx.currentTime;
  const target = mutedFlag ? 0 : masterVol;
  masterGain.gain.cancelScheduledValues(t);
  masterGain.gain.setValueAtTime(masterGain.gain.value, t);
  masterGain.gain.linearRampToValueAtTime(target, t + 0.04);
}

function isReady(): boolean {
  return readyFlag && ctx !== null && ctx.state !== 'closed';
}

// ---------------------------------------------------------------------------
// voice pool
// ---------------------------------------------------------------------------

function release(v: Voice): void {
  for (let i = 0; i < v.srcs.length; i++) {
    const s = v.srcs[i];
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
    s.disconnect();
  }
  for (let i = 0; i < v.nodes.length; i++) v.nodes[i].disconnect();
  v.srcs.length = 0;
  v.nodes.length = 0;
  v.tail.disconnect();
  v.isSfx = false;
  v.endsAt = 0;
  pool.push(v);
}

function removeAt(i: number): void {
  for (let j = i; j < voices.length - 1; j++) voices[j] = voices[j + 1];
  voices.length = voices.length - 1;
}

/** Steal the voice that finishes soonest (least audible loss), optionally sfx-only. */
function stealOldest(sfxOnly: boolean): void {
  let best = -1;
  let bestEnd = Infinity;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    if (sfxOnly && !v.isSfx) continue;
    if (v.endsAt < bestEnd) {
      bestEnd = v.endsAt;
      best = i;
    }
  }
  if (best >= 0) {
    release(voices[best]);
    removeAt(best);
  }
}

function allocVoice(
  isSfx: boolean,
  t0: number,
  dur: number,
  vol: number,
  pan: number,
  dest: AudioNode,
): Voice | null {
  const c = ctx;
  if (!c) return null;

  if (isSfx) {
    let n = 0;
    for (let i = 0; i < voices.length; i++) if (voices[i].isSfx) n++;
    if (n >= MAX_SFX_VOICES) stealOldest(true);
  }
  if (voices.length >= MAX_VOICES) stealOldest(false);
  if (voices.length >= MAX_VOICES) return null;

  let v = pool.pop();
  if (!v) {
    const out = c.createGain();
    let p: StereoPannerNode | null = null;
    if (hasPanner) {
      p = c.createStereoPanner();
      out.connect(p);
    }
    v = {
      out,
      pan: p,
      tail: p ?? out,
      srcs: [],
      nodes: [],
      endsAt: 0,
      isSfx,
    };
  }

  const now = c.currentTime;
  v.out.gain.cancelScheduledValues(now);
  v.out.gain.value = clamp(vol, 0, 4);
  if (v.pan) v.pan.pan.value = clamp(pan, -1, 1);
  v.isSfx = isSfx;
  v.endsAt = t0 + dur + 0.08;
  v.tail.connect(dest);
  voices.push(v);
  return v;
}

// ---------------------------------------------------------------------------
// synthesis primitives
// ---------------------------------------------------------------------------

function envAD(p: AudioParam, t0: number, peak: number, atk: number, dur: number): void {
  const a = Math.max(0.0006, atk);
  const end = t0 + Math.max(a + 0.012, dur);
  const pk = Math.max(0.0004, peak);
  p.setValueAtTime(0.0001, t0);
  p.linearRampToValueAtTime(pk, t0 + a);
  p.exponentialRampToValueAtTime(0.0001, end);
  p.setValueAtTime(0, end + 0.002);
}

function addOsc(
  v: Voice,
  type: OscillatorType,
  f0: number,
  f1: number,
  t0: number,
  dur: number,
  peak: number,
  atk: number,
  dest: AudioNode | null,
): OscillatorNode | null {
  const c = ctx;
  if (!c) return null;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  const a = clamp(f0, 12, 20000);
  const b = clamp(f1, 12, 20000);
  o.frequency.setValueAtTime(a, t0);
  if (Math.abs(b - a) > 0.5) o.frequency.exponentialRampToValueAtTime(b, t0 + dur * 0.92);
  envAD(g.gain, t0, peak, atk, dur);
  o.connect(g);
  g.connect(dest ?? v.out);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  v.srcs.push(o);
  v.nodes.push(g);
  return o;
}

function addNoise(
  v: Voice,
  t0: number,
  dur: number,
  peak: number,
  ftype: BiquadFilterType,
  f0: number,
  f1: number,
  q: number,
  atk: number,
  dest: AudioNode | null,
): void {
  const c = ctx;
  if (!c || !noiseBuf) return;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = ftype;
  f.Q.value = Math.max(0.0001, q);
  const a = clamp(f0, 24, 18000);
  const b = clamp(f1, 24, 18000);
  f.frequency.setValueAtTime(a, t0);
  if (Math.abs(b - a) > 1) f.frequency.exponentialRampToValueAtTime(b, t0 + dur * 0.92);
  const g = c.createGain();
  envAD(g.gain, t0, peak, atk, dur);
  s.connect(f);
  f.connect(g);
  g.connect(dest ?? v.out);
  const maxOff = Math.max(0.001, noiseBuf.duration - dur - 0.1);
  s.start(t0, fx.range(0, maxOff));
  s.stop(t0 + dur + 0.05);
  v.srcs.push(s);
  v.nodes.push(f);
  v.nodes.push(g);
}

/** Route an LFO into an AudioParam (vibrato / wobble). */
function addLfo(
  v: Voice,
  target: AudioParam,
  t0: number,
  dur: number,
  rateHz: number,
  depth: number,
  type: OscillatorType,
): void {
  const c = ctx;
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(rateHz, t0);
  g.gain.setValueAtTime(depth, t0);
  o.connect(g);
  g.connect(target);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  v.srcs.push(o);
  v.nodes.push(g);
}

// ---------------------------------------------------------------------------
// sfx voicing
// ---------------------------------------------------------------------------

function renderSfx(name: SfxName, t0: number, vol: number, rate: number, pan: number): void {
  const bus = sfxBus;
  if (!bus) return;
  const d = SFX_DUR[name] / rate;
  const v = allocVoice(true, t0, d, vol, pan, bus);
  if (!v) return;
  const r = rate;

  switch (name) {
    case 'shoot': {
      addOsc(v, 'square', 940 * r, 170 * r, t0, d * 0.66, 0.34, 0.001, null);
      addOsc(v, 'triangle', 340 * r, 110 * r, t0, d * 0.5, 0.2, 0.001, null);
      addNoise(v, t0, d * 0.3, 0.22, 'highpass', 2200 * r, 900 * r, 0.7, 0.001, null);
      break;
    }
    case 'shootHeavy': {
      addOsc(v, 'sawtooth', 420 * r, 62 * r, t0, d * 0.8, 0.4, 0.002, null);
      addOsc(v, 'square', 180 * r, 48 * r, t0, d * 0.6, 0.26, 0.001, null);
      addNoise(v, t0, d * 0.4, 0.3, 'lowpass', 3200 * r, 420 * r, 1.1, 0.001, null);
      break;
    }
    case 'laser': {
      const o = addOsc(v, 'sawtooth', 2100 * r, 260 * r, t0, d * 0.85, 0.24, 0.002, null);
      addOsc(v, 'square', 2110 * r, 268 * r, t0, d * 0.85, 0.16, 0.002, null);
      if (o) addLfo(v, o.frequency, t0, d, 42, 90 * r, 'sine');
      addNoise(v, t0, d * 0.25, 0.12, 'bandpass', 4200 * r, 1400 * r, 4, 0.002, null);
      break;
    }
    case 'shotgun': {
      addNoise(v, t0, d * 0.9, 0.5, 'bandpass', 2600 * r, 220 * r, 0.9, 0.001, null);
      addNoise(v, t0, d * 0.25, 0.35, 'highpass', 5200 * r, 2200 * r, 0.6, 0.001, null);
      addOsc(v, 'triangle', 150 * r, 38 * r, t0, d * 0.55, 0.42, 0.002, null);
      break;
    }
    case 'rocket': {
      addNoise(v, t0, d * 0.95, 0.36, 'bandpass', 500 * r, 2800 * r, 1.6, 0.05, null);
      addOsc(v, 'sawtooth', 90 * r, 300 * r, t0, d * 0.9, 0.2, 0.03, null);
      addOsc(v, 'square', 260 * r, 70 * r, t0, d * 0.28, 0.22, 0.002, null);
      break;
    }
    case 'hit': {
      addOsc(v, 'square', 520 * r, 190 * r, t0, d * 0.6, 0.3, 0.001, null);
      addNoise(v, t0, d * 0.45, 0.3, 'bandpass', 1900 * r, 700 * r, 1.4, 0.001, null);
      break;
    }
    case 'enemyDie': {
      addOsc(v, 'sawtooth', 330 * r, 55 * r, t0, d * 0.85, 0.32, 0.002, null);
      addOsc(v, 'square', 165 * r, 44 * r, t0, d * 0.7, 0.18, 0.003, null);
      addNoise(v, t0, d * 0.5, 0.26, 'lowpass', 2400 * r, 300 * r, 1.0, 0.002, null);
      break;
    }
    case 'crowdDie': {
      for (let i = 0; i < 4; i++) {
        const off = t0 + i * 0.035;
        const det = 1 + fx.sym(0.06);
        addOsc(v, 'sawtooth', 300 * r * det, 48 * r, off, d * 0.8, 0.16, 0.004, null);
      }
      addNoise(v, t0, d * 0.7, 0.28, 'lowpass', 3000 * r, 260 * r, 0.9, 0.01, null);
      break;
    }
    case 'gate': {
      const s = [0, 4, 7];
      for (let i = 0; i < s.length; i++) {
        const f = 440 * r * Math.pow(2, s[i] / 12);
        addOsc(v, 'triangle', f, f, t0 + i * d * 0.16, d * 0.4, 0.3, 0.004, null);
        addOsc(v, 'square', f * 2, f * 2, t0 + i * d * 0.16, d * 0.2, 0.08, 0.004, null);
      }
      break;
    }
    case 'gateBad': {
      const s = [0, -1, -3];
      for (let i = 0; i < s.length; i++) {
        const f = 240 * r * Math.pow(2, s[i] / 12);
        addOsc(v, 'square', f, f * 0.94, t0 + i * d * 0.2, d * 0.42, 0.28, 0.004, null);
      }
      addNoise(v, t0, d * 0.7, 0.14, 'lowpass', 1200 * r, 300 * r, 1.2, 0.02, null);
      break;
    }
    case 'gateBig': {
      const s = [0, 4, 7, 12, 16];
      for (let i = 0; i < s.length; i++) {
        const f = 392 * r * Math.pow(2, s[i] / 12);
        addOsc(v, 'square', f, f, t0 + i * d * 0.11, d * 0.4, 0.22, 0.004, null);
        addOsc(v, 'triangle', f * 0.5, f * 0.5, t0 + i * d * 0.11, d * 0.3, 0.14, 0.004, null);
      }
      addNoise(v, t0 + d * 0.5, d * 0.45, 0.1, 'highpass', 4000 * r, 9000 * r, 0.8, 0.06, null);
      break;
    }
    case 'boardHit': {
      addNoise(v, t0, d * 0.7, 0.4, 'bandpass', 1500 * r, 900 * r, 5, 0.001, null);
      addOsc(v, 'triangle', 420 * r, 250 * r, t0, d * 0.5, 0.22, 0.001, null);
      break;
    }
    case 'boardBreak': {
      for (let i = 0; i < 5; i++) {
        const off = t0 + i * d * 0.09 + fx.range(0, 0.012);
        addNoise(v, off, d * 0.2, 0.3, 'bandpass', fx.range(900, 2600) * r, 700 * r, 4, 0.001, null);
      }
      addOsc(v, 'triangle', 300 * r, 90 * r, t0, d * 0.6, 0.24, 0.002, null);
      break;
    }
    case 'crateHit': {
      addNoise(v, t0, d * 0.6, 0.34, 'bandpass', 700 * r, 320 * r, 2.4, 0.001, null);
      addOsc(v, 'square', 200 * r, 110 * r, t0, d * 0.55, 0.26, 0.001, null);
      break;
    }
    case 'crateBreak': {
      addNoise(v, t0, d * 0.85, 0.42, 'lowpass', 4200 * r, 380 * r, 1.1, 0.002, null);
      for (let i = 0; i < 4; i++) {
        const off = t0 + 0.03 + i * d * 0.1;
        addNoise(v, off, d * 0.16, 0.2, 'bandpass', fx.range(1400, 3400) * r, 800 * r, 6, 0.001, null);
      }
      addOsc(v, 'triangle', 170 * r, 52 * r, t0, d * 0.5, 0.3, 0.002, null);
      break;
    }
    case 'recruit': {
      const f = 520 * r;
      addOsc(v, 'triangle', f, f, t0, d * 0.4, 0.32, 0.004, null);
      addOsc(v, 'triangle', f * 1.5, f * 1.5, t0 + d * 0.34, d * 0.5, 0.3, 0.004, null);
      addOsc(v, 'square', f * 3, f * 3, t0 + d * 0.34, d * 0.25, 0.07, 0.004, null);
      break;
    }
    case 'weaponUp': {
      const steps = [0, 3, 7, 10, 12, 15];
      for (let i = 0; i < steps.length; i++) {
        const f = 330 * r * Math.pow(2, steps[i] / 12);
        addOsc(v, 'square', f, f, t0 + i * d * 0.1, d * 0.3, 0.2, 0.003, null);
      }
      const top = addOsc(v, 'square', 1320 * r, 1320 * r, t0 + d * 0.6, d * 0.4, 0.18, 0.006, null);
      if (top) addLfo(v, top.frequency, t0 + d * 0.6, d * 0.4, 11, 26, 'sine');
      break;
    }
    case 'shield': {
      addOsc(v, 'sine', 220 * r, 660 * r, t0, d * 0.9, 0.34, 0.05, null);
      addOsc(v, 'triangle', 440 * r, 1320 * r, t0, d * 0.8, 0.14, 0.06, null);
      addNoise(v, t0, d * 0.9, 0.1, 'bandpass', 1800 * r, 6000 * r, 3, 0.08, null);
      break;
    }
    case 'coin': {
      const f = 988 * r;
      addOsc(v, 'square', f, f, t0, d * 0.18, 0.26, 0.002, null);
      addOsc(v, 'square', f * 1.5, f * 1.5, t0 + d * 0.16, d * 0.8, 0.26, 0.002, null);
      addOsc(v, 'triangle', f * 3, f * 3, t0 + d * 0.16, d * 0.5, 0.08, 0.002, null);
      break;
    }
    case 'bossRoar': {
      const o = addOsc(v, 'sawtooth', 92 * r, 58 * r, t0, d * 0.95, 0.42, 0.06, null);
      if (o) addLfo(v, o.frequency, t0, d, 6.5, 22 * r, 'sine');
      const o2 = addOsc(v, 'square', 46 * r, 30 * r, t0, d * 0.95, 0.3, 0.06, null);
      if (o2) addLfo(v, o2.frequency, t0, d, 9.5, 9 * r, 'triangle');
      addNoise(v, t0, d * 0.9, 0.24, 'bandpass', 320 * r, 900 * r, 1.2, 0.15, null);
      break;
    }
    case 'bossHit': {
      addOsc(v, 'square', 620 * r, 380 * r, t0, d * 0.45, 0.24, 0.001, null);
      addOsc(v, 'square', 941 * r, 720 * r, t0, d * 0.35, 0.14, 0.001, null);
      addOsc(v, 'triangle', 1490 * r, 1180 * r, t0, d * 0.3, 0.1, 0.001, null);
      addNoise(v, t0, d * 0.55, 0.24, 'bandpass', 2600 * r, 900 * r, 3, 0.001, null);
      break;
    }
    case 'bossDie': {
      addOsc(v, 'sawtooth', 220 * r, 26 * r, t0, d * 0.95, 0.38, 0.02, null);
      addOsc(v, 'square', 110 * r, 22 * r, t0, d * 0.9, 0.24, 0.03, null);
      addNoise(v, t0, d * 0.95, 0.34, 'lowpass', 5200 * r, 140 * r, 0.9, 0.02, null);
      for (let i = 0; i < 4; i++) {
        const off = t0 + 0.12 + i * d * 0.2;
        addNoise(v, off, d * 0.28, 0.26, 'lowpass', 2600 * r, 200 * r, 1.0, 0.004, null);
        addOsc(v, 'sine', 130 * r, 34 * r, off, d * 0.2, 0.22, 0.003, null);
      }
      break;
    }
    case 'stomp': {
      addOsc(v, 'sine', 140 * r, 34 * r, t0, d * 0.8, 0.55, 0.002, null);
      addOsc(v, 'triangle', 90 * r, 30 * r, t0, d * 0.7, 0.3, 0.004, null);
      addNoise(v, t0, d * 0.3, 0.24, 'lowpass', 1600 * r, 240 * r, 1.0, 0.001, null);
      break;
    }
    case 'explosion': {
      addNoise(v, t0, d * 0.95, 0.55, 'lowpass', 6000 * r, 130 * r, 0.9, 0.004, null);
      addNoise(v, t0, d * 0.3, 0.3, 'highpass', 3000 * r, 1200 * r, 0.7, 0.001, null);
      addOsc(v, 'sine', 180 * r, 26 * r, t0, d * 0.75, 0.5, 0.004, null);
      addOsc(v, 'sawtooth', 70 * r, 24 * r, t0, d * 0.6, 0.2, 0.01, null);
      break;
    }
    case 'uiClick': {
      addOsc(v, 'square', 1250 * r, 1250 * r, t0, d * 0.8, 0.22, 0.001, null);
      addNoise(v, t0, d * 0.4, 0.1, 'highpass', 3800 * r, 3800 * r, 0.7, 0.001, null);
      break;
    }
    case 'uiBack': {
      addOsc(v, 'square', 640 * r, 380 * r, t0, d * 0.85, 0.22, 0.002, null);
      break;
    }
    case 'countUp': {
      addOsc(v, 'triangle', 1600 * r, 1600 * r, t0, d * 0.8, 0.18, 0.001, null);
      break;
    }
    case 'lose': {
      const s = [0, -2, -4, -7];
      for (let i = 0; i < s.length; i++) {
        const f = 330 * r * Math.pow(2, s[i] / 12);
        const at = t0 + i * d * 0.22;
        addOsc(v, 'square', f, f * 0.985, at, d * 0.3, 0.24, 0.006, null);
        addOsc(v, 'triangle', f * 0.5, f * 0.5 * 0.985, at, d * 0.3, 0.16, 0.006, null);
      }
      addOsc(v, 'sawtooth', 120 * r, 42 * r, t0 + d * 0.66, d * 0.34, 0.2, 0.02, null);
      break;
    }
    case 'win': {
      const s = [0, 4, 7, 12, 16, 19];
      for (let i = 0; i < s.length; i++) {
        const f = 392 * r * Math.pow(2, s[i] / 12);
        const at = t0 + i * d * 0.1;
        addOsc(v, 'square', f, f, at, d * 0.22, 0.2, 0.004, null);
      }
      const chord = [0, 4, 7, 12];
      for (let i = 0; i < chord.length; i++) {
        const f = 392 * r * Math.pow(2, chord[i] / 12);
        addOsc(v, 'triangle', f, f, t0 + d * 0.6, d * 0.4, 0.2, 0.01, null);
      }
      addNoise(v, t0 + d * 0.58, d * 0.42, 0.08, 'highpass', 5000 * r, 9000 * r, 0.8, 0.02, null);
      break;
    }
    case 'levelStart': {
      addOsc(v, 'sawtooth', 196 * r, 196 * r, t0, d * 0.4, 0.26, 0.02, null);
      addOsc(v, 'sawtooth', 294 * r, 294 * r, t0 + d * 0.34, d * 0.6, 0.28, 0.02, null);
      addOsc(v, 'square', 98 * r, 98 * r, t0, d * 0.9, 0.16, 0.02, null);
      addNoise(v, t0, d * 0.6, 0.16, 'bandpass', 400 * r, 4000 * r, 1.2, 0.2, null);
      break;
    }
    case 'warning': {
      for (let i = 0; i < 3; i++) {
        const at = t0 + i * d * 0.3;
        const f = (i % 2 === 0 ? 880 : 660) * r;
        const o = addOsc(v, 'square', f, f, at, d * 0.22, 0.24, 0.006, null);
        if (o) addLfo(v, o.frequency, at, d * 0.22, 18, 12, 'square');
      }
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// music: patterns
// ---------------------------------------------------------------------------

const KICK = 1;
const SNARE = 2;
const HAT = 4;
const TOM = 8;

interface TrackDef {
  bpm: number;
  /** MIDI root note of the key. */
  root: number;
  scale: readonly number[];
  /** Scale-degree transposition per bar (chord movement). */
  chords: readonly number[];
  bass: readonly number[];
  arp: readonly number[];
  drum: readonly number[];
  bassSemis: number;
  arpSemis: number;
  bassWave: OscillatorType;
  arpWave: OscillatorType;
  bassCut: number;
  arpCut: number;
  gain: number;
  drumGain: number;
  swing: number;
  /** After this many 16th steps the track drops to `quietGain` (victory loop). */
  quietAfter: number;
  quietGain: number;
}

const PENTA_MAJ = [0, 2, 4, 7, 9] as const;
const PENTA_MIN = [0, 3, 5, 7, 10] as const;
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

const MENU: TrackDef = {
  bpm: 92,
  root: 57,
  scale: PENTA_MAJ,
  chords: [0, 2, 4, 1],
  bass: [0, -1, -1, -1, -1, -1, 2, -1, 0, -1, -1, -1, 4, -1, -1, -1],
  arp: [-1, -1, 4, -1, 6, -1, -1, 5, -1, -1, 4, -1, 2, -1, 3, -1],
  drum: [
    KICK | HAT, 0, HAT, 0,
    HAT, 0, HAT, 0,
    KICK | HAT, 0, HAT, 0,
    SNARE | HAT, 0, HAT, 0,
  ],
  bassSemis: -12,
  arpSemis: 12,
  bassWave: 'triangle',
  arpWave: 'triangle',
  bassCut: 900,
  arpCut: 3200,
  gain: 0.62,
  drumGain: 0.4,
  swing: 0.18,
  quietAfter: 0,
  quietGain: 1,
};

const RUN: TrackDef = {
  bpm: 152,
  root: 57,
  scale: PENTA_MIN,
  chords: [0, 0, 3, 2],
  bass: [0, -1, 0, -1, 2, -1, 0, -1, 3, -1, 0, -1, 2, -1, 4, 3],
  arp: [7, -1, 4, 5, 7, -1, 9, -1, 7, -1, 4, 5, 7, 9, 11, -1],
  drum: [
    KICK | HAT, 0, HAT, KICK,
    SNARE | HAT, 0, HAT, 0,
    KICK | HAT, 0, HAT, KICK,
    SNARE | HAT, 0, HAT, HAT,
  ],
  bassSemis: -24,
  arpSemis: 12,
  bassWave: 'sawtooth',
  arpWave: 'square',
  bassCut: 1100,
  arpCut: 4200,
  gain: 0.72,
  drumGain: 0.66,
  swing: 0.04,
  quietAfter: 0,
  quietGain: 1,
};

const BOSS: TrackDef = {
  bpm: 136,
  root: 45,
  scale: PHRYGIAN,
  chords: [0, 0, 1, 0],
  bass: [0, 0, -1, 0, 1, -1, 0, -1, 0, 0, -1, 4, 3, -1, 1, 0],
  arp: [-1, -1, 7, -1, -1, 8, -1, 7, -1, -1, 11, -1, 10, -1, 7, -1],
  drum: [
    KICK | HAT, 0, KICK, HAT,
    SNARE | HAT, 0, TOM, 0,
    KICK | HAT, KICK, HAT, 0,
    SNARE | HAT, TOM, SNARE, TOM,
  ],
  bassSemis: -24,
  arpSemis: 0,
  bassWave: 'sawtooth',
  arpWave: 'square',
  bassCut: 700,
  arpCut: 2600,
  gain: 0.78,
  drumGain: 0.8,
  swing: 0,
  quietAfter: 0,
  quietGain: 1,
};

const VICTORY: TrackDef = {
  bpm: 160,
  root: 60,
  scale: MAJOR,
  chords: [0, 3, 4, 0],
  bass: [0, -1, -1, -1, 4, -1, -1, -1, 2, -1, -1, -1, 4, -1, 6, -1],
  arp: [0, 2, 4, 7, 9, 7, 4, 2, 0, 4, 7, 11, 9, 7, 4, 7],
  drum: [
    KICK | HAT, 0, HAT, 0,
    SNARE | HAT, 0, HAT, HAT,
    KICK | HAT, 0, HAT, 0,
    SNARE | HAT, HAT, SNARE, TOM,
  ],
  bassSemis: -12,
  arpSemis: 0,
  bassWave: 'triangle',
  arpWave: 'square',
  bassCut: 1400,
  arpCut: 5200,
  gain: 0.8,
  drumGain: 0.6,
  swing: 0.06,
  quietAfter: 64,
  quietGain: 0.28,
};

const TRACKS: Record<MusicTrack, TrackDef | null> = {
  none: null,
  menu: MENU,
  run: RUN,
  boss: BOSS,
  victory: VICTORY,
};

// ---------------------------------------------------------------------------
// music: scheduler
// ---------------------------------------------------------------------------

let curTrack: MusicTrack = 'none';
let curDef: TrackDef | null = null;
let curSlot = 0;
let musicStep = 0;
let nextStepTime = 0;
let quietDone = false;

function slotNode(): GainNode | null {
  return curSlot === 0 ? slotA : slotB;
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function scaleNote(scale: readonly number[], degree: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = degree - oct * n;
  return scale[idx] + 12 * oct;
}

function startTrack(track: MusicTrack, immediate: boolean): void {
  const c = ctx;
  if (!c || !slotA || !slotB) return;
  const now = c.currentTime;
  const fade = immediate ? 0.08 : XFADE;

  const outgoing = curSlot === 0 ? slotA : slotB;
  outgoing.gain.cancelScheduledValues(now);
  outgoing.gain.setValueAtTime(outgoing.gain.value, now);
  outgoing.gain.linearRampToValueAtTime(0, now + fade);

  curSlot = curSlot === 0 ? 1 : 0;
  const incoming = curSlot === 0 ? slotA : slotB;
  const def = TRACKS[track];
  incoming.gain.cancelScheduledValues(now);
  incoming.gain.setValueAtTime(0, now);

  curDef = def;
  quietDone = false;
  musicStep = 0;
  nextStepTime = now + 0.06;

  if (def) incoming.gain.linearRampToValueAtTime(def.gain, now + fade);
}

function mTone(
  t0: number,
  dur: number,
  freq: number,
  wave: OscillatorType,
  peak: number,
  cutoff: number,
  detune: number,
  pan: number,
): void {
  const dest = slotNode();
  const c = ctx;
  if (!dest || !c) return;
  const v = allocVoice(false, t0, dur, 1, pan, dest);
  if (!v) return;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(clamp(cutoff, 60, 18000), t0);
  f.frequency.exponentialRampToValueAtTime(clamp(cutoff * 0.45, 60, 18000), t0 + dur);
  f.Q.value = 1.2;
  f.connect(v.out);
  v.nodes.push(f);
  addOsc(v, wave, freq, freq, t0, dur, peak, 0.006, f);
  if (detune > 0) addOsc(v, wave, freq * (1 + detune), freq * (1 + detune), t0, dur, peak * 0.6, 0.008, f);
}

function mKick(t0: number, peak: number): void {
  const dest = slotNode();
  if (!dest) return;
  const v = allocVoice(false, t0, 0.24, 1, 0, dest);
  if (!v) return;
  addOsc(v, 'sine', 155, 42, t0, 0.2, peak, 0.002, null);
  addNoise(v, t0, 0.03, peak * 0.4, 'lowpass', 2400, 600, 0.8, 0.001, null);
}

function mSnare(t0: number, peak: number): void {
  const dest = slotNode();
  if (!dest) return;
  const v = allocVoice(false, t0, 0.2, 1, fx.sym(0.08), dest);
  if (!v) return;
  addNoise(v, t0, 0.16, peak, 'bandpass', 1900, 1200, 0.9, 0.001, null);
  addOsc(v, 'triangle', 210, 150, t0, 0.09, peak * 0.55, 0.001, null);
}

function mHat(t0: number, peak: number, open: boolean): void {
  const dest = slotNode();
  if (!dest) return;
  const dur = open ? 0.14 : 0.035;
  const v = allocVoice(false, t0, dur, 1, fx.sym(0.3), dest);
  if (!v) return;
  addNoise(v, t0, dur, peak, 'highpass', 7200, 8600, 0.8, 0.001, null);
}

function mTom(t0: number, peak: number): void {
  const dest = slotNode();
  if (!dest) return;
  const v = allocVoice(false, t0, 0.26, 1, fx.sym(0.4), dest);
  if (!v) return;
  addOsc(v, 'sine', 210, 88, t0, 0.22, peak, 0.002, null);
  addNoise(v, t0, 0.06, peak * 0.25, 'bandpass', 900, 500, 1.4, 0.002, null);
}

function scheduleStep(def: TrackDef, step: number, time: number, stepDur: number): void {
  const len = def.bass.length;
  const i = step % len;
  const bar = Math.floor(step / len);
  const chord = def.chords[bar % def.chords.length];
  const swung = (i & 1) === 1 ? time + stepDur * def.swing : time;
  // Accent the downbeats a touch so the pattern breathes.
  const accent = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.55 : 0.3;
  const vel = lerp(0.72, 1, accent);

  const b = def.bass[i];
  if (b >= 0) {
    const note = def.root + scaleNote(def.scale, b + chord) + def.bassSemis;
    mTone(swung, stepDur * 1.7, midiToFreq(note), def.bassWave, 0.3 * vel, def.bassCut, 0.006, -0.05);
  }

  const a = def.arp[i];
  if (a >= 0) {
    const note = def.root + scaleNote(def.scale, a + chord) + def.arpSemis;
    mTone(swung, stepDur * 1.25, midiToFreq(note), def.arpWave, 0.16 * vel, def.arpCut, 0, 0.12);
  }

  const dr = def.drum[i];
  if (dr !== 0) {
    const g = def.drumGain;
    if ((dr & KICK) !== 0) mKick(time, 0.6 * g);
    if ((dr & SNARE) !== 0) mSnare(time, 0.34 * g);
    if ((dr & HAT) !== 0) mHat(swung, 0.13 * g * vel, i % 8 === 6);
    if ((dr & TOM) !== 0) mTom(swung, 0.3 * g);
  }
}

function scheduleMusic(now: number, lookahead: number): void {
  const def = curDef;
  if (!def) return;
  const stepDur = 15 / def.bpm; // 60 / bpm / 4
  // Recover gracefully after a tab suspend or a very long frame.
  if (nextStepTime < now) nextStepTime = now + 0.02;
  let guard = 0;
  while (nextStepTime < now + lookahead && guard < 64) {
    scheduleStep(def, musicStep, nextStepTime, stepDur);
    musicStep++;
    guard++;
    if (!quietDone && def.quietAfter > 0 && musicStep >= def.quietAfter) {
      quietDone = true;
      const s = slotNode();
      if (s) {
        s.gain.cancelScheduledValues(nextStepTime);
        s.gain.setValueAtTime(s.gain.value, nextStepTime);
        s.gain.linearRampToValueAtTime(def.gain * def.quietGain, nextStepTime + 1.2);
      }
    }
    nextStepTime += stepDur;
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export const audio: AudioEngine = {
  get ready(): boolean {
    return isReady();
  },

  get muted(): boolean {
    return mutedFlag;
  },

  init(): void {
    init();
  },

  unlock(): void {
    init();
    const c = ctx;
    if (!c) return;
    if (c.state === 'suspended') {
      try {
        c.resume().catch(noop);
      } catch {
        /* older implementations may throw synchronously */
      }
    }
    // A short silent blip satisfies iOS' "must start from a gesture" rule.
    // Only needed once; repeating it on every gesture would leak nodes.
    if (!blipDone && noiseBuf && sfxBus) {
      blipDone = true;
      try {
        const s = c.createBufferSource();
        s.buffer = noiseBuf;
        const g = c.createGain();
        g.gain.value = 0;
        s.connect(g);
        g.connect(sfxBus);
        s.onended = (): void => {
          s.disconnect();
          g.disconnect();
        };
        s.start(c.currentTime);
        s.stop(c.currentTime + 0.01);
      } catch {
        /* ignore */
      }
    }
    // Only ever push the cursor forward: unlock() runs on every latched gesture
    // and rewinding it would re-emit steps already scheduled into the future.
    if (curDef) nextStepTime = Math.max(nextStepTime, c.currentTime + 0.06);
  },

  setMuted(m: boolean): void {
    mutedFlag = m;
    applyMasterGain();
  },

  toggleMuted(): boolean {
    mutedFlag = !mutedFlag;
    applyMasterGain();
    return mutedFlag;
  },

  setMasterVolume(v: number): void {
    masterVol = clamp(num(v, masterVol), 0, 1);
    applyMasterGain();
  },

  setMusic(track: MusicTrack): void {
    if (track === curTrack) return;
    curTrack = track;
    if (!isReady()) return;
    startTrack(track, false);
  },

  sfx(name: SfxName, opts?: AudioOptions): void {
    if (!isReady() || mutedFlag) return;
    const c = ctx;
    if (!c) return;
    const now = c.currentTime;

    const gap = MIN_GAP[name] ?? MIN_GAP_DEFAULT;
    const last = lastPlay.get(name);
    if (last !== undefined && now - last < gap) return;
    lastPlay.set(name, now);

    const vol = clamp(num(opts?.vol, 1), 0, 4);
    if (vol <= 0.0005) return;
    const jitter = JITTER[name] ?? 0.025;
    const rate = clamp(num(opts?.rate, 1) * (1 + fx.sym(jitter)), 0.25, 4);
    const pan = clamp(num(opts?.pan, 0), -1, 1);

    renderSfx(name, now + 0.003, vol, rate, pan);
  },

  update(dt: number): void {
    const c = ctx;
    if (!isReady() || !c) return;
    const now = c.currentTime;

    // In-place compaction: retire finished voices without allocating.
    let w = 0;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (v.endsAt <= now) {
        release(v);
      } else {
        voices[w++] = v;
      }
    }
    voices.length = w;

    // Longer frames need a longer lookahead window or the groove stutters.
    const lookahead = clamp(BASE_LOOKAHEAD + num(dt, 0) * 2, BASE_LOOKAHEAD, 0.4);
    scheduleMusic(now, lookahead);
  },

  suspend(): void {
    const c = ctx;
    if (!c || c.state !== 'running') return;
    try {
      c.suspend().catch(noop);
    } catch {
      /* ignore */
    }
  },

  resume(): void {
    const c = ctx;
    if (!c || c.state === 'closed') return;
    try {
      c.resume().catch(noop);
    } catch {
      /* ignore */
    }
    // currentTime is frozen while suspended, so the cursor is already ahead of
    // it; clamping forward-only keeps the tail we scheduled before the suspend
    // from being scheduled a second time.
    if (curDef) nextStepTime = Math.max(nextStepTime, c.currentTime + 0.06);
  },
};
