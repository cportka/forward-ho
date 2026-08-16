/**
 * Unified pointer / touch / keyboard / gamepad input.
 *
 * The game only really needs one axis (steer left-right) plus a "tap" and a
 * few UI buttons, so this collapses everything into a normalised steer value
 * and a small set of edge-triggered flags.
 */

import { clamp, damp } from './math';

export interface PointerState {
  down: boolean;
  /** Position in CSS pixels relative to the canvas. */
  x: number;
  y: number;
  /** Where this drag started. */
  startX: number;
  startY: number;
  /** Movement since last frame, CSS pixels. */
  dx: number;
  dy: number;
  /** True on the frame the pointer went down / up. */
  pressed: boolean;
  released: boolean;
  /** A press+release inside the tap threshold. */
  tapped: boolean;
  tapX: number;
  tapY: number;
}

export class Input {
  readonly pointer: PointerState = {
    down: false,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
    pressed: false,
    released: false,
    tapped: false,
    tapX: 0,
    tapY: 0,
  };

  /** Smoothed steering in [-1, 1]. */
  steer = 0;
  /** Raw target steering before smoothing. */
  steerTarget = 0;
  /** Set by the debug hook to override human input. */
  scriptedSteer: number | null = null;

  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private pendingDx = 0;
  private downTime = 0;
  private moved = 0;
  private activeId = -1;
  private anyInteraction = false;

  /** Drag sensitivity: fraction of canvas width for a full-lane sweep. */
  dragSpan = 0.34;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const c = canvas;
    c.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp, { passive: false });
    window.addEventListener('pointercancel', this.onUp, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointer.down = false;
    });
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    if (this.pointer.down) return;
    e.preventDefault();
    this.activeId = e.pointerId;
    const { x, y } = this.local(e);
    const p = this.pointer;
    p.down = true;
    p.pressed = true;
    p.x = p.startX = x;
    p.y = p.startY = y;
    p.dx = 0;
    p.dy = 0;
    this.downTime = performance.now();
    this.moved = 0;
    this.anyInteraction = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.pointer.down || e.pointerId !== this.activeId) return;
    e.preventDefault();
    const { x, y } = this.local(e);
    const p = this.pointer;
    this.pendingDx += x - p.x;
    p.dy += y - p.y;
    this.moved += Math.abs(x - p.x) + Math.abs(y - p.y);
    p.x = x;
    p.y = y;
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId) return;
    const p = this.pointer;
    if (!p.down) return;
    p.down = false;
    p.released = true;
    const dt = performance.now() - this.downTime;
    if (this.moved < 14 && dt < 420) {
      p.tapped = true;
      p.tapX = p.x;
      p.tapY = p.y;
    }
    this.activeId = -1;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.keys.add(k);
    this.justPressed.add(k);
    this.anyInteraction = true;
    if (
      k === ' ' ||
      k === 'ArrowLeft' ||
      k === 'ArrowRight' ||
      k === 'ArrowUp' ||
      k === 'ArrowDown'
    ) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.keys.delete(k);
  };

  held(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  pressed(...codes: string[]): boolean {
    for (const c of codes) if (this.justPressed.has(c)) return true;
    return false;
  }

  /** True once, after the first real user interaction (used to unlock audio). */
  consumeInteraction(): boolean {
    if (!this.anyInteraction) return false;
    this.anyInteraction = false;
    return true;
  }

  update(dt: number, cssWidth: number): void {
    const p = this.pointer;
    p.dx = this.pendingDx;
    this.pendingDx = 0;

    if (this.scriptedSteer !== null) {
      this.steerTarget = clamp(this.scriptedSteer, -1, 1);
      this.steer = damp(this.steer, this.steerTarget, 14, dt);
      return;
    }

    let target = 0;
    let usingKeys = false;
    if (this.held('a', 'ArrowLeft')) {
      target -= 1;
      usingKeys = true;
    }
    if (this.held('d', 'ArrowRight')) {
      target += 1;
      usingKeys = true;
    }

    if (!usingKeys && p.down) {
      // Absolute-ish drag: the squad tracks the finger, scaled so a short
      // swipe crosses the lane. Feels right on phones and mice alike.
      const span = Math.max(60, cssWidth * this.dragSpan);
      target = clamp((p.x - cssWidth * 0.5) / span, -1, 1);
    } else if (!usingKeys) {
      target = this.steerTarget * 0.5;
    }

    this.steerTarget = target;
    this.steer = damp(this.steer, target, usingKeys ? 11 : 17, dt);
  }

  /** Clears edge-triggered flags. Call at the very end of a frame. */
  endFrame(): void {
    const p = this.pointer;
    p.pressed = false;
    p.released = false;
    p.tapped = false;
    p.dy = 0;
    this.justPressed.clear();
  }
}
