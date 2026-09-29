import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceAfterSuccess, applyPracticeGesture, createPractice, expectedGesture, goodLearningHands, practiceFeedback } from "../src/lib/learning.ts";
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
