import { Quaternion, Vector3 } from "three";
import { palmOrientation } from "./avatar-tracking.ts";
import type { Point, VisionFrame } from "./types.ts";

const bases = [5, 9, 13, 17, 1];
const up = new Vector3(0, 1, 0);
const identity = new Quaternion();
const finite = (p: Point | undefined) =>
  !!p && [p.x, p.y, p.z ?? 0].every(Number.isFinite);
export const validHand = (points: Point[] | undefined): points is Point[] =>
  !!points && points.length === 21 && points.every(finite);

export type HandPose = {
  landmarks: Point[];
  palm: Quaternion;
  fingers: Quaternion[][];
};

/** Solve in palm space, then undo the left rig's mirrored scale. Each bone
 * aims along its measured phalanx: curl, spread and thumb opposition all use
 * the same 3D landmarks, without treating a sideways finger as a bent one. */
export function fingerOrientations(
  points: Point[],
  side: number,
  world = true,
): Quaternion[][] | null {
  if (!validHand(points)) return null;
  const palm = palmOrientation(points, side, world);
  if (!palm) return null;
  const inverse = palm.clone().invert();
  const direction = (a: Point, b: Point) => {
    const v = new Vector3(
      b.x - a.x,
      -(b.y - a.y) * (world ? 1 : 0.75),
      -((b.z ?? 0) - (a.z ?? 0)),
    ).applyQuaternion(inverse);
    v.x *= side;
    return v;
  };
  const fingers: Quaternion[][] = [];
  for (const base of bases) {
    const parent = new Quaternion();
    const joints: Quaternion[] = [];
    for (let joint = 0; joint < 3; joint++) {
      const v = direction(points[base + joint], points[base + joint + 1]);
      if (v.lengthSq() < 1e-10) return null;
      v.normalize().applyQuaternion(parent.clone().invert());
      const q = new Quaternion().setFromUnitVectors(up, v);
      // Reject extreme folds caused by noisy/occluded fingertips while still
      // allowing a closed fist and the thumb's wider range at its base.
      const limit = base === 1 && joint === 0 ? 2.2 : 1.8;
      const angle = identity.angleTo(q);
      if (angle > limit) q.slerp(identity, 1 - limit / angle);
      joints.push(q);
      parent.multiply(q);
    }
    fingers.push(joints);
  }
  return fingers;
}

type Slot = {
  pose: HandPose;
  seen: number;
  labelConflicts: number;
  velocity: { x: number; y: number };
};
const HOLD_MS = 180;
const IDENTITY_MS = 650;

/** Detection order is not identity. Use handedness plus temporal proximity,
 * assigning each detection once, even if labels flicker or are duplicated. */
export class HandPoseTracker {
  private slots: Array<Slot | null> = [null, null];

  update(frame: VisionFrame, time: number): void {
    const candidates = frame.hands
      .map((landmarks, index) => ({ landmarks, index }))
      .filter(({ landmarks }) => validHand(landmarks))
      .filter(({ landmarks, index }) => {
        const world = frame.handWorlds?.[index];
        return (validHand(world) && palmOrientation(world, 1)) || palmOrientation(landmarks, 1, false);
      })
      .slice(0, 2);
    if (!candidates.length) return;
    const cost = (slot: number, candidate: number) => {
      const { landmarks, index } = candidates[candidate];
      const previous = this.slots[slot];
      const recent = previous && time - previous.seen < IDENTITY_MS;
      const center = landmarks[0];
      const label = frame.handLabels?.[index];
      const score = frame.handScores?.[index];
      const confidence = score !== undefined && Number.isFinite(score)
        ? Math.max(0, Math.min(1, score)) : 0.8;
      const labelMismatch = (label === "Left" && slot === 1) || (label === "Right" && slot === 0);
      const predict = recent ? Math.min(0.15, Math.max(0, time - previous.seen) / 1000) : 0;
      const distance = recent
        ? 2 * Math.hypot(
          center.x - previous.pose.landmarks[0].x - previous.velocity.x * predict,
          center.y - previous.pose.landmarks[0].y - previous.velocity.y * predict,
        )
        : Math.abs(center.x - (slot === 0 ? 0.25 : 0.75)) * 0.35;
      // A single label error yields to continuity; persistent confident labels
      // can correct a mistaken initial assignment instead of locking it in.
      const labelWeight = !recent ? 1.2 : previous.labelConflicts >= 3 ? 2.8 : 0.38;
      return distance + (labelMismatch ? labelWeight * confidence : 0);
    };
    const choices = candidates.length === 1 ? [[0, -1], [-1, 0]] : [[0, 1], [1, 0]];
    const assignment = choices.reduce((best, choice) => {
      const score = choice.reduce((sum, c, slot) => sum + (c < 0 ? 0 : cost(slot, c)), 0);
      return score < best.score ? { choice, score } : best;
    }, { choice: choices[0], score: Infinity }).choice;
    assignment.forEach((candidate, slot) => {
      if (candidate < 0) return;
      const { landmarks, index } = candidates[candidate];
      const world = frame.handWorlds?.[index];
      const points = validHand(world) ? world : landmarks;
      const side = slot === 0 ? -1 : 1;
      let palm = palmOrientation(points, side, validHand(world));
      let fingers = fingerOrientations(points, side, validHand(world));
      if ((!palm || !fingers) && points !== landmarks) {
        palm = palmOrientation(landmarks, side, false);
        fingers = fingerOrientations(landmarks, side, false);
      }
      if (palm && fingers) {
        const previous = this.slots[slot];
        const dt = previous ? (time - previous.seen) / 1000 : 0;
        const velocity = { x: 0, y: 0 };
        if (previous && dt > 0.015 && dt < 0.25) {
          for (const axis of ["x", "y"] as const) {
            const measured = (landmarks[0][axis] - previous.pose.landmarks[0][axis]) / dt;
            velocity[axis] = Math.max(-3, Math.min(3, 0.5 * measured + 0.5 * previous.velocity[axis]));
          }
        }
        const label = frame.handLabels?.[index];
        const mismatch = (label === "Left" && slot === 1) || (label === "Right" && slot === 0);
        const confident = (frame.handScores?.[index] ?? 0.8) >= 0.65;
        const labelConflicts = mismatch && confident && previous && time - previous.seen < IDENTITY_MS
          ? previous.labelConflicts + 1 : 0;
        this.slots[slot] = { pose: { landmarks, palm, fingers }, seen: time, velocity, labelConflicts };
      }
    });
  }

  hands(time: number): Array<HandPose | null> {
    return this.slots.map((slot) => slot && time - slot.seen <= HOLD_MS ? slot.pose : null);
  }

  clear(): void {
    this.slots = [null, null];
  }
}
