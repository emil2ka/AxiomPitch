import type { Feedback, Gesture, Point } from "./types.ts";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function isOpenPalm(hand: Point[]) {
  if (hand.length < 21) return false;
  return [8, 12, 16, 20].every(
    (tip) =>
      distance(hand[tip], hand[0]) > distance(hand[tip - 2], hand[0]) * 1.16,
  );
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

  reset() {
    this.anchor = null;
    this.cooldownUntil = 0;
    this.releaseRequired = false;
    this.releaseSince = null;
    this.lastHand = null;
    this.missingSince = null;
    this.currentHint = "";
    this.hintSince = 0;
  }
  setSensitivity(value: number) {
    this.sensitivity = value;
  }

  update(
    pose: Point[],
    hands: Point[][],
    time: number,
    locked: boolean,
  ): Feedback {
    const idle = {
      kind: "idle",
      message: locked
        ? "Жесты заблокированы · ладонь — включить"
        : "Подними открытую ладонь до плеча",
    } as Feedback;
    if (
      pose.length < 13 ||
      (pose[11].visibility ?? 1) < 0.55 ||
      (pose[12].visibility ?? 1) < 0.55
    ) {
      this.anchor = null;
      this.lastHand = null;
      this.missingSince ??= time;
      if (time - this.missingSince > 1100)
        return {
          kind: "error",
          code: "frame",
          message: "Отойди от камеры: голова и плечи должны быть в кадре",
        };
      return { kind: "idle", message: "Ищу тебя в кадре…" };
    }
    this.missingSince = null;
    const shoulderY = (pose[11].y + pose[12].y) / 2;
    const span = Math.max(0.13, Math.abs(pose[11].x - pose[12].x));
    const raised = hands.filter(
      (hand) => hand.length >= 21 && hand[9].y < shoulderY + 0.05,
    );
    const open = raised.filter(isOpenPalm);
    const candidate = open.sort((a, b) =>
      this.lastHand
        ? distance(a[9], this.lastHand) - distance(b[9], this.lastHand)
        : a[9].y - b[9].y,
    )[0];

    if (time < this.cooldownUntil)
      return { kind: "idle", message: "Команда принята · опусти руку" };
    if (this.releaseRequired) {
      if (!candidate) {
        this.releaseSince ??= time;
        if (time - this.releaseSince > 300) {
          this.releaseRequired = false;
          this.releaseSince = null;
          this.lastHand = null;
        }
      } else this.releaseSince = null;
      return { kind: "idle", message: "Опусти руку перед следующей командой" };
    }
    if (!candidate) {
      const attempted = this.anchor;
      this.anchor = null;
      this.lastHand = null;
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
      if (raised.length > 0)
        return this.hint("palm", "Раскрой ладонь: выпрями четыре пальца", time);
      return idle;
    }
    const wrist = candidate[9];
    if (
      candidate.some(
        (point) =>
          point.x < 0.025 ||
          point.x > 0.975 ||
          point.y < 0.025 ||
          point.y > 0.975,
      )
    ) {
      this.anchor = null;
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
    const dx = wrist.x - this.anchor.x;
    const dy = wrist.y - this.anchor.y;
    const elapsed = time - this.anchor.time;
    const threshold = span * this.sensitivity;
    const movement = Math.hypot(dx, dy);
    if (
      !locked &&
      Math.abs(dx) >= threshold &&
      Math.abs(dy) < span * 0.45 &&
      elapsed >= 100 &&
      elapsed <= 1200
    ) {
      return this.command(dx > 0 ? "next" : "previous", time);
    }
    if (Math.abs(dy) > span * 0.45) {
      this.anchor = { x: wrist.x, y: wrist.y, time };
      return {
        kind: "error",
        code: "horizontal",
        message: "Веди руку горизонтально, на одной высоте",
      };
    }
    if (movement > span * 0.13) {
      if (elapsed > 1100) {
        this.anchor = { x: wrist.x, y: wrist.y, time };
        return {
          kind: "error",
          code: locked ? "steady" : "wider",
          message: locked
            ? "Останови ладонь и держи её неподвижно"
            : `Проведи рукой дальше ${dx >= 0 ? "вправо" : "влево"} за одно движение`,
        };
      }
      return {
        kind: "progress",
        message: locked
          ? "Останови ладонь, чтобы включить жесты"
          : `Продолжай движение ${dx >= 0 ? "вправо" : "влево"}`,
        progress: Math.min(1, Math.abs(dx) / threshold),
      };
    }
    if (elapsed >= 1500) return this.command("toggle", time);
    return {
      kind: "progress",
      message: locked
        ? "Удерживай ладонь · включение жестов"
        : "Удерживай ладонь · блокировка жестов",
      progress: Math.min(1, elapsed / 1500),
    };
  }

  private command(gesture: Gesture, time: number): Feedback {
    this.anchor = null;
    this.cooldownUntil = time + 700;
    this.releaseRequired = true;
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
