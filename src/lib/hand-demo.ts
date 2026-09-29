import { Euler, Vector3 } from "three";
import type { Point, VisionFrame } from "./types";

export type HandDemo = "open" | "spread" | "fist" | "pinch" | "turn" | "cross";

type SideHand = { world: Point[]; breath: number };

/** Synthetic landmarks feed the same solver as the camera; no separate
 * animation rig or hard-coded mesh rotations in the model preview. */
function buildSideHand(
  side: number,
  mode: HandDemo,
  seconds: number,
): SideHand {
  const breath = Math.sin(seconds * 1.3);
  const points: Vector3[] = Array.from({ length: 21 }, () => new Vector3());
  points[0].set(0, -0.065, 0);
  const starts = [
    [-0.025, 0.012],
    [0, 0.023],
    [0.018, 0.019],
    [0.033, 0.006],
    [-0.036, -0.032],
  ];
  const lengths = [
    [0.031, 0.024, 0.02],
    [0.037, 0.026, 0.022],
    [0.034, 0.024, 0.02],
    [0.025, 0.019, 0.016],
    [0.027, 0.022, 0.018],
  ];
  const bases = [5, 9, 13, 17, 1];
  bases.forEach((base, finger) => {
    points[base].set(starts[finger][0], starts[finger][1], 0);
    const curled = mode === "fist" || (mode === "pinch" && finger === 0);
    const curls = curled ? [0.95, 1.15, 0.65] : [0.12, 0.18, 0.14];
    let angle = 0;
    for (let joint = 0; joint < 3; joint++) {
      angle += curls[joint];
      let direction: Vector3;
      if (finger === 4) {
        const thumbClosing = mode === "fist" || mode === "pinch";
        direction = thumbClosing
          ? new Vector3(0.35 + joint * 0.2, 0.68 - joint * 0.1, 0.65)
          : new Vector3(-0.78, 0.63, 0.02 + joint * 0.03);
      } else {
        const spread =
          mode === "spread"
            ? [-0.35, -0.05, 0.15, 0.4][finger]
            : [-0.06, 0, 0.05, 0.12][finger];
        direction = new Vector3(
          spread * Math.cos(angle),
          Math.cos(angle),
          Math.sin(angle),
        );
      }
      points[base + joint + 1]
        .copy(points[base + joint])
        .add(direction.normalize().multiplyScalar(lengths[finger][joint]));
    }
  });
  const rotation = new Euler(
    0.03 * breath,
    mode === "turn" ? Math.sin(seconds * 0.9) * 2.6 : side * -0.08,
    side * -0.12,
  );
  const world = points.map((point) => {
    const p = point.clone();
    p.x *= side;
    p.applyEuler(rotation);
    return { x: p.x, y: -p.y, z: -p.z };
  });
  return { world, breath };
}

const screen = (world: Point[], centerX: number, breath: number, lift = 0): Point[] =>
  world.map((p) => ({
    x: centerX + p.x * 1.25,
    y: 0.56 - lift + p.y * 1.5 - breath * 0.01,
    z: (p.z ?? 0) * 1.25,
  }));

export function demoHandFrame(mode: HandDemo, seconds: number): VisionFrame {
  const sweep = (1 - Math.cos(seconds * 1.1)) / 2;
  const worlds: Point[][] = [];
  const hands: Point[][] = [];
  for (const side of [-1, 1]) {
    const { world, breath } = buildSideHand(side, mode, seconds);
    const centerX =
      mode === "cross" ? 0.5 + side * (0.22 - 0.42 * sweep) : 0.5 + side * 0.25;
    hands.push(screen(world, centerX, breath));
    worlds.push(world);
  }
  return {
    type: "frame",
    time: seconds * 1000,
    duration: 0,
    pose: [],
    hands,
    handWorlds: worlds,
    handLabels: ["Left", "Right"],
    handScores: [1, 1],
  };
}

/** One open right hand gliding from the body center outwards. The landing
 * showcase uses it as a living, camera-free gesture rehearsal. */
export function sweepHandFrame(
  seconds: number,
  span = 1,
  duration = 1.3,
): VisionFrame {
  const { world, breath } = buildSideHand(1, "open", seconds);
  const t = Math.min(1, Math.max(0, seconds / duration));
  const eased = t * t * (3 - 2 * t);
  const centerX = 0.58 + 0.42 * span * eased;
  const lift = 0.03 * Math.sin(Math.PI * eased);
  return {
    type: "frame",
    time: seconds * 1000,
    duration: 0,
    pose: [],
    hands: [screen(world, centerX, breath, lift)],
    handWorlds: [world],
    handLabels: ["Right"],
    handScores: [1],
  };
}
