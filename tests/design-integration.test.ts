import assert from "node:assert/strict";
import { test } from "node:test";
import { Bridge } from "../server/src/bridge/controller.ts";
import { parseFrame } from "../server/src/ws.ts";
import { trimFrame } from "../src/lib/bridge-client.ts";
import { GestureEngine } from "../src/lib/gestures.ts";
import type { Point } from "../src/lib/types.ts";
import { FakeTarget } from "./support.ts";

function palm(x = .4, open = true): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x, y: .4 }));
  points[0] = { x, y: .5 };
  for (const [tip, dx] of [[8, -.04], [12, -.01], [16, .02], [20, .05]]) {
    points[tip - 2] = { x: x + dx, y: .345 };
    points[tip] = { x: x + dx, y: open ? .24 : .43 };
  }
  return points;
}

test("design hand-only gestures keep the external bridge lock and step exactly once", async () => {
  const target = new FakeTarget();
  const bridge = new Bridge([target], () => {}, "keynote");
  const engine = new GestureEngine();
  let locked = false;
  async function observe(x: number, time: number, open = true) {
    const feedback = engine.update([], [palm(x, open)], time, locked);
    if (feedback.gesture) {
      if (feedback.gesture === "toggle") locked = !locked;
      await bridge.handleCommand(feedback.gesture, locked);
    }
    return feedback;
  }
  /** The palm moving between two points, one camera frame every 33 ms. */
  async function sweep(from: number, to: number, start: number, duration: number, open = true) {
    const seen: string[] = [];
    for (let t = 0; ; t = Math.min(duration, t + 33)) {
      const feedback = await observe(from + (to - from) * (duration ? t / duration : 1), start + t, open);
      if (feedback.gesture) seen.push(feedback.gesture);
      if (t === duration) return seen;
    }
  }
  await sweep(.4, .4, 0, 200);
  assert.deepEqual(await sweep(.4, .7, 200, 300), ["next"]);
  await sweep(.7, .7, 500, 400);
  // Bringing the hand back to the centre is not a command.
  assert.deepEqual(await sweep(.7, .4, 900, 500), []);
  // A deliberate sweep past the starting point is.
  assert.deepEqual(await sweep(.4, .15, 1400, 300), ["previous"]);
  assert.equal(target.count("next"), 1);
  assert.equal(target.count("previous"), 1);
  // Relaxed fingers re-arm the hold after the swipes.
  await sweep(.15, .15, 1700, 400, false);
  assert.deepEqual(await sweep(.4, .4, 2200, 1600), ["toggle"]);
  assert.equal(bridge.locked, true);
  await sweep(.4, .4, 3800, 400, false);
  assert.deepEqual(await sweep(.4, .7, 4300, 300), []);
  assert.equal(target.count("next"), 1);
  engine.reset();
  assert.deepEqual(await sweep(.4, .4, 5000, 1600), ["toggle"]);
  assert.equal(bridge.locked, false);
  assert.equal(target.count("next") + target.count("previous"), 2);
});

test("Electron receives hand identity confidence through the existing coordinate-only bridge", () => {
  const wire = trimFrame({
    type: "frame", time: 123, duration: 15, pose: [], hands: [palm()],
    handLabels: ["Left"], handScores: [.932198],
  });
  const parsed = parseFrame({ ...wire, cameraPixels: "must be discarded" });
  assert.deepEqual(parsed?.handScores, [.9322]);
  assert.deepEqual(parsed?.handLabels, ["Left"]);
  assert.equal(parsed && "cameraPixels" in parsed, false);
  for (const scores of [[NaN], [1.1], [-.1], [.5, .6, .7], [".9"]])
    assert.equal(parseFrame({ ...wire, handScores: scores }), null);
});
