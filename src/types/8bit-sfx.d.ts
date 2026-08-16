declare module '8bit-sfx' {
  /** Mono samples in [-1, 1) at 22050 Hz, synthesised deterministically from the name. */
  export function render(name: string): Float32Array;
  export function renderPcm(name: string): Uint8Array;
  export function renderWav(name: string): Uint8Array;
  export function describe(name: string): string;
  export function duration(name: string): number;
  export function effectNames(): string[];
  export const CATEGORIES: readonly string[];
  export const COUNT: number;
}
