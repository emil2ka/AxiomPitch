import assert from "node:assert/strict";
import { test } from "node:test";
import { newPreflight, recordPreflight, presentationReadiness, continuationReadiness, readNotchChoice } from "../src/lib/preflight.ts";
import type { PreparationInput } from "../src/lib/preflight.ts";
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

const prepared: PreparationInput = {
  cameraStatus: "ready", preflight: { index: 1, hand: true, next: true, previous: true, lock: true, unlock: true },
  notchChoice: "off", notchVisible: false, bridgeOnline: false, shellConnected: false, displayAvailable: true,
  workspaceReady: true, pdfLoading: false, hasSlides: true, external: false, externalReady: false,
};
test("first start requires a live camera, a deck and explicit notch choice, without gesture practice", () => {
  assert.equal(presentationReadiness({ ...prepared, preflight: newPreflight() }).ready, true);
  for (const patch of [
    { cameraStatus: "off" }, { cameraStatus: "loading" }, { cameraStatus: "error" },
    { notchChoice: null }, { workspaceReady: false }, { pdfLoading: true }, { hasSlides: false },
  ] as Partial<PreparationInput>[]) {
    const result = presentationReadiness({ ...prepared, ...patch });
    assert.equal(result.ready, false, JSON.stringify(patch));
    assert.ok(result.reason);
  }
});
test("web notch starts without a local application; external notch requires the shell and display", () => {
  assert.equal(presentationReadiness({ ...prepared, notchChoice: "on", bridgeOnline: false, shellConnected: false, displayAvailable: false }).ready, true);
  const withNotch: PreparationInput = { ...prepared, external: true, externalReady: true, notchChoice: "on", bridgeOnline: true, shellConnected: true };
  assert.equal(presentationReadiness(withNotch).ready, true);
  for (const patch of [{ bridgeOnline: false }, { shellConnected: false }, { displayAvailable: false }]) {
    assert.equal(presentationReadiness({ ...withNotch, ...patch }).ready, false);
  }
  assert.equal(presentationReadiness({ ...prepared, external: true, externalReady: true, notchVisible: true }).ready, false, "off must actually hide the notch before starting");
  for (const value of [null, "", "true", "false", "anything"]) assert.equal(readNotchChoice(value), null);
  assert.equal(readNotchChoice("on"), "on");
  assert.equal(readNotchChoice("off"), "off");
});
test("an external show requires a live target, independently of the PDF preview", () => {
  assert.equal(presentationReadiness({ ...prepared, external: true, externalReady: false }).ready, false);
  assert.equal(presentationReadiness({ ...prepared, external: true, externalReady: true, hasSlides: false }).ready, true);
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

test("an ongoing presentation can continue and resume with arrows after camera or notch loss", () => {
  assert.equal(continuationReadiness({ ...prepared, cameraStatus: "error", notchChoice: "on", bridgeOnline: false }).ready, true);
  assert.equal(continuationReadiness({ ...prepared, cameraStatus: "off", hasSlides: false }).ready, false);
  assert.equal(continuationReadiness({ ...prepared, cameraStatus: "off", external: true, externalReady: false }).ready, false);
});
