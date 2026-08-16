/** Bootstrap: canvas sizing, the fixed-step loop, and the debug hook. */

import { Input } from './core/input';
import { PixelStage } from './render/pixelbuffer';
import { Game } from './game/game';
import { audio } from './game/audio';
import { drawGallery, galleryRequested } from './dev/gallery';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('missing #game canvas');

const stage = new PixelStage(canvas);
const input = new Input(canvas);
let game: Game | null = null;

function fitStage(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (stage.resize(w, h, window.devicePixelRatio || 1)) {
    game?.resize();
  }
}

fitStage();
game = new Game(stage);
game.resize();

window.addEventListener('resize', fitStage);
window.addEventListener('orientationchange', () => setTimeout(fitStage, 120));

// Audio can only start from a gesture, so latch onto the first interaction.
function unlockAudio(): void {
  audio.init();
  audio.unlock();
  if (!audio.muted) audio.setMusic('menu');
}
for (const evt of ['pointerdown', 'keydown', 'touchstart'] as const) {
  window.addEventListener(evt, unlockAudio, { once: true, passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend();
  else audio.resume();
});

const MAX_STEP = 1 / 30;
let last = performance.now();
let accumulatedFast = 0;

function frame(now: number): void {
  const raw = (now - last) / 1000;
  last = now;
  let dt = Math.min(MAX_STEP, Math.max(0, raw));

  // Debug fast-forward: burn extra simulated time in bounded chunks.
  if (accumulatedFast > 0) {
    const chunk = Math.min(accumulatedFast, 0.5);
    accumulatedFast -= chunk;
    let left = chunk;
    while (left > 0) {
      const step = Math.min(1 / 60, left);
      left -= step;
      input.update(step, stage.cssWidth);
      game!.update(step, input);
    }
  }

  input.update(dt, stage.cssWidth);
  game!.update(dt, input);
  audio.update(dt);

  if (galleryRequested()) {
    stage.clearAll();
    drawGallery(stage);
    stage.composite();
  } else {
    game!.draw(input, stage.cssWidth, stage.cssHeight);
  }

  input.endFrame();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

document.getElementById('boot')?.classList.add('gone');
setTimeout(() => document.getElementById('boot')?.remove(), 500);

// ---------------------------------------------------------------------------
// Debug hook used by tools/screenshot.mjs
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __FH_READY?: boolean;
    __FH?: {
      ready: boolean;
      startRun(levelIndex?: number): void;
      setSteer(x: number): void;
      state(): Record<string, unknown>;
      seed(n: number): void;
      fastForward(seconds: number): void;
      screen(name: string): void;
      stage(): { width: number; height: number; unit: number };
    };
  }
}

window.__FH = {
  ready: true,
  startRun(levelIndex = 0) {
    game!.startRun(levelIndex);
  },
  setSteer(x: number) {
    input.scriptedSteer = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : null;
  },
  state() {
    return game!.snapshot();
  },
  seed(n: number) {
    game!.setSeed(n);
  },
  fastForward(seconds: number) {
    accumulatedFast += Math.max(0, Math.min(60, seconds));
  },
  screen(name: string) {
    game!.showScreen(name as Parameters<Game['showScreen']>[0]);
  },
  stage() {
    return { width: stage.width, height: stage.height, unit: stage.unit };
  },
};
window.__FH_READY = true;
