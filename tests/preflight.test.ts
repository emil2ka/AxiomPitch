import assert from "node:assert/strict";
import { test } from "node:test";
import { newPreflight, recordPreflight } from "../src/lib/preflight.ts";
import { GestureEngine } from "../src/lib/gestures.ts";
import type { Point } from "../src/lib/types.ts";

const palm = (x = .4): Point[] => {
  const points = Array.from({ length: 21 }, () => ({ x, y: .4 }));
  points[0] = { x, y: .5 };
  for (const [tip, dx] of [[8, -.04], [12, -.01], [16, .02], [20, .05]]) {
    points[tip - 2] = { x: x + dx, y: .345 };
    points[tip] = { x: x + dx, y: .24 };
  }
  return points;
};
test("preflight verifies actual recognizer feedback and keeps its slide in the sandbox", () => {
  const engine = new GestureEngine();
  const initial = newPreflight();
  engine.update([], [palm()], 0, false);
  const detected = engine.update([], [palm(.7)], 500, false);
  assert.equal(detected.gesture, "next");
  const state = recordPreflight(initial, detected, false);
  assert.equal(state.next, true);
  assert.equal(state.previous, false);
  assert.equal(state.index, 2);
  assert.equal(initial.index, 1);
  assert.equal(recordPreflight(state, detected, false).index, 2);
  const back = recordPreflight(state, { kind: "success", message: "", gesture: "previous" }, false);
  assert.equal(back.index, 1);
  assert.equal(back.previous, true);
});
test("preflight progress cannot pass checks, and lock/unlock are separate", () => {
  const initial = newPreflight();
  assert.equal(recordPreflight(initial, { kind: "progress", message: "", progressGesture: "next", progress: .9 }, false), initial);
  assert.equal(recordPreflight(initial, { kind: "error", message: "" }, false), initial);
  const locked = recordPreflight(initial, { kind: "success", message: "", gesture: "toggle" }, true);
  assert.equal(locked.lock, true);
  assert.equal(locked.unlock, false);
  const unlocked = recordPreflight(locked, { kind: "success", message: "", gesture: "toggle" }, false);
  assert.equal(unlocked.lock, true);
  assert.equal(unlocked.unlock, true);
});
