import assert from "node:assert/strict";
import { test } from "node:test";
import { LearningGestureEngine, advanceAfterSuccess, applyPracticeGesture, createPractice, expectedGesture, goodLearningHands, practiceFeedback } from "../src/lib/learning.ts";
import { GestureEngine } from "../src/lib/gestures.ts";
import type { Point } from "../src/lib/types.ts";

const palm = (x = .4): Point[] => {
  const points = Array.from({length: 21}, () => ({x, y: .4}));
  points[0] = {x, y: .5};
  for (const [tip, dx] of [[8,-.04], [12,-.01], [16,.02], [20,.05]]) {
    points[tip - 2] = {x: x + dx, y: .345};
    points[tip] = {x: x + dx, y: .24};
  }
  return points;
};

test("watching examples and wrong gestures cannot pass an exercise", () => {
  const initial = createPractice(1);
  assert.equal(initial.passed, false);
  assert.equal(applyPracticeGesture(1, initial, "previous"), initial);
  assert.equal(applyPracticeGesture(1, initial, "toggle"), initial);
  const completed = applyPracticeGesture(1, initial, "next");
  assert.equal(completed.passed, true);
  assert.equal(completed.slide, 1);
  assert.equal(applyPracticeGesture(1, completed, "next"), completed);
});
test("locking and unlocking are independently verified", () => {
  const lock = applyPracticeGesture(3, createPractice(3), "toggle");
  assert.equal(lock.passed, true);
  assert.equal(lock.locked, true);
  const initial = createPractice(4);
  assert.equal(initial.locked, true);
  assert.equal(applyPracticeGesture(4, initial, "next"), initial);
  const unlocked = applyPracticeGesture(4, initial, "toggle");
  assert.equal(unlocked.passed, true);
  assert.equal(unlocked.locked, false);
});
test("mini rehearsal needs the entire sequence, including returning a slide", () => {
  let state = createPractice(5);
  state = applyPracticeGesture(5, state, "next");
  assert.equal(state.passed, false);
  assert.equal(state.slide, 1);
  assert.equal(applyPracticeGesture(5, state, "previous"), state);
  state = applyPracticeGesture(5, state, "next");
  assert.equal(state.slide, 2);
  assert.equal(expectedGesture(5, state.sequence), "previous");
  state = applyPracticeGesture(5, state, "previous");
  assert.equal(state.passed, true);
  assert.equal(state.sequence, 3);
  assert.equal(state.slide, 1);
});
test("calibration only needs an open hand, without a head or shoulders", () => {
  assert.equal(goodLearningHands([palm()]), true);
  assert.equal(goodLearningHands([]), false);
  assert.equal(goodLearningHands([palm().slice(0, 10)]), false);
  assert.equal(goodLearningHands([palm().map((p, i) => i === 9 ? {...p, x: NaN} : p)]), false);
});
test("recognized camera commands feed the same exercise logic", () => {
  const engine = new GestureEngine();
  engine.update([], [palm()], 0, false);
  const detected = engine.update([], [palm(.7)], 500, false);
  assert.equal(detected.gesture, "next");
  assert.equal(applyPracticeGesture(1, createPractice(1), detected.gesture!).passed, true);
});

test("stationary palm feedback teaches the expected swipe instead of an unrelated hold", () => {
  const engine = new GestureEngine();
  engine.update([], [palm()], 0, false);
  const holding = engine.update([], [palm()], 500, false);
  assert.equal(holding.kind, "progress");
  const forward = practiceFeedback(1, 0, holding);
  assert.match(forward.message, /вправо/);
  assert.equal(forward.progress, undefined);
  assert.match(practiceFeedback(5, 2, holding).message, /влево/);
  assert.equal(practiceFeedback(3, 0, holding), holding);
});


test("automatic advance accepts a lowered hand still visible in the camera", () => {
  const lowered = palm().map(point => ({ ...point, y: point.y + .4 }));
  const start = { completedAt: 0, releasedAt: null, releaseY: .4 };
  const held = advanceAfterSuccess(start, [palm()], 1100);
  assert.equal(held.ready, false);
  const release = advanceAfterSuccess(held.gate, [lowered], 1200);
  assert.equal(release.ready, false);
  assert.equal(advanceAfterSuccess(release.gate, [lowered], 1560).ready, true);
});
test("brief hand loss cannot skip the hold release gate", () => {
  const start = { completedAt: 0, releasedAt: null, releaseY: .4 };
  const missingHand = advanceAfterSuccess(start, [], 1100);
  const handReturns = advanceAfterSuccess(missingHand.gate, [palm()], 1200);
  assert.equal(handReturns.gate.releasedAt, null);
  assert.equal(handReturns.ready, false);
  assert.equal(advanceAfterSuccess({ completedAt: 0, releasedAt: 1100 }, [], 2000).ready, false);
});
test("swipe and calibration advance with the same visible hand after a success pause", () => {
  const start = { completedAt: 0, releasedAt: null, releaseY: .4 };
  const first = advanceAfterSuccess(start, [palm()], 100, false);
  assert.equal(advanceAfterSuccess(first.gate, [palm()], 800, false).ready, false);
  assert.equal(advanceAfterSuccess(first.gate, [palm()], 1100, false).ready, true);
});

test("closing fingers advances a hold lesson without taking the hand off camera", () => {
  const closed = palm().map((point, i) => [8,12,16,20].includes(i) ? {...point, y: .43} : point);
  const first = advanceAfterSuccess({completedAt: 0, releasedAt: null, releaseY: .4}, [closed], 1100);
  assert.equal(advanceAfterSuccess(first.gate, [closed], 1450).ready, true);
});

const frame = (time: number, hands: Point[][], handLabels?: string[]) => ({ type: "frame" as const, time, hands, handLabels, pose: [], duration: 0 });

test("waiting with an open palm never consumes a swipe lesson's release gate", () => {
  const engine = new LearningGestureEngine();
  for (let time = 0; time < 6000; time += 100) {
    const result = engine.update(frame(time, [palm()]), "next", false);
    assert.equal(result.gesture, undefined);
    assert.doesNotMatch(result.message, /блокиров|принята|Расслабь/);
  }
  const result = engine.update(frame(6100, [palm(.65)]), "next", false);
  assert.equal(result.gesture, "next");
  assert.equal(applyPracticeGesture(1, createPractice(1), result.gesture!).passed, true);
});

test("a stationary first hand cannot hide the second hand's swipe, even when detections reorder", () => {
  const engine = new LearningGestureEngine();
  const results = [];
  const resting = palm(.2);
  for (let time = 0; time <= 400; time += 50) {
    const moving = palm(.55 + .25 * time / 400);
    results.push(engine.update(time % 100 === 0
      ? frame(time, [resting, moving], ["Left", "Right"])
      : frame(time, [moving, resting], ["Right", "Left"]), "next", false));
  }
  assert.deepEqual(results.flatMap(result => result.gesture ? [result.gesture] : []), ["next"]);
});

test("wrong-direction movement does not prevent an immediate correct attempt", () => {
  const engine = new LearningGestureEngine();
  engine.update(frame(0, [palm(.55)]), "next", false);
  const wrong = engine.update(frame(250, [palm(.3)]), "next", false);
  assert.equal(wrong.gesture, undefined);
  assert.equal(wrong.code, "direction");
  assert.equal(engine.update(frame(500, [palm(.55)]), "next", false).gesture, "next");
});

test("swipe progress stays visible instead of being replaced by a hold instruction", () => {
  const engine = new LearningGestureEngine();
  engine.update(frame(0, [palm()]), "next", false);
  const result = engine.update(frame(200, [palm(.45)]), "next", false);
  assert.equal(result.kind, "progress");
  assert.equal(result.progressGesture, "next");
  assert.ok((result.progress ?? 0) > .25);
  assert.equal(practiceFeedback(1, 0, result), result);
});

test("hold practice ignores swipes and only accepts the full stationary hold", () => {
  const engine = new LearningGestureEngine();
  engine.update(frame(0, [palm()]), "toggle", false);
  assert.equal(engine.update(frame(300, [palm(.7)]), "toggle", false).gesture, undefined);
  assert.equal(engine.update(frame(1799, [palm(.7)]), "toggle", false).gesture, undefined);
  assert.equal(engine.update(frame(1800, [palm(.7)]), "toggle", false).gesture, "toggle");
});

test("brief missing/blurred camera frames preserve the same learning swipe", () => {
  const engine = new LearningGestureEngine();
  engine.update(frame(0, [palm(.3)], ["Right"]), "next", false);
  engine.update(frame(100, [palm(.35)], ["Right"]), "next", false);
  engine.update(frame(160, []), "next", false);
  const result = engine.update(frame(220, [palm(.45)], ["Right"]), "next", false);
  assert.equal(result.gesture, "next");
});

test("camera practice completes the mini-pitch without counting the return to centre", () => {
  const engine = new LearningGestureEngine();
  let state = createPractice(5);
  const sweep = (from: number, to: number, start: number) => {
    for (let t = 0; t <= 300; t += 50) {
      const expected = expectedGesture(5, state.sequence);
      if (!expected) return;
      const result = engine.update(frame(start + t, [palm(from + (to - from) * t / 300)], ["Right"]), expected, state.locked);
      if (result.gesture) state = applyPracticeGesture(5, state, result.gesture);
    }
  };
  sweep(.3, .6, 0);
  assert.equal(state.sequence, 1);
  sweep(.6, .6, 400);
  sweep(.6, .3, 800);
  assert.equal(state.sequence, 1);
  sweep(.3, .6, 1200);
  assert.equal(state.sequence, 2);
  sweep(.6, .6, 1600);
  sweep(.6, .3, 2000);
  assert.equal(state.sequence, 2);
  sweep(.3, .1, 2400);
  assert.equal(state.sequence, 3);
  assert.equal(state.passed, true);
});
