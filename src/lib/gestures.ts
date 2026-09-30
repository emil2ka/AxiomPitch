import type { Feedback, Gesture, Point } from "./types.ts";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function isVisibleHand(hand: Point[]) {
  return (
    hand.length >= 21 &&
    hand.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ) &&
    distance(hand[0], hand[9]) > 0.015
  );
}
/** How many of the four long fingers are straightened away from the wrist. */
export function extendedFingers(hand: Point[]) {
  return [8, 12, 16, 20].filter(
    (tip) =>
      distance(hand[tip], hand[0]) > distance(hand[tip - 2], hand[0]) * 1.1,
  ).length;
}
export function isOpenPalm(hand: Point[]) {
  // One slightly bent finger should not reject an otherwise open palm.
  return isVisibleHand(hand) && extendedFingers(hand) >= 3;
}
export function palmSize(hand: Point[]) {
  return Math.max(
    distance(hand[0], hand[9]),
    distance(hand[5], hand[17]),
    0.04,
  );
}
export function releasedPalm(hands: Point[][], referenceY?: number) {
  const open = hands.filter(isOpenPalm);
  return (
    open.length === 0 ||
    (referenceY !== undefined &&
      open.every(
        (hand) =>
          hand[9].y - referenceY > Math.max(0.065, palmSize(hand) * 0.65),
      ))
  );
}

/** Camera-time budgets, in milliseconds. */
const SWIPE_WINDOW = 1000; // a swipe covers its distance within this time
const SWIPE_COOLDOWN = 400;
const TOGGLE_COOLDOWN = 700;
const HOLD_MS = 1500;
const UNLOCK_GRACE = 1600;
const TRACK_GAP = 250; // the detector may drop a hand for a few frames
const OPEN_GRACE = 300; // motion blur can make an open palm look bent mid-swipe
const RELEASE_MS = 300;
const RETURN_GUARD = 3000;
const STALL_MS = 250;
const FAR_PALM = 0.045;
const UPRIGHT_COS = Math.cos((65 * Math.PI) / 180);
const ALL_GESTURES: readonly Gesture[] = ["next", "previous", "toggle"];
/** The camera is requested at 1280×720; frames that report their size override this. */
export const DEFAULT_ASPECT = 16 / 9;

type Direction = 1 | -1;
type Sample = { t: number; x: number; y: number };
type Hand = Sample & {
  points: Point[];
  scale: number;
  open: boolean;
  /** Fingers roughly up (within 65°), the pose of a hand shown to the camera. */
  upright: boolean;
  /** Open and upright: only this hand can start a swipe or a hold. */
  ready: boolean;
  fingers: number;
};
type Swipe = {
  dir: Direction;
  start: Sample;
  disp: number;
  vert: number;
  progress: number;
  guarded: boolean;
  flat: boolean;
};

/**
 * Palm centre and size with x stretched by the frame aspect, so distances mean
 * the same thing horizontally and vertically on any camera.
 */
function measure(points: Point[], aspect: number, t: number): Hand {
  const ids = [0, 5, 9, 13, 17];
  const x = ids.reduce((sum, i) => sum + points[i].x, 0) / ids.length;
  const y = ids.reduce((sum, i) => sum + points[i].y, 0) / ids.length;
  const span = (a: Point, b: Point) =>
    Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const fingers = extendedFingers(points);
  // Talking hands mostly face up or sideways; a command is shown fingers-up.
  // A hand pointing at the camera is too foreshortened to tell, so it waits.
  const length = span(points[0], points[9]);
  const upright =
    length >= span(points[5], points[17]) * 0.5 &&
    points[0].y - points[9].y >= length * UPRIGHT_COS;
  return {
    t,
    x: x * aspect,
    y,
    points,
    scale: Math.max(length, span(points[5], points[17]), 0.04),
    open: fingers >= 3,
    upright,
    ready: fingers >= 3 && upright,
    fingers,
  };
}
const nearEdge = (points: Point[]) =>
  [points[0], points[9]].some(
    (point) =>
      point.x < 0.05 || point.x > 0.95 || point.y < 0.015 || point.y > 0.985,
  );

/**
 * Coordinates are mirrored to match the silhouette, so right means screen-right.
 *
 * A swipe is a horizontal move of about two palm lengths within one second,
 * measured on a sliding window of the followed hand. After a swipe the hand
 * travelling back to where it started is not a command; a hold only counts
 * once the hand has been lowered or relaxed since the last swipe.
 */
export class GestureEngine {
  private sensitivity = 0.85;
  private tracked: {
    x: number;
    y: number;
    scale: number;
    seen: number;
    since: number;
    openAt: number;
  } | null = null;
  private samples: Sample[] = [];
  private closedPath: Sample[] = [];
  private cooldownUntil = 0;
  /** The swipe that just fired; the same direction re-arms once it stops. */
  private stroke: { dir: Direction; extreme: Sample; grewAt: number } | null =
    null;
  /** The way back after a swipe; it fires only past the swipe's start. */
  private guard: {
    dir: Direction;
    startX: number;
    until: number;
    firedAt: number;
  } | null = null;
  private holdArmed = true;
  private hold: Sample | null = null;
  private releaseRequired = false;
  private releaseY: number | undefined;
  private releaseSince: number | null = null;
  private unlockGraceUntil = 0;
  private attempt: { dir: Direction; progress: number; grewAt: number } | null =
    null;
  private currentHint = "";
  private hintSince = 0;
  private wasLocked: boolean | null = null;
  private quietUntil = 0;
  /** Last time the speaker's own, near-enough hand was presented. */
  private presenterSeenAt = -Infinity;
  private last: Feedback | null = null;
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
    this.tracked = null;
    this.clearMotion();
    this.cooldownUntil = 0;
    this.holdArmed = true;
    this.releaseRequired = false;
    this.releaseY = undefined;
    this.releaseSince = null;
    this.unlockGraceUntil = 0;
    this.currentHint = "";
    this.hintSince = 0;
    this.wasLocked = null;
    this.last = null;
    this.quietUntil = 0;
    this.presenterSeenAt = -Infinity;
  }
  setSensitivity(value: number) {
    this.sensitivity = value;
  }

  update(
    _pose: Point[],
    hands: Point[][],
    time: number,
    locked: boolean,
    aspect = DEFAULT_ASPECT,
    allowedGestures: readonly Gesture[] = ALL_GESTURES,
  ): Feedback {
    if (!(Number.isFinite(aspect) && aspect > 0)) aspect = DEFAULT_ASPECT;
    if (this.wasLocked !== null && this.wasLocked !== locked)
      this.clearMotion();
    this.wasLocked = locked;
    const visible = hands
      .filter(isVisibleHand)
      .map((points) => measure(points, aspect, time));
    this.debug.hands = visible.length;
    this.debug.open = visible.filter((hand) => hand.open).length;
    this.debug.locked = locked;
    const idle: Feedback = {
      kind: "idle",
      message: locked
        ? "Жесты заблокированы · удержи ладонь, чтобы включить"
        : "Покажи открытую ладонь камере",
    };
    const canHold = allowedGestures.includes("toggle");
    const canSwipe = allowedGestures.includes("next") || allowedGestures.includes("previous");

    const { hand, lostMidSwipe } = this.follow(visible, time);
    if (lostMidSwipe && !locked)
      return {
        kind: "error",
        code: "lost-hand",
        message: "Держи ладонь целиком в кадре до конца движения",
      };
    if (!hand) {
      // A swipe often carries the hand out of the frame; when it comes back
      // the way it went, that is still the way back, not a new command.
      if (this.guard)
        this.guard.until = Math.min(
          this.guard.firedAt + 10000,
          Math.max(this.guard.until, time + 1000),
        );
      // Hands out of view are the normal state while talking, not a mistake.
      return this.tracked && this.last ? this.last : this.remember(idle);
    }

    const track = this.tracked!;
    if (hand.ready) track.openAt = time;
    if (hand.ready && track.scale >= FAR_PALM) this.presenterSeenAt = time;
    const open = hand.ready || time - track.openAt <= OPEN_GRACE;
    const threshold = Math.max(
      0.1,
      Math.min(0.45, (track.scale * 1.8 * this.sensitivity) / 0.85),
    );
    this.debug.scale = track.scale;
    this.debug.threshold = threshold;
    const sample: Sample = { t: time, x: hand.x, y: hand.y };
    this.watchRelease(hand, track.scale, time);

    if (time < this.cooldownUntil) {
      if (open) this.record(sample, threshold);
      return { kind: "idle", message: "Команда принята" };
    }
    if (this.releaseRequired)
      return this.remember({
        kind: "idle",
        message: "Расслабь пальцы или немного опусти ладонь",
      });
    if (!open) {
      this.samples = [];
      this.hold = null;
      this.attempt = null;
      this.stroke = null;
      if (locked) return this.remember(idle);
      if (hand.open)
        return this.remember({
          kind: "idle",
          message: "Поверни ладонь пальцами вверх",
        });
      return this.closedSwipe(hand, threshold, time) ?? this.remember(idle);
    }
    this.closedPath = [];
    if (track.scale < FAR_PALM) {
      this.samples = [];
      this.hold = null;
      // A small hand right after the speaker's own is someone at the back.
      if (locked || time - this.presenterSeenAt < 10000)
        return this.remember(idle);
      return this.hint(
        "far",
        "Ладонь слишком далеко — подойди ближе к камере",
        time,
      );
    }
    const atEdge = nearEdge(hand.points);
    if (locked) {
      // While locked only one thing matters: a deliberate still hold. Free
      // gesturing must stay silent instead of flashing hints and errors.
      if (atEdge || !canHold) {
        this.hold = null;
        return this.remember(idle);
      }
      return (
        this.holdStep(sample, time, true, track.scale) ?? this.remember(idle)
      );
    }

    // A lesson can ask for a hold without accepting swipes along the way.
    // Filter before firing: rejecting a command afterwards still consumes its
    // cooldown/release state and strands the next attempt.
    if (!canSwipe) {
      if (atEdge) { this.hold = null; return this.remember(idle); }
      return canHold ? this.holdStep(sample, time, false, track.scale) ?? this.remember(idle) : this.remember(idle);
    }

    this.record(sample, threshold);
    if (this.guard) {
      // While the hand is still out where the swipe ended, the way back is
      // still ahead: keep guarding it however long the speaker pauses there.
      if (-this.guard.dir * (sample.x - this.guard.startX) > threshold * 0.5)
        this.guard.until = Math.min(
          this.guard.firedAt + 10000,
          Math.max(this.guard.until, time + 1000),
        );
      if (time > this.guard.until) this.guard = null;
    }
    const swipe = this.detect(sample, threshold);
    if (swipe) {
      this.debug.dx = swipe.dir * swipe.disp;
      this.debug.dy = sample.y - swipe.start.y;
      this.debug.elapsed = time - swipe.start.t;
    } else {
      this.debug.dx = 0;
      this.debug.dy = 0;
      this.debug.elapsed = 0;
    }
    if (swipe && swipe.flat && !swipe.guarded && swipe.disp >= threshold) {
      if (allowedGestures.includes(swipe.dir === 1 ? "next" : "previous"))
        return this.fire(swipe, sample, threshold, time);
      this.samples = [sample];
      this.attempt = null;
      this.hold = null;
      return this.remember({ kind: "error", code: "direction", message: allowedGestures.includes("next") ? "В этом упражнении проведи ладонь вправо →" : "В этом упражнении проведи ладонь влево ←" });
    }

    if (
      swipe &&
      !swipe.flat &&
      !swipe.guarded &&
      swipe.disp >= threshold * 0.6 &&
      swipe.vert <= swipe.disp * 2.2 &&
      Math.hypot(swipe.disp, swipe.vert) >= threshold &&
      swipe.start.t - track.since >= 400
    ) {
      // A 49–65° diagonal from a hand that was already up: a swipe gone wrong.
      // Steeper moves are the hand being raised or dropped and stay silent.
      this.samples = [sample];
      this.attempt = null;
      this.hold = null;
      const hint = this.mistake(
        "horizontal",
        "Веди руку горизонтально, на одной высоте",
        time,
      );
      if (hint) return hint;
    }
    const attempting = swipe && swipe.flat && !swipe.guarded ? swipe : null;
    // Only a quick move that fell short is an attempt; a drifting palm is not.
    const continues = this.attempt?.dir === attempting?.dir;
    if (
      attempting &&
      attempting.progress >= 0.45 &&
      (continues || time - attempting.start.t <= 500)
    ) {
      if (
        !this.attempt ||
        this.attempt.dir !== attempting.dir ||
        attempting.progress > this.attempt.progress + 0.03
      )
        this.attempt = {
          dir: attempting.dir,
          progress: Math.max(
            attempting.progress,
            this.attempt?.dir === attempting.dir ? this.attempt.progress : 0,
          ),
          grewAt: time,
        };
    }
    if (this.attempt && time - this.attempt.grewAt >= STALL_MS) {
      const dir = this.attempt.dir;
      this.attempt = null;
      this.samples = [sample];
      this.hold = null;
      const hint = this.mistake(
        "wider",
        `Проведи рукой дальше ${dir === 1 ? "вправо" : "влево"} за одно движение`,
        time,
      );
      if (hint) return hint;
    }
    if (attempting && attempting.progress >= 0.25) {
      this.hold = null;
      return this.remember({
        kind: "progress",
        progressGesture: attempting.dir === 1 ? "next" : "previous",
        message: `Продолжай движение ${attempting.dir === 1 ? "вправо" : "влево"}`,
        progress: Math.min(1, attempting.progress),
      });
    }
    if (swipe?.guarded && swipe.progress >= 0.25) {
      this.hold = null;
      return this.remember({
        kind: "idle",
        message: "Рука возвращается · это не команда",
      });
    }
    if (atEdge) {
      this.hold = null;
      return this.hint(
        "edge",
        "Отведи руку от края кадра, чтобы вся ладонь была видна",
        time,
      );
    }
    this.currentHint = "";
    return (
      (canHold ? this.holdStep(sample, time, false, track.scale) : null) ??
      this.remember({
        kind: "idle",
        message: "Ладонь вижу · проведи вправо или влево",
      })
    );
  }

  /**
   * Keeps following the same hand through detector dropouts and ignores a
   * second hand nearby. Reports when the hand vanished in the middle of a swipe.
   */
  private follow(visible: Hand[], time: number) {
    let lostMidSwipe = false;
    const track = this.tracked;
    if (track) {
      let match: Hand | null = null;
      let best = Infinity;
      for (const hand of visible) {
        const gap = Math.hypot(hand.x - track.x, hand.y - track.y);
        if (gap < best) {
          best = gap;
          match = hand;
        }
      }
      // A lone hand may move far between frames on a slow CPU; with two hands
      // in view only a near one can be the same hand.
      const reach =
        visible.length === 1
          ? Math.max(0.4, track.scale * 6)
          : Math.max(0.2, track.scale * 4);
      if (match && best <= reach) {
        // A resting hand must not hide the one being shown to the camera, and
        // a small hand at the back of the room gives way to a much closer one.
        const settled = match.ready || time - track.openAt <= OPEN_GRACE;
        const rival = visible
          .filter(
            (hand) => hand !== match && hand.ready && hand.scale >= FAR_PALM,
          )
          .sort((a, b) => b.scale - a.scale)[0];
        if (
          !rival ||
          !(
            (!settled && rival.scale >= match.scale * 0.6) ||
            rival.scale >= match.scale * 1.6
          )
        ) {
          track.x = match.x;
          track.y = match.y;
          track.seen = time;
          track.scale += (match.scale - track.scale) * 0.3;
          return { hand: match, lostMidSwipe };
        }
        this.release("lowered");
        return { hand: this.start(rival, time), lostMidSwipe };
      }
      if (time - track.seen <= TRACK_GAP) return { hand: null, lostMidSwipe };
      lostMidSwipe = (this.attempt?.progress ?? 0) >= 0.45;
      this.tracked = null;
      this.release("lost");
      const guard = this.guard;
      this.clearMotion();
      this.guard = guard;
    }
    // Presented hands first, then the speaker's (closest, largest) hand,
    // then the raised one of two similar hands.
    const pick = [...visible].sort(
      (a, b) =>
        Number(b.ready) - Number(a.ready) ||
        Number(b.scale >= FAR_PALM) - Number(a.scale >= FAR_PALM) ||
        (Math.max(a.scale, b.scale) > Math.min(a.scale, b.scale) * 1.25
          ? b.scale - a.scale
          : a.y - b.y),
    )[0];
    if (!pick) return { hand: null, lostMidSwipe };
    return { hand: this.start(pick, time), lostMidSwipe };
  }

  /** Starts following a hand; the swipe that just happened stays guarded. */
  private start(hand: Hand, time: number) {
    const guard = this.guard;
    this.clearMotion();
    this.guard = guard;
    this.tracked = {
      x: hand.x,
      y: hand.y,
      scale: hand.scale,
      seen: time,
      since: time,
      openAt: hand.ready ? time : -Infinity,
    };
    return hand;
  }

  /** Records the open-palm path and re-arms a direction once its swipe stops. */
  private record(sample: Sample, threshold: number) {
    this.samples.push(sample);
    this.samples = this.samples.filter(
      (point) => sample.t - point.t <= SWIPE_WINDOW + 200,
    );
    // A pause starts a new path: a raise, a stop and a drop must not add up
    // to one flat chord between the way up and the way down.
    const recent = this.samples.filter((point) => sample.t - point.t <= 150);
    const radius = Math.max(0.015, threshold * 0.12);
    if (
      recent[0] &&
      sample.t - recent[0].t >= 100 &&
      recent.every(
        (point) => Math.hypot(point.x - sample.x, point.y - sample.y) <= radius,
      )
    )
      this.samples = recent;
    const stroke = this.stroke;
    if (!stroke) return;
    if (stroke.dir * (sample.x - stroke.extreme.x) > threshold * 0.05) {
      stroke.extreme = sample;
      stroke.grewAt = sample.t;
    }
    const back = stroke.dir * (stroke.extreme.x - sample.x);
    if (back >= threshold * 0.25 || sample.t - stroke.grewAt >= 150) {
      // A new swipe in the same direction is measured from where this one ended.
      this.samples = this.samples.filter(
        (point) => point.t >= stroke.extreme.t,
      );
      this.stroke = null;
    }
  }

  private detect(now: Sample, threshold: number): Swipe | null {
    let best: Swipe | null = null;
    for (const dir of [1, -1] as const) {
      if (this.stroke?.dir === dir) continue;
      let start: Sample | null = null;
      // The latest farthest point: a swipe starts where the hand last rested.
      for (const point of this.samples)
        if (
          now.t - point.t <= SWIPE_WINDOW &&
          (!start || dir * point.x <= dir * start.x)
        )
          start = point;
      if (!start) continue;
      const disp = dir * (now.x - start.x);
      if (disp <= 0) continue;
      const vert = Math.abs(now.y - start.y);
      const swipe: Swipe = {
        dir,
        start,
        disp,
        vert,
        progress: disp / threshold,
        guarded:
          this.guard?.dir === dir &&
          dir * (now.x - this.guard.startX) < threshold,
        // Up to ~49°: a natural arc still counts, a raise of the hand does not.
        flat: vert <= disp * 1.15,
      };
      if (!best || swipe.progress > best.progress) best = swipe;
    }
    return best;
  }

  private fire(swipe: Swipe, now: Sample, threshold: number, time: number) {
    this.cooldownUntil = time + SWIPE_COOLDOWN;
    this.stroke = { dir: swipe.dir, extreme: now, grewAt: time };
    // Where the hand rested before this swipe. A sweep that went back past an
    // earlier swipe keeps that swipe's centre; a slow frame rate can jump far
    // past the threshold, so the rest point stays within reach of the hand.
    const reach = threshold * 2.5;
    const startX =
      this.guard?.dir === swipe.dir
        ? this.guard.startX
        : swipe.dir === 1
          ? Math.max(swipe.start.x, now.x - reach)
          : Math.min(swipe.start.x, now.x + reach);
    this.guard = {
      dir: swipe.dir === 1 ? -1 : 1,
      startX,
      until: time + RETURN_GUARD,
      firedAt: time,
    };
    this.holdArmed = false;
    this.hold = null;
    this.attempt = null;
    this.samples = [now];
    this.releaseY = now.y;
    this.releaseSince = null;
    return this.command(swipe.dir === 1 ? "next" : "previous");
  }

  private holdStep(
    now: Sample,
    time: number,
    locked: boolean,
    scale: number,
  ): Feedback | null {
    const limit = Math.max(0.04, scale * 0.6);
    const moved =
      !!this.hold &&
      Math.hypot(now.x - this.hold.x, now.y - this.hold.y) > limit;
    if (!this.hold || moved || this.hold.t < this.unlockGraceUntil)
      this.hold = { ...now };
    // Right after unlocking, the same pose must not flip the lock back.
    if (time < this.unlockGraceUntil)
      return this.remember({ kind: "idle", message: "Жесты включены" });
    if (moved) return null;
    const held = time - this.hold.t;
    if (locked || this.holdArmed) {
      if (held >= HOLD_MS) return this.toggle(now, time, locked);
      return this.remember({
        kind: "progress",
        progressGesture: "toggle",
        message: locked
          ? "Удерживай ладонь · включение жестов"
          : "Удерживай ладонь · блокировка жестов",
        progress: Math.min(1, held / HOLD_MS),
      });
    }
    return this.remember({
      kind: "idle",
      message:
        held >= 900
          ? "Чтобы заблокировать жесты, опусти руку и снова подними ладонь"
          : "Ладонь вижу · проведи вправо или влево",
    });
  }

  private toggle(now: Sample, time: number, locked: boolean) {
    this.cooldownUntil = time + TOGGLE_COOLDOWN;
    this.releaseRequired = true;
    this.releaseY = now.y;
    this.releaseSince = null;
    this.clearMotion();
    if (locked) this.unlockGraceUntil = time + UNLOCK_GRACE;
    return this.command("toggle");
  }

  /** Relaxed fingers, a lowered hand or a hand out of view re-arm the hold. */
  private watchRelease(hand: Hand, scale: number, time: number) {
    const lowered =
      this.releaseY !== undefined &&
      hand.y - this.releaseY > Math.max(0.065, scale * 0.65);
    if (!hand.open || lowered) {
      this.releaseSince ??= time;
      if (time - this.releaseSince >= RELEASE_MS)
        this.release(hand.open ? "lowered" : "relaxed");
    } else this.releaseSince = null;
  }

  private release(kind: "relaxed" | "lowered" | "lost") {
    this.releaseRequired = false;
    this.holdArmed = true;
    this.releaseY = undefined;
    this.releaseSince = null;
    // The way back stays guarded: a deliberate swipe from the centre passes
    // the start anyway, and a hand that left the frame is still returning.
    if (kind !== "lowered") this.stroke = null;
  }

  /** Two straight fingers sweeping sideways: the speaker is trying, not talking. */
  private closedSwipe(hand: Hand, threshold: number, time: number) {
    if (hand.fingers !== 2) {
      this.closedPath = [];
      return null;
    }
    this.closedPath.push({ t: time, x: hand.x, y: hand.y });
    this.closedPath = this.closedPath.filter(
      (point) => time - point.t <= SWIPE_WINDOW,
    );
    const xs = this.closedPath.map((point) => point.x);
    const ys = this.closedPath.map((point) => point.y);
    const sideways = Math.max(...xs) - Math.min(...xs);
    if (
      sideways < threshold * 0.8 ||
      Math.max(...ys) - Math.min(...ys) > sideways * 1.15
    )
      return null;
    this.closedPath = [];
    return this.mistake("palm", "Раскрой ладонь: выпрями четыре пальца", time);
  }

  /** One named mistake per breath: the same move must not flash it twice. */
  private mistake(
    code: string,
    message: string,
    time: number,
  ): Feedback | null {
    if (time < this.quietUntil) return null;
    this.quietUntil = time + 1200;
    return { kind: "error", code, message };
  }

  private clearMotion() {
    this.samples = [];
    this.closedPath = [];
    this.hold = null;
    this.attempt = null;
    this.stroke = null;
    this.guard = null;
  }

  private remember(feedback: Feedback) {
    this.last = feedback;
    return feedback;
  }

  private command(gesture: Gesture): Feedback {
    this.last = null;
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
      : this.remember({ kind: "idle", message: "Проверяю ладонь…" });
  }
}
