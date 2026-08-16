/** Top-level state machine: attract mode, menus, the run, and results. */

import { clamp } from '../core/math';
import type { Input } from '../core/input';
import type { PixelStage } from '../render/pixelbuffer';
import { beginUi, endUi, makeUiContext, type UiContext } from '../ui/ui';
import { drawHud } from '../ui/hud';
import {
  drawBarracks, drawHelp, drawLevels, drawPause, drawResults, drawTitle,
  type DeployContext, type ResultsData, type ScreenAction,
} from '../ui/screens';
import { audio } from './audio';
import { sfxBankStatus } from './sfxbank';
import { Meta } from './progression';
import { World } from './world';
import { CAMPAIGN_LENGTH } from './levels';

export type GameState = 'title' | 'levels' | 'barracks' | 'help' | 'playing' | 'paused' | 'results';

export class Game {
  readonly meta = new Meta();
  readonly world = new World();
  /** A second world runs behind the menus so the title screen is never static. */
  readonly attract = new World();

  state: GameState = 'title';
  private ui: UiContext;
  private results: ResultsData | null = null;
  private revealT = 0;
  private levelIndex = 0;
  private seed = 0x5eed1234;
  private attractTimer = 0;
  private transition = 1;
  private pendingState: GameState | null = null;
  /** Last UI action applied — surfaced in the debug snapshot. */
  private lastAction = 'none';
  /** Set while the barracks is acting as the between-levels staging screen. */
  private deploy: DeployContext | null = null;
  /** Counts down on the results screen, then hands over to the barracks. */
  private resultsDwell = 0;

  constructor(private readonly stage: PixelStage) {
    this.ui = makeUiContext(stage.layers.ui, stage.width, stage.height);
    audio.setMuted(this.meta.state.muted);
    this.startAttract();
  }

  private startAttract(): void {
    this.attract.resize(this.stage.width, this.stage.height);
    this.attract.start((this.seed >>> 3) % CAMPAIGN_LENGTH, this.seed ^ 0x9e37, this.meta);
    this.attractTimer = 0;
  }

  resize(): void {
    this.world.resize(this.stage.width, this.stage.height);
    this.attract.resize(this.stage.width, this.stage.height);
  }

  setSeed(n: number): void {
    this.seed = n >>> 0;
  }

  /** Debug/testing entry point: jump straight to a screen. */
  showScreen(name: GameState): void {
    this.pendingState = null;
    this.transition = 1;
    this.state = name;
  }

  startRun(levelIndex: number): void {
    this.deploy = null;
    this.levelIndex = clamp(levelIndex, 0, 98);
    this.world.resize(this.stage.width, this.stage.height);
    this.world.start(this.levelIndex, this.seed, this.meta);
    this.state = 'playing';
    this.results = null;
    this.revealT = 0;
    audio.setMusic('run');
    audio.sfx('levelStart');
  }

  private goto(next: GameState): void {
    // Idempotent: a repeated request for the same screen must not restart the
    // wipe, or a per-frame trigger (like the results auto-advance) pins the
    // transition at zero and the screen never actually changes.
    if (this.pendingState === next) return;
    this.pendingState = next;
    this.transition = 0;
  }

  private applyAction(a: ScreenAction): void {
    this.lastAction = a.type === 'goto' ? `goto:${a.screen}` : a.type;
    switch (a.type) {
      case 'play':
        audio.sfx('uiClick');
        this.startRun(a.level);
        break;
      case 'goto':
        audio.sfx('uiClick');
        this.goto(a.screen as GameState);
        break;
      case 'back':
        audio.sfx('uiBack');
        this.deploy = null;
        this.goto('title');
        break;
      case 'buy':
        if (this.meta.buy(a.id)) audio.sfx('weaponUp', { vol: 0.5 });
        else audio.sfx('uiBack');
        break;
      case 'toggleMute': {
        const m = audio.toggleMuted();
        this.meta.state.muted = m;
        this.meta.save();
        break;
      }
      case 'resume':
        audio.sfx('uiClick');
        this.state = 'playing';
        break;
      case 'restart':
        audio.sfx('uiClick');
        this.startRun(this.levelIndex);
        break;
      case 'quit':
        audio.sfx('uiBack');
        this.deploy = null;
        this.goto('title');
        audio.setMusic('menu');
        break;
      case 'next':
        audio.sfx('uiClick');
        this.startRun(this.levelIndex + 1);
        break;
      case 'wipe':
        this.meta.wipe();
        audio.sfx('uiBack');
        break;
      case 'none':
        break;
    }
  }

  update(dt: number, input: Input): void {
    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + dt * 3.6);
      if (this.pendingState && this.transition > 0.5) {
        this.state = this.pendingState;
        this.pendingState = null;
      }
    }

    const menuish = this.state !== 'playing' && this.state !== 'paused';

    if (menuish) {
      // Attract world: gentle scripted steering, restarted whenever it ends.
      this.attractTimer += dt;
      const steer = Math.sin(this.attractTimer * 0.55) * 0.85 + Math.sin(this.attractTimer * 1.7) * 0.18;
      this.attract.update(dt, clamp(steer, -1, 1), Math.sin(this.attractTimer * 0.37) * 0.55);
      if (this.attract.phase !== 'running' && this.attract.readyToScore) {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        this.startAttract();
      }
    }

    if (this.state === 'playing') {
      if (input.pressed('Escape', 'p')) {
        this.state = 'paused';
        audio.sfx('uiBack');
      }
      this.world.update(dt, input.steer, input.push);
      if (this.world.phase !== 'running' && this.world.readyToScore) this.finishRun();
    } else if (this.state === 'paused') {
      if (input.pressed('Escape', 'p')) {
        this.state = 'playing';
        audio.sfx('uiClick');
      }
    } else if (this.state === 'results') {
      this.revealT = Math.min(1, this.revealT + dt * 0.9);
      if (this.results) this.results.reveal = this.revealT;
      // Once the tally has finished counting, the barracks comes up on its own
      // so every level ends with a chance to spend what you just earned.
      if (this.revealT >= 1) {
        this.resultsDwell -= dt;
        if (this.resultsDwell <= 0) {
          audio.sfx('uiClick');
          this.goto('barracks');
        }
      }
    }
  }

  private finishRun(): void {
    const w = this.world;
    const cleared = w.phase === 'clear';
    const bonus = cleared ? 60 + this.levelIndex * 25 + Math.floor(w.stats.peakTroops * 0.6) : Math.floor(w.stats.gold * 0.25);
    const goldEarned = w.stats.gold + bonus;
    this.meta.recordRun({
      cleared,
      level: this.levelIndex,
      troops: w.stats.peakTroops,
      score: w.stats.score,
      kills: w.stats.kills,
      gold: goldEarned,
    });
    this.results = {
      cleared,
      levelIndex: this.levelIndex,
      levelName: w.plan.name,
      stats: { ...w.stats },
      goldEarned,
      reveal: 0,
      hasNext: true,
    };
    this.revealT = 0;
    this.resultsDwell = 2.2;
    this.deploy = {
      cleared,
      levelName: w.plan.name,
      goldEarned,
      hasNext: true,
    };
    this.state = 'results';
    audio.setMusic(cleared ? 'victory' : 'menu');
  }

  draw(input: Input, cssW: number, cssH: number): void {
    const stage = this.stage;
    stage.clearAll();

    const inRun = this.state === 'playing' || this.state === 'paused' || this.state === 'results';
    const shownWorld = inRun ? this.world : this.attract;
    shownWorld.draw(stage);

    // Pointer position in device pixels for hit testing.
    const scaleX = stage.width / Math.max(1, cssW);
    const scaleY = stage.height / Math.max(1, cssH);
    beginUi(
      this.ui,
      stage.width, stage.height,
      input.pointer.x * scaleX, input.pointer.y * scaleY,
      input.pointer.down, input.pointer.pressed, input.pointer.released,
      shownWorld.time,
    );

    let action: ScreenAction = { type: 'none' };
    switch (this.state) {
      case 'title':
        action = drawTitle(this.ui, this.meta, audio.muted);
        break;
      case 'levels':
        action = drawLevels(this.ui, this.meta);
        break;
      case 'barracks':
        action = drawBarracks(this.ui, this.meta, this.deploy);
        break;
      case 'help':
        action = drawHelp(this.ui);
        break;
      case 'playing': {
        const r = drawHud(this.ui, this.world, audio.muted);
        if (r.pausePressed) {
          this.state = 'paused';
          audio.sfx('uiBack');
        }
        break;
      }
      case 'paused':
        drawHud(this.ui, this.world, audio.muted);
        action = drawPause(this.ui, audio.muted);
        break;
      case 'results':
        drawHud(this.ui, this.world, audio.muted);
        if (this.results) action = drawResults(this.ui, this.results);
        break;
    }
    endUi(this.ui);
    if (action.type !== 'none') this.applyAction(action);

    if (this.transition < 1) {
      const k = this.transition < 0.5 ? this.transition * 2 : (1 - this.transition) * 2;
      this.ui.p.rect(0, 0, stage.width, stage.height, '#05070d', k);
    }

    stage.composite();
  }

  snapshot(): Record<string, unknown> {
    const w = this.state === 'playing' || this.state === 'paused' || this.state === 'results' ? this.world : this.attract;
    const bank = sfxBankStatus();
    return {
      state: this.state,
      lastAction: this.lastAction,
      sfxBank: `${bank.loaded}/${bank.total}${bank.failed ? ' FAILED' : ''}`,
      gold: this.meta.state.gold,
      highestLevel: this.meta.state.highestLevel,
      ...w.snapshot(),
    };
  }
}
