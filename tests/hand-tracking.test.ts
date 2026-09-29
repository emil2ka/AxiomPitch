import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion, Vector3 } from "three";
import { fingerOrientations, HandPoseTracker } from "../src/lib/hand-tracking.ts";
import type { Point, VisionFrame } from "../src/lib/types.ts";

// Independent, straight phalanges with a thumb extending diagonally.
function hand(side = 1, screenX = 0): Point[] {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: screenX, y: 0, z: 0 }));
  points[0] = { x: screenX, y: 0.2, z: 0 };
  for (const [finger, base] of [5, 9, 13, 17].entries()) {
    for (let joint = 0; joint < 4; joint++)
      points[base + joint] = { x: screenX + (finger - 1) * 0.06 * side, y: -joint * 0.05, z: 0 };
  }
  for (let joint = 0; joint < 4; joint++)
    points[1 + joint] = { x: screenX + (-0.1 - joint * 0.04) * side, y: 0.12 - joint * 0.035, z: 0 };
  return points;
}
const frame = (hands: Point[][], labels: string[] = []): VisionFrame => ({
  type: "frame", time: 0, duration: 0, pose: [], hands, handLabels: labels,
  handWorlds: hands,
});
function direction(joints: Quaternion[], index: number) {
  const q = new Quaternion();
  for (let i = 0; i <= index; i++) q.multiply(joints[i]);
  return new Vector3(0, 1, 0).applyQuaternion(q);
}

test("open fingers are straight and mirrored hands have the same local articulation", () => {
  const a = fingerOrientations(hand(1), 1)!;
  const b = fingerOrientations(hand(-1), -1)!;
  for (let finger = 0; finger < 5; finger++) {
    for (let joint = 0; joint < 3; joint++)
      assert.ok(a[finger][joint].angleTo(b[finger][joint]) < 1e-6);
    if (finger < 4) assert.ok(direction(a[finger], 2).distanceTo(new Vector3(0, 1, 0)) < 1e-6);
  }
  assert.ok(direction(a[4], 0).x < -0.5, "thumb has its own diagonal axis");
});
test("spread changes the knuckle sideways without creating a false finger curl", () => {
  const points = hand();
  for (let joint = 1; joint < 4; joint++) points[5 + joint].x -= joint * 0.03;
  const fingers = fingerOrientations(points, 1)!;
  assert.ok(direction(fingers[0], 0).x < -0.45);
  assert.ok(fingers[0][1].angleTo(new Quaternion()) < 1e-6);
  assert.ok(fingers[0][2].angleTo(new Quaternion()) < 1e-6);
});
test("all three knuckles follow signed depth curls and thumb opposition", () => {
  const points = hand();
  const angles = [0.5, 1.1, 0.65];
  let total = 0;
  for (let joint = 0; joint < 3; joint++) {
    total += angles[joint];
    points[10 + joint] = {
      x: points[9 + joint].x,
      y: points[9 + joint].y - Math.cos(total) * 0.05,
      z: points[9 + joint].z! - Math.sin(total) * 0.05,
    };
  }
  const fingers = fingerOrientations(points, 1)!;
  for (let joint = 0; joint < 3; joint++) {
    const expected = new Quaternion().setFromEuler(new Euler(angles[joint], 0, 0));
    assert.ok(fingers[1][joint].angleTo(expected) < 1e-6);
  }
  const before = direction(fingers[4], 0);
  points[2].z = -0.04;
  const after = direction(fingerOrientations(points, 1)![4], 0);
  assert.ok(after.z > before.z + 0.4, "thumb can oppose out of the palm plane");
});
test("finger pose is invariant under whole-palm rotation and translation", () => {
  const before = fingerOrientations(hand(), 1)!;
  const rotation = new Quaternion().setFromEuler(new Euler(0.7, 1.3, -0.4));
  const transformed = hand().map((p) => {
    const v = new Vector3(p.x, -p.y, -p.z!).applyQuaternion(rotation).add(new Vector3(2, -3, 4));
    return { x: v.x, y: -v.y, z: -v.z };
  });
  const after = fingerOrientations(transformed, 1)!;
  for (let finger = 0; finger < 5; finger++) for (let joint = 0; joint < 3; joint++)
    assert.ok(before[finger][joint].angleTo(after[finger][joint]) < 1e-6);
});
test("invalid and zero-length finger landmarks cannot poison a pose", () => {
  const points = hand();
  points[8].z = NaN;
  assert.equal(fingerOrientations(points, 1), null);
  points[8] = { ...points[7] };
  assert.equal(fingerOrientations(points, 1), null);
});
test("hands retain identity when detection order reverses and hands cross", () => {
  const tracker = new HandPoseTracker();
  tracker.update(frame([hand(-1, 0.25), hand(1, 0.75)], ["Left", "Right"]), 0);
  tracker.update(frame([hand(1, 0.6), hand(-1, 0.4)], ["Right", "Left"]), 70);
  tracker.update(frame([hand(-1, 0.52), hand(1, 0.48)], ["Left", "Right"]), 140);
  tracker.update(frame([hand(1, 0.36), hand(-1, 0.64)], ["Right", "Left"]), 210);
  const [left, right] = tracker.hands(210);
  assert.equal(left!.landmarks[0].x, 0.64);
  assert.equal(right!.landmarks[0].x, 0.36);
});
test("one flickering label or duplicated labels do not swap established hands", () => {
  const tracker = new HandPoseTracker();
  tracker.update(frame([hand(-1, 0.25), hand(1, 0.75)], ["Left", "Right"]), 0);
  tracker.update(frame([hand(1, 0.74), hand(-1, 0.26)], ["Left", "Left"]), 70);
  assert.equal(tracker.hands(70)[0]!.landmarks[0].x, 0.26);
  assert.equal(tracker.hands(70)[1]!.landmarks[0].x, 0.74);
  tracker.update(frame([hand(-1, 0.27)], ["Right"]), 140);
  assert.equal(tracker.hands(140)[0]!.landmarks[0].x, 0.27);
});
test("brief dropout holds the last pose, then releases it; clear releases immediately", () => {
  const tracker = new HandPoseTracker();
  tracker.update(frame([hand(-1, 0.25)], ["Left"]), 0);
  tracker.update(frame([]), 70);
  assert.ok(tracker.hands(180)[0]);
  assert.equal(tracker.hands(181)[0], null);
  tracker.update(frame([hand(-1, 0.28)], ["Left"]), 200);
  const invalid = hand(-1, 0.4); invalid[9].x = Infinity;
  tracker.update(frame([invalid], ["Left"]), 250);
  assert.equal(tracker.hands(250)[0]!.landmarks[0].x, 0.28);
  tracker.clear();
  assert.deepEqual(tracker.hands(250), [null, null]);
});
test("a missing hand does not steal the visible hand and reacquisition uses handedness", () => {
  const tracker = new HandPoseTracker();
  tracker.update(frame([hand(-1, 0.7), hand(1, 0.3)], ["Left", "Right"]), 0);
  tracker.update(frame([hand(1, 0.32)], ["Right"]), 70);
  assert.equal(tracker.hands(70)[1]!.landmarks[0].x, 0.32);
  tracker.update(frame([hand(-1, 0.2)], ["Left"]), 1000);
  assert.equal(tracker.hands(1000)[0]!.landmarks[0].x, 0.2);
  assert.equal(tracker.hands(1000)[1], null);
});

test("motion continuity preserves crossing hands even during missing labels", () => {
  const tracker = new HandPoseTracker();
  tracker.update(frame([hand(-1, 0.25), hand(1, 0.75)], ["Left", "Right"]), 0);
  tracker.update(frame([hand(-1, 0.35), hand(1, 0.65)]), 70);
  tracker.update(frame([hand(1, 0.55), hand(-1, 0.45)]), 140);
  tracker.update(frame([hand(-1, 0.55), hand(1, 0.45)]), 210);
  assert.equal(tracker.hands(210)[0]!.landmarks[0].x, 0.55);
  assert.equal(tracker.hands(210)[1]!.landmarks[0].x, 0.45);
});

test("persistent reliable handedness recovers from an initially incorrect identity", () => {
  const tracker = new HandPoseTracker();
  tracker.update(frame([hand(-1, 0.2), hand(1, 0.8)], ["Right", "Left"]), 0);
  for (let sample = 1; sample <= 4; sample++)
    tracker.update(frame([hand(-1, 0.2), hand(1, 0.8)], ["Left", "Right"]), sample * 70);
  assert.equal(tracker.hands(280)[0]!.landmarks[0].x, 0.2);
  assert.equal(tracker.hands(280)[1]!.landmarks[0].x, 0.8);
});

test("degenerate world coordinates fall back to usable image landmarks", () => {
  const tracker = new HandPoseTracker();
  const f = frame([hand(-1, 0.25)], ["Left"]);
  f.handWorlds = [Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))];
  tracker.update(f, 0);
  const pose = tracker.hands(0)[0];
  assert.ok(pose);
  assert.equal(pose.landmarks[0].x, 0.25);
  assert.ok(pose.fingers.flat().every((q) => q.toArray().every(Number.isFinite)));
});
