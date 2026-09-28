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
test("hands below shoulders do not produce accidental commands", () => {
  const engine = new GestureEngine();
  for (let time = 0; time < 5000; time += 200)
    assert.equal(
      engine.update(pose, [palm(0.3 + (time % 500) / 1000, 0.8)], time, false)
        .gesture,
      undefined,
    );
});
test("incomplete and diagonal attempts produce specific correction feedback", () => {
  const engine = new GestureEngine();
  engine.update(pose, [palm()], 0, false);
  const short = engine.update(pose, [palm(0.5)], 1150, false);
  assert.equal(short.code, "wider");
  assert.match(short.message, /вправо/);
  engine.reset();
  engine.update(pose, [palm()], 0, false);
  assert.equal(
    engine.update(pose, [palm(0.5, 0.2)], 500, false).code,
    "horizontal",
  );
  engine.reset();
  engine.update(pose, [palm(0.4, 0.4, false)], 0, false);
  assert.equal(
    engine.update(pose, [palm(0.4, 0.4, false)], 700, false).code,
    "palm",
  );
});
test("tracking loss clears the gesture and reports framing correction", () => {
  const engine = new GestureEngine();
  engine.update(pose, [palm()], 0, false);
  engine.update([], [], 300, false);
  assert.equal(engine.update([], [], 1500, false).code, "frame");
  assert.equal(
    engine.update(pose, [palm(0.7)], 1600, false).gesture,
    undefined,
  );
});
