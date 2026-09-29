import type { Feedback, Gesture, Point } from "./types.ts";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function isVisibleHand(hand: Point[]) {
  return hand.length >= 21 && hand.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) && distance(hand[0], hand[9]) > .015;
}
export function isOpenPalm(hand: Point[]) {
  if (!isVisibleHand(hand)) return false;
  // One slightly bent finger should not reject an otherwise open palm.
  return [8, 12, 16, 20].filter(tip =>
    distance(hand[tip], hand[0]) > distance(hand[tip - 2], hand[0]) * 1.10,
  ).length >= 3;
}
export function palmSize(hand: Point[]) {
  return Math.max(distance(hand[0], hand[9]), distance(hand[5], hand[17]), .04);
}
export function releasedPalm(hands: Point[][], referenceY?: number) {
  const open = hands.filter(isOpenPalm);
  return open.length === 0 || (referenceY !== undefined && open.every(hand => hand[9].y - referenceY > Math.max(.065, palmSize(hand) * .65)));
}

/** Coordinates are mirrored to match the silhouette, so right means screen-right. */
export class GestureEngine {
  private anchor: { x: number; y: number; time: number } | null = null;
  private cooldownUntil = 0;
  private releaseRequired = false;
  private releaseSince: number | null = null;
  private lastHand: Point | null = null;
  private missingSince: number | null = null;
  private currentHint = "";
  private hintSince = 0;
  private sensitivity = 0.85;
  private releaseY: number | undefined;
  private unlockGraceUntil = 0;
  /** Latest frame metrics for the diagnostics panel. */
  debug = {
    hands: 0,
    open: 0,
    scale: 0,
    dx: 0,
    dy: 0,
    elapsed: 0,
    threshold: 0,
    locked: false,
  };

  reset() {
    this.anchor = null;
    this.cooldownUntil = 0;
    this.releaseRequired = false;
    this.releaseSince = null;
    this.lastHand = null;
    this.missingSince = null;
    this.currentHint = "";
    this.hintSince = 0;
    this.releaseY = undefined;
    this.unlockGraceUntil = 0;
  }
  setSensitivity(value: number) {
    this.sensitivity = value;
  }

  update(
    _pose: Point[],
    hands: Point[][],
    time: number,
    locked: boolean,
  ): Feedback {
    const idle = {
      kind: "idle",
      message: locked ? "Жесты заблокированы · удержи ладонь, чтобы включить" : "Покажи открытую ладонь камере",
    } as Feedback;
    const visible = hands.filter(isVisibleHand);
    const open = visible.filter(isOpenPalm);
    this.debug.hands = visible.length;
    this.debug.open = open.length;
    this.debug.locked = locked;
    // While a gesture is in progress the same hand keeps the anchor: a second
    // hand moving nearby must not steal it and smear the measurement.
    const candidate = open.sort((a, b) =>
      this.anchor
        ? distance(a[9], this.anchor) - distance(b[9], this.anchor)
        : this.lastHand
          ? distance(a[9], this.lastHand) - distance(b[9], this.lastHand)
          : a[9].y - b[9].y,
    )[0];

    if (time < this.cooldownUntil)
      return { kind: "idle", message: "Команда принята" };
    if (this.releaseRequired) {
      if (releasedPalm(visible, this.releaseY)) {
        this.releaseSince ??= time;
        if (time - this.releaseSince > 300) {
          this.releaseRequired = false;
          this.releaseSince = null;
          this.lastHand = null;
        }
      } else this.releaseSince = null;
      return { kind: "idle", message: "Расслабь пальцы или немного опусти ладонь" };
    }
    if (!candidate) {
      if (!visible.length) this.missingSince ??= time;
      const attempted = this.anchor;
      this.anchor = null;
      this.lastHand = null;
      // While locked, mistakes and hints are noise: the speaker is just talking.
      if (locked) return idle;
      if (
        attempted &&
        time - attempted.time > 200 &&
        time - attempted.time < 1400
      )
        return {
          kind: "error",
          code: "lost-hand",
          message: "Держи ладонь целиком в кадре до конца движения",
        };
      if (visible.length > 0)
        return this.hint("palm", "Раскрой ладонь: выпрями четыре пальца", time);
      this.missingSince ??= time;
      if (time - this.missingSince > 1100) return { kind: "error", code: "lost-hand", message: "Покажи ладонь целиком в кадре" };
      return idle;
    }
    this.missingSince = null;
    const scale = palmSize(candidate);
    const span = Math.max(.13, scale * 2);
    const wrist = candidate[9];
    if (scale <= .045) {
      this.anchor = null;
      if (locked) return idle;
      return this.hint(
        "far",
        "Ладонь слишком далеко — подойди ближе к камере",
        time,
      );
    }
    if (
      [candidate[0], candidate[9]].some(
        (point) =>
          point.x < 0.05 ||
          point.x > 0.95 ||
          point.y < 0.015 ||
          point.y > 0.985,
      )
    ) {
      this.anchor = null;
      if (locked) return idle;
      return this.hint(
        "edge",
        "Отведи руку от края кадра, чтобы вся ладонь была видна",
        time,
      );
    }
    this.currentHint = "";
    if (this.lastHand && distance(wrist, this.lastHand) > span * 1.7)
      this.anchor = null;
    this.lastHand = { ...wrist };
    this.anchor ??= { x: wrist.x, y: wrist.y, time };
    let dx = wrist.x - this.anchor.x;
    let dy = wrist.y - this.anchor.y;
    let elapsed = time - this.anchor.time;
    const threshold = Math.max(.06, Math.min(.26, scale * 1.1 * this.sensitivity / .85));
    const verticalTolerance = Math.max(.045, threshold * .7);
    const holdLimit = Math.max(.035, scale * .55);
    this.debug = {
      hands: visible.length,
      open: open.length,
      scale,
      dx,
      dy,
      elapsed,
      threshold,
      locked,
    };
    if (locked) {
      // While gestures are locked only one thing matters: a deliberate still hold.
      // Free gesturing must stay silent instead of flashing hints and errors.
      if (Math.hypot(dx, dy) > holdLimit) {
        this.anchor = { x: wrist.x, y: wrist.y, time };
        return idle;
      }
      if (elapsed >= 1500) {
        const feedback = this.command("toggle", time);
        this.unlockGraceUntil = time + 1600;
        return feedback;
      }
      return {
        kind: "progress",
        message: "Удерживай ладонь · включение жестов",
        progress: Math.min(1, elapsed / 1500),
      };
    }
    // Right after unlocking, do not let the same pose flip the lock back.
    if (time < this.unlockGraceUntil) {
      this.anchor = { x: wrist.x, y: wrist.y, time };
      return { kind: "idle", message: "Жесты включены" };
    }
    if (this.anchor.time < this.unlockGraceUntil) {
      this.anchor = { x: wrist.x, y: wrist.y, time };
      dx = 0;
      dy = 0;
      elapsed = 0;
    }
    this.debug.dx = dx;
    this.debug.dy = dy;
    this.debug.elapsed = elapsed;
    // Swipes follow the horizontal projection: a natural arc must not cancel them.
    const horizontal = Math.abs(dx);
    const vertical = Math.abs(dy);
    const movement = Math.hypot(dx, dy);
    if (horizontal >= threshold && elapsed >= 80 && elapsed <= 2500)
      return this.command(dx > 0 ? "next" : "previous", time);
    if (vertical > verticalTolerance && horizontal < threshold * .35 && elapsed > 550) {
      this.anchor = { x: wrist.x, y: wrist.y, time };
      return {
        kind: "error",
        code: "horizontal",
        message: "Веди руку горизонтально, на одной высоте",
      };
    }
    if (movement > holdLimit) {
      if (elapsed > 1400) {
        this.anchor = { x: wrist.x, y: wrist.y, time };
        return {
          kind: "error",
          code: "wider",
          message: `Проведи рукой дальше ${dx >= 0 ? "вправо" : "влево"} за одно движение`,
        };
      }
      return {
        kind: "progress",
        message: `Продолжай движение ${dx >= 0 ? "вправо" : "влево"}`,
        progress: Math.min(1, horizontal / threshold),
      };
    }
    if (elapsed >= 1500) return this.command("toggle", time);
    return {
      kind: "progress",
      message: "Удерживай ладонь · блокировка жестов",
      progress: Math.min(1, elapsed / 1500),
    };
  }

  private command(gesture: Gesture, time: number): Feedback {
    this.anchor = null;
    this.cooldownUntil = time + 700;
    this.releaseRequired = gesture === "toggle";
    this.releaseY = this.lastHand?.y;
    this.releaseSince = null;
    return {
      kind: "success",
      gesture,
      message:
        gesture === "next"
          ? "Следующий слайд"
          : gesture === "previous"
            ? "Предыдущий слайд"
            : "Управление переключено",
    };
  }
  private hint(code: string, message: string, time: number): Feedback {
    if (this.currentHint !== code) {
      this.currentHint = code;
      this.hintSince = time;
    }
    return time - this.hintSince > 550
      ? { kind: "error", code, message }
      : { kind: "idle", message: "Проверяю ладонь…" };
  }
}
