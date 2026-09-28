import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Vector3 } from "three";
import {
  headOrientation,
  palmOrientation,
} from "../src/lib/avatar-tracking.ts";
import type { Point } from "../src/lib/types.ts";

function palm(side = 1): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  points[0] = { x: 0, y: 0.2, z: 0 };
  points[9] = { x: 0, y: 0, z: 0 };
  points[5] = { x: -0.1 * side, y: 0, z: 0 };
  points[17] = { x: 0.1 * side, y: 0, z: 0 };
  return points;
}
test("both mirrored palms face forward with the same neutral orientation", () => {
  for (const side of [-1, 1]) {
    const q = palmOrientation(palm(side), side)!;
    assert.ok(q);
    assert.ok(
      new Vector3(0, 0, 1).applyQuaternion(q).distanceTo(new Vector3(0, 0, 1)) <
        1e-6,
    );
  }
});
test("palm follows depth rotation, including sideways and back of hand", () => {
  for (const angle of [Math.PI / 2, Math.PI * 0.85, -Math.PI / 3]) {
    const points = palm().map((p) => {
      const v = new Vector3(p.x, -p.y, -p.z!).applyAxisAngle(
        new Vector3(0, 1, 0),
        angle,
      );
      return { x: v.x, y: -v.y, z: -v.z };
    });
    const q = palmOrientation(points, 1)!;
    const expected = new Vector3(0, 0, 1).applyAxisAngle(
      new Vector3(0, 1, 0),
      angle,
    );
    assert.ok(
      new Vector3(0, 0, 1).applyQuaternion(q).distanceTo(expected) < 1e-6,
    );
  }
});
test("palm roll is independent of its position on screen", () => {
  const angle = Math.PI / 4;
  const points = palm().map((p) => {
    const v = new Vector3(p.x, -p.y, 0).applyAxisAngle(
      new Vector3(0, 0, 1),
      angle,
    );
    return { x: v.x + 12, y: -v.y - 3, z: 0 };
  });
  const q = palmOrientation(points, 1)!;
  assert.ok(Math.abs(new Euler().setFromQuaternion(q).z - angle) < 1e-6);
});
test("invalid and degenerate landmarks are ignored", () => {
  assert.equal(palmOrientation([], 1), null);
  assert.equal(
    palmOrientation(
      Array.from({ length: 21 }, () => ({ x: 0, y: 0 })),
      1,
    ),
    null,
  );
  const points = palm();
  points[9].x = NaN;
  assert.equal(palmOrientation(points, 1), null);
  assert.equal(headOrientation([]), null);
});
test("head yaw uses depth of ears and disappears when face visibility is low", () => {
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  pose[0].y = 0.545;
  pose[2].x = 0.45;
  pose[5].x = 0.55;
  pose[7].x = 0.4;
  pose[8].x = 0.6;
  const world = pose.map((p) => ({ ...p }));
  world[8].z = 0.2;
  const q = headOrientation(pose, world)!;
  assert.ok(
    Math.abs(new Euler().setFromQuaternion(q, "YXZ").y - Math.PI / 4) < 1e-6,
  );
  pose[0].visibility = 0.1;
  assert.equal(headOrientation(pose, world), null);
});
