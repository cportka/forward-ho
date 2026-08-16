/**
 * Sky, terrain and road.
 *
 * The ground plane is rendered as classic pseudo-3D scanlines, but split
 * across two planes on purpose: the terrain either side of the road lives on
 * the coarse `mid` plane and the road itself on the finer `world` plane. The
 * result is a picture whose pixel size visibly steps down as your eye travels
 * from the sky to the tarmac under the squad's boots.
 */

import { clamp, hash1, hash2, noise1, wrap } from '../core/math';
import type { Camera } from '../render/camera';
import { ROAD_HALF } from '../render/camera';
import type { Painter } from '../render/pixelbuffer';
import { mixHex, shade } from './palette';
import type { BiomeDef } from '../game/defs';
import {
  SPR_BIRD, SPR_CACTUS, SPR_CLOUD, SPR_CRYSTAL, SPR_FENCE, SPR_GANTRY, SPR_GRATE,
  SPR_PALM, SPR_PINE, SPR_RAIL_POST, SPR_ROCK, SPR_SHIP, SPR_TOWER,
} from './art';

/** Depth of the ground plane at a given screen row. */
function depthAt(cam: Camera, sy: number): number {
  const hy = cam.horizonY + cam.shakeY;
  const d = sy - hy;
  if (d <= 0.35) return Infinity;
  return ((cam.y + cam.lift) * cam.focal) / d;
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

export function drawSky(p: Painter, biome: BiomeDef, cam: Camera, time: number): void {
  const H = cam.height;
  const hy = cam.horizonY + cam.shakeY;
  const rows = p.h;
  const step = 1;
  // Vertical gradient, banded at the sky plane's chunky pixel size.
  for (let r = 0; r < rows; r += step) {
    const y = r * p.scale;
    if (y > hy + p.scale * 2) break;
    const t = clamp(y / Math.max(1, hy), 0, 1);
    p.rect(0, y, cam.width, p.scale, mixHex(biome.skyTop, biome.skyBottom, t * t * 0.85 + t * 0.15));
  }
  // Everything below the horizon is fog-coloured so gaps never show black.
  p.rect(0, hy - p.scale, cam.width, H - hy + p.scale * 2, biome.fog);

  // Sun / furnace glow.
  const sunX = cam.width * 0.5 - cam.x * 5.5;
  const sunY = hy * biome.sunY * 2.2;
  const sunR = cam.width * 0.11;
  p.additive(true);
  p.ellipse(sunX, sunY, sunR * 1.9, sunR * 1.9, biome.sunColor, 0.16);
  p.additive(false);
  p.ellipse(sunX, sunY, sunR, sunR, biome.sunColor, 0.95);

  // Clouds drift with a slow parallax against the camera's lateral motion.
  const cloudCount = biome.id === 'void' ? 0 : 7;
  for (let i = 0; i < cloudCount; i++) {
    const seed = i * 37;
    const speed = 2.2 + hash1(seed, 5) * 3.5;
    const cx = wrap(hash1(seed, 1) * cam.width * 2.4 - time * speed - cam.x * 9, cam.width * 2.4) - cam.width * 0.7;
    const cy = hy * (0.12 + hash1(seed, 2) * 0.62);
    const cs = cam.width * (0.09 + hash1(seed, 3) * 0.14);
    p.sprite(SPR_CLOUD, cx, cy, cs * 0.42, { alpha: 0.5 + hash1(seed, 4) * 0.35 });
  }

  // Stars for the night biomes.
  if (biome.id === 'void' || biome.id === 'neon') {
    for (let i = 0; i < 90; i++) {
      const sx = hash1(i, 11) * cam.width;
      const sy2 = hash1(i, 12) * hy * 0.95;
      const tw = 0.45 + 0.55 * Math.sin(time * 2 + i);
      p.rect(sx, sy2, p.scale, p.scale, '#ffffff', tw * 0.7);
    }
  }
}

// ---------------------------------------------------------------------------
// Far parallax band — silhouettes sitting on the horizon
// ---------------------------------------------------------------------------

export function drawFar(p: Painter, biome: BiomeDef, cam: Camera, time: number): void {
  const hy = cam.horizonY + cam.shakeY;
  const W = cam.width;
  const drift = cam.z * 0.55 + cam.x * 16;

  const silhouette = mixHex(biome.fog, biome.skyTop, 0.45);
  const silhouette2 = mixHex(biome.fog, biome.skyTop, 0.2);

  // A ridgeline built from layered value noise. Two passes give depth.
  for (let pass = 0; pass < 2; pass++) {
    const amp = pass === 0 ? hy * 0.16 : hy * 0.1;
    const par = pass === 0 ? 0.04 : 0.09;
    const col = pass === 0 ? silhouette2 : silhouette;
    const baseY = hy + (pass === 0 ? 1 : 0) * p.scale;
    const stepPx = p.scale;
    for (let x = 0; x < W; x += stepPx) {
      const u = (x + drift * par) * 0.006;
      const n = noise1(u, 3) * 0.6 + noise1(u * 2.7, 9) * 0.3 + noise1(u * 6.1, 17) * 0.1;
      const h = amp * (0.25 + n * 1.5);
      p.rect(x, baseY - h, stepPx, h + p.scale, col);
    }
  }

  // Biome landmarks along the horizon.
  const count = 9;
  for (let i = 0; i < count; i++) {
    const seed = i * 53;
    const spanZ = 260;
    const zRel = wrap(hash1(seed, 1) * spanZ - cam.z * 0.32, spanZ);
    const depth = 1 - zRel / spanZ;
    const px = wrap(hash1(seed, 2) * W * 1.8 - cam.x * 22 - cam.z * 0.4, W * 1.8) - W * 0.4;
    const size = hy * (0.10 + depth * 0.20);
    const yy = hy + p.scale;
    switch (biome.id) {
      case 'bridge':
        p.sprite(hash1(seed, 3) < 0.45 ? SPR_PALM : SPR_ROCK, px, yy, size, { alpha: 0.85 });
        break;
      case 'foundry':
        p.sprite(SPR_TOWER, px, yy, size * 1.6, { tint: shade(biome.fog, -0.25), variant: 'far' });
        break;
      case 'tundra':
        p.sprite(SPR_PINE, px, yy, size, { tint: shade(biome.fog, -0.3), variant: 'far' });
        break;
      case 'dunes':
        p.sprite(SPR_CACTUS, px, yy, size * 0.8, { tint: shade(biome.fog, -0.25), variant: 'far' });
        break;
      case 'neon':
        p.sprite(SPR_TOWER, px, yy, size * 1.9, { tint: '#2a1252', variant: 'neonfar' });
        break;
      default:
        p.sprite(SPR_CRYSTAL, px, yy, size, { tint: '#2a2450', variant: 'voidfar' });
    }
  }

  // A couple of distant moving details.
  if (biome.id === 'bridge') {
    for (let i = 0; i < 3; i++) {
      const sx = wrap(hash1(i, 21) * W * 1.5 - time * (4 + i * 2), W * 1.5) - W * 0.25;
      p.sprite(SPR_SHIP, sx, hy - p.scale, hy * 0.06, { alpha: 0.8 });
    }
    for (let i = 0; i < 5; i++) {
      const sx = wrap(hash1(i, 31) * W * 1.4 + time * (9 + i * 3), W * 1.4) - W * 0.2;
      const sy = hy * (0.3 + hash1(i, 32) * 0.35) + Math.sin(time * 2 + i) * 4;
      p.sprite(SPR_BIRD, sx, sy, hy * 0.022, { alpha: 0.75 });
    }
  }
}

// ---------------------------------------------------------------------------
// Ground plane (coarse pixels, either side of the road)
// ---------------------------------------------------------------------------

export function drawGround(p: Painter, biome: BiomeDef, cam: Camera, time: number): void {
  const hy = cam.horizonY + cam.shakeY;
  const W = cam.width;
  const H = cam.height;
  const step = p.scale;

  for (let y = Math.floor(hy / step) * step; y < H + step; y += step) {
    const z = cam.z + depthAt(cam, y + step * 0.5);
    if (!isFinite(z)) continue;
    const dz = z - cam.z;
    if (dz <= 0) continue;
    const fog = clamp((dz - 10) / 110, 0, 1);
    const band = Math.floor(z * 0.5);
    let col: string;

    switch (biome.id) {
      case 'bridge': {
        const wave = noise1(z * 0.35 + time * 0.9, 5);
        col = wave > 0.62 ? biome.groundAlt : wave > 0.3 ? biome.ground : mixHex(biome.ground, '#31a8cf', 0.55);
        break;
      }
      case 'foundry': {
        const crack = noise1(z * 0.42 + 3.1, 11);
        col = crack > 0.74 ? '#ff5a1f' : crack > 0.66 ? '#8f1f06' : band & 1 ? biome.ground : biome.groundAlt;
        break;
      }
      case 'tundra':
        col = band & 1 ? biome.ground : biome.groundAlt;
        break;
      case 'dunes': {
        const dune = noise1(z * 0.2, 7);
        col = dune > 0.55 ? biome.ground : biome.groundAlt;
        break;
      }
      case 'neon':
        col = band % 4 === 0 ? mixHex(biome.ground, biome.roadLine, 0.25) : biome.ground;
        break;
      default:
        col = band & 1 ? biome.ground : biome.groundAlt;
    }

    p.rect(0, y, W, step, mixHex(col, biome.fog, fog));
  }

  // Animated highlights in the terrain: foam crests, lava veins, ice glints.
  const highlightNear = cam.z + 4;
  const highlightFar = cam.z + 72;
  for (let i = 0; i < 90; i++) {
    const seed = i * 17;
    const zz = highlightNear + wrap(hash1(seed, 41) * 68 + (biome.id === 'bridge' ? -time * 1.4 : 0), highlightFar - highlightNear);
    const s = cam.scaleAt(zz);
    if (s < 0.6) continue;
    const side = hash1(seed, 42) < 0.5 ? -1 : 1;
    const xx = side * (ROAD_HALF + 1.2 + hash1(seed, 43) * 22);
    const sx = cam.screenX(xx, zz);
    if (sx < -40 || sx > W + 40) continue;
    const sy = cam.groundY(zz);
    const fog = clamp((zz - cam.z - 10) / 110, 0, 1);
    const w = Math.max(step, s * (0.35 + hash1(seed, 44) * 0.5));
    switch (biome.id) {
      case 'bridge':
        p.rect(sx - w / 2, sy, w, Math.max(step, s * 0.06), mixHex('#bff0ff', biome.fog, fog), 0.7);
        break;
      case 'foundry':
        p.rect(sx - w / 2, sy, w, Math.max(step, s * 0.09), mixHex(hash1(seed, 45) < 0.5 ? '#ff8b2b' : '#ffc93c', biome.fog, fog * 0.5), 0.9);
        break;
      case 'tundra':
        p.rect(sx - w / 2, sy, w, Math.max(step, s * 0.05), mixHex('#ffffff', biome.fog, fog), 0.55);
        break;
      case 'dunes':
        p.rect(sx - w / 2, sy, w, Math.max(step, s * 0.05), mixHex('#f5e3b8', biome.fog, fog), 0.5);
        break;
      case 'neon':
        p.rect(sx - w / 2, sy, w, Math.max(step, s * 0.05), mixHex(hash1(seed, 46) < 0.5 ? '#39f5c8' : '#ff3fa4', biome.fog, fog), 0.6);
        break;
      default:
        p.rect(sx - w / 2, sy, w, Math.max(step, s * 0.04), mixHex('#8a4fff', biome.fog, fog), 0.45);
    }
  }
}

// ---------------------------------------------------------------------------
// Road (finer pixels)
// ---------------------------------------------------------------------------

export function drawRoad(p: Painter, biome: BiomeDef, cam: Camera, _time: number): void {
  const hy = cam.horizonY + cam.shakeY;
  const H = cam.height;
  const step = p.scale;
  const shoulder = 0.55;

  for (let y = Math.floor((hy + step) / step) * step; y < H + step; y += step) {
    const dz = depthAt(cam, y + step * 0.5);
    if (!isFinite(dz) || dz <= 0) continue;
    const z = cam.z + dz;
    const s = cam.focal / dz;
    const fog = clamp((dz - 10) / 110, 0, 1);

    const lx = cam.screenX(-ROAD_HALF, z);
    const rx = cam.screenX(ROAD_HALF, z);
    if (rx - lx < 0.4) continue;

    const band = Math.floor(z * 0.5);
    const surface = band & 1 ? biome.road : shade(biome.road, -0.05);
    p.rect(lx, y, rx - lx, step, mixHex(surface, biome.fog, fog));

    // Shoulders / rumble strip.
    const sw = shoulder * s;
    const rumble = band & 1 ? biome.roadEdge : shade(biome.roadEdge, 0.22);
    p.rect(lx - sw, y, sw, step, mixHex(rumble, biome.fog, fog));
    p.rect(rx, y, sw, step, mixHex(rumble, biome.fog, fog));

    // Centre dashes.
    if (Math.floor(z * 0.34) % 2 === 0) {
      const dw = Math.max(step, 0.12 * s);
      p.rect(cam.screenX(0, z) - dw / 2, y, dw, step, mixHex(biome.roadLine, biome.fog, fog), 0.85);
    }

    // Lane hints toward the edges — subtle, they mostly read as wear.
    if (s > 8) {
      const ew = Math.max(step, 0.07 * s);
      p.rect(lx + sw * 0.2, y, ew, step, mixHex(biome.roadLine, biome.fog, fog), 0.28);
      p.rect(rx - sw * 0.2 - ew, y, ew, step, mixHex(biome.roadLine, biome.fog, fog), 0.28);
    }
  }
}

// ---------------------------------------------------------------------------
// Side dressing that lives in world space
// ---------------------------------------------------------------------------

export function drawTrackside(p: Painter, biome: BiomeDef, cam: Camera, time: number): void {
  const nearZ = cam.z + 1.2;
  const farZ = cam.z + 105;

  // Rail posts march down both shoulders at a fixed spacing.
  const spacing = 2.4;
  const first = Math.ceil(nearZ / spacing) * spacing;
  for (let z = farZ; z > first; z -= spacing) {
    const s = cam.scaleAt(z);
    if (s < 0.7) continue;
    const fog = clamp((z - cam.z - 10) / 110, 0, 1);
    const h = 0.95 * s;
    for (const side of [-1, 1] as const) {
      const x = side * (ROAD_HALF + 0.42);
      const sx = cam.screenX(x, z);
      if (sx < -60 || sx > cam.width + 60) continue;
      const sy = cam.groundY(z);
      p.sprite(SPR_RAIL_POST, sx, sy, h, {
        tint: mixHex(biome.railColor, biome.fog, fog),
        variant: `r${(fog * 8) | 0}`,
      });
    }
  }

  // A continuous top rail connecting the posts.
  for (const side of [-1, 1] as const) {
    const x = side * (ROAD_HALF + 0.42);
    let prevX = cam.screenX(x, farZ);
    let prevY = cam.groundY(farZ) - 0.9 * cam.scaleAt(farZ);
    const stepZ = 2.2;
    for (let z = farZ - stepZ; z > nearZ; z -= stepZ) {
      const s = cam.scaleAt(z);
      const sx = cam.screenX(x, z);
      const sy = cam.groundY(z) - 0.9 * s;
      const fog = clamp((z - cam.z - 10) / 110, 0, 1);
      p.line(prevX, prevY, sx, sy, Math.max(1, s * 0.075), mixHex(biome.railColor, biome.fog, fog), 1);
      prevX = sx;
      prevY = sy;
    }
  }

  // Scattered scenery keyed off a hash of the integer depth, so it is stable
  // as the camera advances and never pops.
  const propSpacing = 5;
  const startIdx = Math.floor(nearZ / propSpacing);
  const endIdx = Math.ceil(farZ / propSpacing);
  for (let i = endIdx; i >= startIdx; i--) {
    const z = i * propSpacing + hash2(i, 1, 3) * 3.4;
    if (z < nearZ || z > farZ) continue;
    const s = cam.scaleAt(z);
    if (s < 0.8) continue;
    const roll = hash2(i, 2, 3);
    if (roll > 0.72) continue;
    const side = hash2(i, 3, 3) < 0.5 ? -1 : 1;
    const x = side * (ROAD_HALF + 1.5 + hash2(i, 4, 3) * 5.5);
    const sx = cam.screenX(x, z);
    if (sx < -80 || sx > cam.width + 80) continue;
    const sy = cam.groundY(z);
    const fog = clamp((z - cam.z - 10) / 110, 0, 1);
    const tint = fog > 0.12 ? mixHex('#ffffff', biome.fog, 0.001) : undefined;
    const size = s * (0.9 + hash2(i, 5, 3) * 1.1);

    switch (biome.id) {
      case 'bridge':
        if (roll < 0.22) p.sprite(SPR_FENCE, sx, sy, size * 0.8, { alpha: 1 - fog * 0.5 });
        else if (roll < 0.4) p.sprite(SPR_PALM, sx, sy, size * 1.6, { alpha: 1 - fog * 0.5 });
        else p.sprite(SPR_ROCK, sx, sy, size * 0.7, { alpha: 1 - fog * 0.5, tint });
        break;
      case 'foundry':
        if (roll < 0.3) p.sprite(SPR_GRATE, sx, sy, size * 0.5, { alpha: 1 - fog * 0.5 });
        else if (roll < 0.5) p.sprite(SPR_FENCE, sx, sy, size * 0.9, { alpha: 1 - fog * 0.5 });
        else p.sprite(SPR_TOWER, sx, sy, size * 2.6, { alpha: 1 - fog * 0.5 });
        break;
      case 'tundra':
        p.sprite(roll < 0.4 ? SPR_PINE : SPR_ROCK, sx, sy, size * 1.4, { alpha: 1 - fog * 0.5 });
        break;
      case 'dunes':
        p.sprite(roll < 0.4 ? SPR_CACTUS : SPR_ROCK, sx, sy, size * 1.2, { alpha: 1 - fog * 0.5 });
        break;
      case 'neon':
        p.sprite(SPR_TOWER, sx, sy, size * 3.2, { alpha: 1 - fog * 0.5 });
        break;
      default:
        p.sprite(SPR_CRYSTAL, sx, sy, size * 1.3, { alpha: 1 - fog * 0.5 });
    }
  }

  // Overhead gantries every so often, like the reference bridge.
  const gantrySpacing = 42;
  const gantryNear = cam.z + 16;
  for (let i = Math.ceil(gantryNear / gantrySpacing); i <= Math.floor(farZ / gantrySpacing); i++) {
    const z = i * gantrySpacing;
    if (z < gantryNear) continue;
    const s = cam.scaleAt(z);
    if (s < 1.4) continue;
    const sx = cam.screenX(0, z);
    const fog = clamp((z - cam.z - 10) / 110, 0, 1);
    // Anchored on the ground: the sprite's own legs carry it over the road.
    p.sprite(SPR_GANTRY, sx, cam.groundY(z), 5.6 * s, { alpha: 1 - fog * 0.4 });
  }

  // Ambient motes drifting through the near field.
  if (biome.moteRate > 0) {
    const n = Math.round(biome.moteRate * 12);
    for (let i = 0; i < n; i++) {
      const seed = i * 29;
      const life = 3.5;
      const t = wrap(time * 0.6 + hash1(seed, 61), 1);
      const z = cam.z + 3 + hash1(seed, 62) * 40;
      const s = cam.scaleAt(z);
      const x = (hash1(seed, 63) * 2 - 1) * (ROAD_HALF + 7);
      const y = (biome.id === 'tundra' ? (1 - t) * 7 : t * 6) + hash1(seed, 64) * 2;
      const sx = cam.screenX(x, z) + Math.sin(time * 1.6 + i) * s * 0.15;
      const sy = cam.groundY(z) - y * s;
      const sz = Math.max(1, s * 0.045);
      p.rect(sx, sy, sz, sz, biome.moteColor, 0.35 + 0.35 * Math.sin(time * 3 + i));
      void life;
    }
  }
}
