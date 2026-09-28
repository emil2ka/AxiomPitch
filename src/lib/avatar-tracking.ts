import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Point } from "./types.ts";

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const valid = (p: Point | undefined) =>
  p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  Number.isFinite(p.z ?? 0);

/** World coordinates avoid perspective distortion when a palm turns sideways. */
export function palmOrientation(
  points: Point[],
  side: number,
  world = true,
): Quaternion | null {
  if (![0, 5, 9, 17].every((i) => valid(points[i]))) return null;
  const vector = (a: Point, b: Point) =>
    new Vector3(
      b.x - a.x,
      -(b.y - a.y) * (world ? 1 : 0.75),
      -((b.z ?? 0) - (a.z ?? 0)),
    );
  const x = vector(points[5], points[17]).multiplyScalar(side);
  const y = vector(points[0], points[9]);
  if (x.lengthSq() < 1e-8 || y.lengthSq() < 1e-8) return null;
  y.normalize();
  x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-8) return null;
  x.normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, y, z),
  );
}

/** Pose gives approximate head orientation without loading a third ML model. */
export function headOrientation(
  pose: Point[],
  world?: Point[],
): Quaternion | null {
  if (
    ![0, 2, 5].every((i) => valid(pose[i]) && (pose[i].visibility ?? 1) > 0.45)
  )
    return null;
  const nose = pose[0],
    a = pose[2],
    b = pose[5];
  const left = a.x < b.x ? a : b,
    right = a.x < b.x ? b : a;
  const span = Math.max(0.025, right.x - left.x);
  let yaw = clamp(((nose.x - (a.x + b.x) / 2) / span) * 1.7, -0.9, 0.9);
  if (
    world &&
    [7, 8].every((i) => valid(world[i]) && (pose[i]?.visibility ?? 1) > 0.55)
  ) {
    const l = pose[7].x < pose[8].x ? world[7] : world[8];
    const r = pose[7].x < pose[8].x ? world[8] : world[7];
    if (Math.abs(r.x - l.x) > 0.015)
      yaw = clamp(
        Math.atan2((r.z ?? 0) - (l.z ?? 0), Math.abs(r.x - l.x)),
        -1.05,
        1.05,
      );
  }
  const pitch = clamp(
    ((nose.y - (a.y + b.y) / 2) / span - 0.45) * 0.8,
    -0.4,
    0.4,
  );
  const roll = clamp(-Math.atan2((right.y - left.y) * 0.75, span), -0.6, 0.6);
  return new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, "YXZ"));
}
