import type { Gesture, SessionResult } from "./types.ts";

export class SessionClock {
  perSlide: number[];
  commands: Record<Gesture, number> = { next: 0, previous: 0, toggle: 0 };
  corrections: Record<string, number> = {};
  private activeSlide: number;
  private lastTick: number;
  running = true;
  constructor(slideCount: number, activeSlide: number, time: number) {
    this.perSlide = Array(slideCount).fill(0);
    this.activeSlide = activeSlide;
    this.lastTick = time;
  }
  tick(time: number) {
    if (this.running)
      this.perSlide[this.activeSlide] += Math.max(0, time - this.lastTick);
    this.lastTick = time;
  }
  changeSlide(index: number, time: number) {
    this.tick(time);
    this.activeSlide = index;
  }
  pause(time: number) {
    this.tick(time);
    this.running = false;
  }
  resume(time: number) {
    this.lastTick = time;
    this.running = true;
  }
  get duration() {
    return this.perSlide.reduce((sum, value) => sum + value, 0);
  }
  result(
    meta: Omit<
      SessionResult,
      "duration" | "perSlide" | "commands" | "corrections"
    >,
    time: number,
  ): SessionResult {
    this.tick(time);
    this.running = false;
    return {
      ...meta,
      duration: this.duration,
      perSlide: [...this.perSlide],
      commands: { ...this.commands },
      corrections: { ...this.corrections },
    };
  }
}
