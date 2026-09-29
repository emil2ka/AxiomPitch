import assert from "node:assert/strict";
import { test } from "node:test";
import { GestureEngine, isOpenPalm } from "../src/lib/gestures.ts";
import type { Point } from "../src/lib/types.ts";

const pose: Point[] = Array.from({ length: 33 }, () => ({
  x: 0.5,
  y: 0.5,
  visibility: 0.99,
}));
pose[11] = { x: 0.35, y: 0.55, visibility: 0.99 };
pose[12] = { x: 0.65, y: 0.55, visibility: 0.99 };
function palm(x = 0.4, y = 0.4, open = true): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x, y }));
  points[0] = { x, y: y + 0.1 };
  for (const [finger, dx] of [
    [8, -0.04],
    [12, -0.01],
    [16, 0.02],
    [20, 0.05],
  ]) {
    points[finger - 2] = { x: x + dx, y: y - 0.055 };
    points[finger] = { x: x + dx, y: open ? y - 0.16 : y + 0.03 };
  }
  return points;
}

type Feedback = ReturnType<GestureEngine["update"]>;
/** A palm moving in a straight line, one frame every 33 ms (30 FPS). */
function move(
  engine: GestureEngine,
  from: [number, number],
  to: [number, number],
  start: number,
  duration: number,
  { locked = false, open = true } = {},
): Feedback[] {
  const frames: Feedback[] = [];
  for (let t = 0; ; t = Math.min(duration, t + 33)) {
    const k = duration ? t / duration : 1;
    const x = from[0] + (to[0] - from[0]) * k;
    const y = from[1] + (to[1] - from[1]) * k;
    frames.push(engine.update([], [palm(x, y, open)], start + t, locked));
    if (t === duration) return frames;
  }
}
const still = (
  engine: GestureEngine,
  at: [number, number],
  start: number,
  duration: number,
  options?: { locked?: boolean; open?: boolean },
) => move(engine, at, at, start, duration, options);
const gone = (engine: GestureEngine, start: number, duration: number) => {
  const frames: Feedback[] = [];
  for (let t = 0; t <= duration; t += 33)
    frames.push(engine.update([], [], start + t, false));
  return frames;
};
const gestures = (frames: Feedback[]) =>
  frames.flatMap((frame) => (frame.gesture ? [frame.gesture] : []));
const codes = (frames: Feedback[]) =>
  frames.flatMap((frame) => (frame.code ? [frame.code] : []));

test("recognizes screen-right and screen-left as distinct commands", () => {
  for (const [end, gesture] of [
    [0.7, "next"],
    [0.1, "previous"],
  ] as const) {
    const engine = new GestureEngine();
    engine.update(pose, [palm()], 0, false);
    assert.equal(engine.update(pose, [palm(end)], 500, false).gesture, gesture);
  }
});
test("palm must be open and stationary for the full hold duration", () => {
  assert.equal(isOpenPalm(palm()), true);
  assert.equal(isOpenPalm(palm(0.4, 0.4, false)), false);
  const engine = new GestureEngine();
  assert.equal(engine.update(pose, [palm()], 0, false).kind, "progress");
  assert.equal(engine.update(pose, [palm()], 1499, false).gesture, undefined);
  assert.equal(engine.update(pose, [palm()], 1500, false).gesture, "toggle");
});
test("locked mode blocks swipe but still permits palm unlocking", () => {
  const engine = new GestureEngine();
  engine.update(pose, [palm()], 0, true);
  assert.equal(engine.update(pose, [palm(0.7)], 500, true).gesture, undefined);
  engine.update(pose, [palm(0.7)], 1400, true);
  assert.equal(engine.update(pose, [palm(0.7)], 3000, true).gesture, "toggle");
});
test("one held palm cannot repeatedly toggle without lowering the hand", () => {
  const engine = new GestureEngine();
  engine.update(pose, [palm()], 0, false);
  assert.equal(engine.update(pose, [palm()], 1500, false).gesture, "toggle");
  assert.equal(engine.update(pose, [palm()], 4000, true).gesture, undefined);
  engine.update(pose, [], 4100, true);
  engine.update(pose, [], 4450, true);
  engine.update(pose, [palm()], 4500, true);
  assert.equal(engine.update(pose, [palm()], 6000, true).gesture, "toggle");
});
test("hand-only commands work low in the frame with no body landmarks", () => {
  const engine = new GestureEngine();
  engine.update([], [palm(.4, .8)], 0, false);
  assert.equal(engine.update([], [palm(.7, .8)], 500, false).gesture, "next");
  engine.reset();
  engine.update([], [palm(.4, .8)], 0, false);
  assert.equal(engine.update([], [palm(.4, .8)], 1500, false).gesture, "toggle");
});
test("one bent finger does not reject an open palm, two do", () => {
  const hand = palm();
  hand[20].y = .43;
  assert.equal(isOpenPalm(hand), true);
  hand[16].y = .43;
  assert.equal(isOpenPalm(hand), false);
});
test("consecutive swipes keep the hand up: the way back to the centre is not a command", () => {
  const engine = new GestureEngine();
  const run = [
    ...still(engine, [0.4, 0.4], 0, 200),
    ...move(engine, [0.4, 0.4], [0.7, 0.4], 200, 300),
    // The speaker looks at the new slide, then brings the hand back.
    ...still(engine, [0.7, 0.4], 500, 400),
    ...move(engine, [0.7, 0.4], [0.4, 0.4], 900, 500),
    ...still(engine, [0.4, 0.4], 1400, 300),
    ...move(engine, [0.4, 0.4], [0.7, 0.4], 1700, 300),
    ...move(engine, [0.7, 0.4], [0.4, 0.4], 2000, 400),
  ];
  assert.deepEqual(gestures(run), ["next", "next"]);
  assert.deepEqual(codes(run), []);
});
test("a sweep past the starting point goes back, and forward works again after it", () => {
  const engine = new GestureEngine();
  const run = [
    ...still(engine, [0.4, 0.4], 0, 200),
    ...move(engine, [0.4, 0.4], [0.7, 0.4], 200, 300),
    ...still(engine, [0.7, 0.4], 500, 400),
    ...move(engine, [0.7, 0.4], [0.2, 0.4], 900, 600),
    ...still(engine, [0.2, 0.4], 1500, 300),
    ...move(engine, [0.2, 0.4], [0.4, 0.4], 1800, 400),
    ...still(engine, [0.4, 0.4], 2200, 300),
    ...move(engine, [0.4, 0.4], [0.7, 0.4], 2500, 300),
  ];
  assert.deepEqual(gestures(run), ["next", "previous", "next"]);
});
test("a swipe that carries the hand out of the frame: coming back is still not a command", () => {
  const engine = new GestureEngine();
  const run = [
    ...still(engine, [0.4, 0.4], 0, 200),
    ...move(engine, [0.4, 0.4], [0.9, 0.4], 200, 350),
    ...gone(engine, 583, 700),
    ...move(engine, [0.85, 0.4], [0.4, 0.4], 1300, 500),
    ...still(engine, [0.4, 0.4], 1800, 300),
  ];
  assert.deepEqual(gestures(run), ["next"]);
  assert.deepEqual(
    gestures(move(engine, [0.4, 0.4], [0.15, 0.4], 2100, 300)),
    ["previous"],
  );
});
test("a palm held up after a swipe does not lock the gestures by accident", () => {
  const engine = new GestureEngine();
  const swipe = [
    ...still(engine, [0.4, 0.4], 0, 200),
    ...move(engine, [0.4, 0.4], [0.7, 0.4], 200, 300),
  ];
  const waiting = still(engine, [0.7, 0.4], 500, 3500);
  assert.deepEqual(gestures([...swipe, ...waiting]), ["next"]);
  assert.match(waiting.at(-1)!.message, /опусти руку/);
  // Even after a long look at the slide, the way back is not a command.
  assert.deepEqual(gestures(move(engine, [0.7, 0.4], [0.4, 0.4], 4000, 500)), []);
  // Lower the hand out of view, raise it again and hold: now it locks.
  gone(engine, 4533, 400);
  assert.deepEqual(gestures(still(engine, [0.7, 0.4], 5000, 1600)), ["toggle"]);
});
test("a blurred or dropped frame in the middle of a swipe does not break it", () => {
  const engine = new GestureEngine();
  const frames = still(engine, [0.4, 0.4], 0, 200);
  for (let i = 1; i <= 9; i++) {
    const x = 0.4 + 0.3 * (i / 9);
    const hands = i === 3 ? [palm(x, 0.4, false)] : i === 5 ? [] : [palm(x)];
    frames.push(engine.update([], hands, 200 + i * 33, false));
  }
  assert.deepEqual(gestures(frames), ["next"]);
  assert.deepEqual(codes(frames), []);
});
test("a slowly drifting palm is neither a swipe nor a mistake", () => {
  const engine = new GestureEngine();
  const drift = move(engine, [0.4, 0.4], [0.7, 0.4], 0, 4000);
  assert.deepEqual(gestures(drift), []);
  assert.deepEqual(codes(drift), []);
});
test("raising or lowering the hand is not a swipe and not a mistake", () => {
  const engine = new GestureEngine();
  const raise = move(engine, [0.3, 0.9], [0.45, 0.4], 0, 400);
  const settle = still(engine, [0.45, 0.4], 400, 600);
  const lower = move(engine, [0.45, 0.4], [0.55, 0.9], 1000, 400);
  const all = [...raise, ...settle, ...lower];
  assert.deepEqual(gestures(all), []);
  assert.deepEqual(codes(all), []);
});
test("hands out of view or relaxed while talking are calm, not errors", () => {
  const engine = new GestureEngine();
  const talking = [
    ...gone(engine, 0, 5000),
    ...move(engine, [0.3, 0.6], [0.7, 0.6], 5000, 300, { open: false }),
    ...move(engine, [0.7, 0.6], [0.3, 0.6], 5300, 300, { open: false }),
    ...gone(engine, 5600, 5000),
  ];
  assert.deepEqual(gestures(talking), []);
  assert.deepEqual(codes(talking), []);
  assert.ok(talking.every((frame) => frame.kind === "idle"));
});
test("the same physical swipe counts the same on 4:3 and 16:9 cameras", () => {
  // A palm 72 px tall on a 720 px high frame, swiped 160 or 90 px sideways.
  const hand = (pixels: number, width: number) =>
    palm().map((point) => ({
      x: (pixels + (point.x - 0.4) * 720) / width,
      y: point.y,
    }));
  for (const width of [960, 1280]) {
    for (const [distance, expected] of [
      [160, "next"],
      [90, undefined],
    ] as const) {
      const engine = new GestureEngine();
      let result: string | undefined;
      for (let t = 0; t <= 300; t += 33) {
        const pixels = 300 + distance * Math.min(1, t / 300);
        result ??= engine.update([], [hand(pixels, width)], t, false, width / 720)
          .gesture;
      }
      assert.equal(result, expected, `${distance}px on ${width}×720`);
    }
  }
});
test("relaxing fingers re-arms hold without showing shoulders", () => {
  const engine = new GestureEngine();
  engine.update([], [palm()], 0, false);
  assert.equal(engine.update([], [palm()], 1500, false).gesture, "toggle");
  engine.update([], [palm(.4, .4, false)], 2300, true);
  engine.update([], [palm(.4, .4, false)], 2700, true);
  engine.update([], [palm()], 2800, true);
  assert.equal(engine.update([], [palm()], 4300, true).gesture, "toggle");
});
test("sensitivity widens or shortens the required swipe", () => {
  const easy = new GestureEngine();
  easy.setSensitivity(0.55);
  easy.update(pose, [palm()], 0, false);
  assert.equal(easy.update(pose, [palm(0.5)], 500, false).gesture, "next");
  const hard = new GestureEngine();
  hard.setSensitivity(1.15);
  hard.update(pose, [palm()], 0, false);
  assert.equal(hard.update(pose, [palm(0.5)], 500, false).gesture, undefined);
});
test("small hands use their own scale rather than shoulder width", () => {
  const small = (x: number) => palm().map(p => ({x: x + (p.x - .4) * .5, y: .4 + (p.y - .4) * .5}));
  const engine = new GestureEngine();
  engine.update([], [small(.4)], 0, false);
  assert.equal(engine.update([], [small(.5)], 500, false).gesture, "next");
});
test("a quick swipe that stops short, a steep diagonal and bent fingers get their hints", () => {
  const engine = new GestureEngine();
  const short = [
    ...still(engine, [0.4, 0.4], 0, 200),
    ...move(engine, [0.4, 0.4], [0.47, 0.4], 200, 200),
    ...still(engine, [0.47, 0.4], 400, 400),
  ];
  assert.deepEqual(gestures(short), []);
  const wider = short.find((frame) => frame.code === "wider");
  assert.match(wider!.message, /вправо/);

  engine.reset();
  const diagonal = [
    ...still(engine, [0.4, 0.4], 0, 500),
    ...move(engine, [0.4, 0.4], [0.47, 0.2], 500, 250),
  ];
  assert.deepEqual(gestures(diagonal), []);
  assert.deepEqual(codes(diagonal), ["horizontal"]);

  // Two bent fingers sweeping sideways: trying to swipe, not just talking.
  engine.reset();
  const bent = (x: number) => {
    const hand = palm(x);
    hand[16].y = 0.43;
    hand[20].y = 0.43;
    return hand;
  };
  const sweep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
    engine.update([], [bent(0.4 + i * 0.03)], i * 33, false),
  );
  assert.deepEqual(gestures(sweep), []);
  assert.deepEqual(codes(sweep), ["palm"]);
});
test("a natural arc keeps counting as a swipe instead of a diagonal error", () => {
  const engine = new GestureEngine();
  engine.update(pose, [palm()], 0, false);
  const arc = engine.update(pose, [palm(0.5, 0.28)], 400, false);
  assert.equal(arc.kind, "progress");
  assert.equal(arc.code, undefined);
  assert.equal(engine.update(pose, [palm(0.66, 0.22)], 700, false).gesture, "next");
});
test("locked gestures ignore free hand movement instead of flashing errors", () => {
  const engine = new GestureEngine();
  engine.update(pose, [palm()], 0, true);
  const diagonal = engine.update(pose, [palm(0.6, 0.2)], 400, true);
  assert.equal(diagonal.kind, "idle");
  assert.equal(diagonal.code, undefined);
  engine.update(pose, [palm(0.7, 0.4)], 700, true);
  const sweep = engine.update(pose, [palm(0.45, 0.42)], 1300, true);
  assert.equal(sweep.kind, "idle");
  assert.equal(sweep.gesture, undefined);
  assert.equal(sweep.code, undefined);
  const closed = engine.update(pose, [palm(0.4, 0.4, false)], 2300, true);
  assert.equal(closed.kind, "idle");
  assert.equal(closed.code, undefined);
});
test("after unlocking, a still palm cannot lock the gestures again at once", () => {
  const engine = new GestureEngine();
  engine.update(pose, [palm()], 0, true);
  assert.equal(engine.update(pose, [palm()], 1500, true).gesture, "toggle");
  engine.update(pose, [], 2300, false);
  engine.update(pose, [], 2700, false);
  engine.update(pose, [palm()], 2800, false);
  assert.equal(engine.update(pose, [palm()], 4300, false).gesture, undefined);
  assert.equal(engine.update(pose, [palm()], 5700, false).gesture, undefined);
  assert.equal(engine.update(pose, [palm()], 5900, false).gesture, "toggle");
});
test("a hand lost in the middle of a swipe is reported once, then calm", () => {
  const engine = new GestureEngine();
  const started = [
    ...still(engine, [0.4, 0.4], 0, 200),
    ...move(engine, [0.4, 0.4], [0.47, 0.4], 200, 150),
  ];
  assert.deepEqual(gestures(started), []);
  const lost = gone(engine, 383, 600);
  assert.deepEqual(codes(lost), ["lost-hand"]);
  assert.deepEqual(codes(gone(engine, 1000, 2000)), []);
  assert.equal(
    engine.update(pose, [palm(0.7)], 3100, false).gesture,
    undefined,
  );
});
