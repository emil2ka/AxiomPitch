import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { headOrientation, palmOrientation } from "./avatar-tracking";
import type { Gesture, Point, VisionFrame } from "./types";

export type AvatarScene = {
  draw: (frame: VisionFrame) => void;
  clear: () => void;
  react: (gesture: Gesture) => void;
  setLocked: (locked: boolean) => void;
  diagnostics: () => { calls: number; triangles: number; paints: number };
  dispose: () => void;
};

const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.lerp;

/** Tiny friendly character. Each entire hand is one mesh with articulated bones. */
export function createAvatarScene(host: HTMLElement): AvatarScene {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "avatar-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2.2, 2.2, 0.82, -0.82, 0.1, 30);
  camera.position.set(0, 0, 7);
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const key = new THREE.DirectionalLight(0xe3f2ff, 2.1);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const resources: Array<
    THREE.BufferGeometry | THREE.Material | THREE.Skeleton
  > = [];
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  resources.push(sphere);
  const material = () => {
    const mat = new THREE.MeshLambertMaterial({
      color: 0x619cff,
      emissive: 0x16346b,
      emissiveIntensity: 0.1,
    });
    resources.push(mat);
    return mat;
  };
  const blue = material();
  const white = new THREE.MeshBasicMaterial({ color: 0xf2faff });
  resources.push(white);
  const orb = (
    parent: THREE.Object3D,
    mat: THREE.Material,
    size: number[],
    position: number[],
  ) => {
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.position.set(position[0], position[1], position[2]);
    parent.add(mesh);
    return mesh;
  };
  const head = new THREE.Group();
  head.position.y = 0.07;
  scene.add(head);
  // A wide, soft pebble silhouette avoids the uncanny human/egg proportions.
  orb(head, blue, [0.41, 0.355, 0.28], [0, 0, 0]);
  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    eyes.push(
      orb(head, white, [0.043, 0.055, 0.015], [side * 0.13, 0.038, 0.269]),
    );
  }
  const smilePath = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.065, -0.077, 0.273),
    new THREE.Vector3(0, -0.116, 0.285),
    new THREE.Vector3(0.065, -0.077, 0.273),
  );
  const smileGeometry = new THREE.TubeGeometry(smilePath, 12, 0.008, 5, false);
  resources.push(smileGeometry);
  head.add(new THREE.Mesh(smileGeometry, white));

  const buildHand = (side: number) => {
    const group = new THREE.Group();
    group.position.set(side * 0.94, -0.16, 0.02);
    group.scale.set(0.64 * side, 0.64, 0.64);
    scene.add(group);
    const palmMaterial = material();
    const root = new THREE.Bone();
    const bones = [root];
    const fingers: THREE.Bone[][] = [];
    const parts: THREE.BufferGeometry[] = [];
    const addSkin = (
      geometry: THREE.BufferGeometry,
      weightAt: (i: number) => [number, number, number],
    ) => {
      const count = geometry.attributes.position.count;
      const indices = new Uint16Array(count * 4),
        weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const [a, b, blend] = weightAt(i);
        indices[i * 4] = a;
        indices[i * 4 + 1] = b;
        weights[i * 4] = 1 - blend;
        weights[i * 4 + 1] = blend;
      }
      geometry.setAttribute(
        "skinIndex",
        new THREE.Uint16BufferAttribute(indices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(weights, 4),
      );
      parts.push(geometry);
    };
    for (const [scale, position] of [
      [
        [0.19, 0.225, 0.09],
        [0, -0.018, 0],
      ],
      [
        [0.12, 0.11, 0.073],
        [0, -0.215, -0.012],
      ],
    ]) {
      const geo = new THREE.SphereGeometry(1, 16, 12);
      geo.scale(scale[0], scale[1], scale[2]);
      geo.translate(position[0], position[1], position[2]);
      addSkin(geo, () => [0, 0, 0]);
    }
    const starts = [
      [-0.127, 0.13],
      [-0.043, 0.175],
      [0.046, 0.15],
      [0.124, 0.105],
      [-0.163, -0.065],
    ];
    const lengths = [
      [0.11, 0.085, 0.07],
      [0.13, 0.09, 0.075],
      [0.12, 0.085, 0.07],
      [0.09, 0.065, 0.055],
      [0.09, 0.07, 0.055],
    ];
    lengths.forEach((segments, finger) => {
      const chain: THREE.Bone[] = [];
      const firstIndex = bones.length;
      let parent: THREE.Bone = root;
      segments.forEach((_, joint) => {
        const bone = new THREE.Bone();
        if (joint === 0) {
          bone.position.set(starts[finger][0], starts[finger][1], 0.002);
          bone.rotation.z = finger === 4 ? 0.85 : (1.5 - finger) * 0.1;
        } else bone.position.y = segments[joint - 1];
        parent.add(bone);
        bones.push(bone);
        chain.push(bone);
        parent = bone;
      });
      root.updateMatrixWorld(true);
      const total = segments.reduce((sum, v) => sum + v, 0);
      const radius = finger === 3 ? 0.035 : 0.041;
      // One continuous surface; skin weights smoothly connect all three joints.
      const geo = new THREE.CapsuleGeometry(
        radius,
        total - 2 * radius,
        4,
        8,
        6,
      );
      geo.translate(0, total / 2 - 0.016, 0);
      addSkin(geo, (i) => {
        const y = Math.max(0, geo.attributes.position.getY(i));
        const segment = y < segments[0] ? 0 : 1;
        const blend = clamp(
          (y - (segment ? segments[0] : 0)) / segments[segment],
          0,
          1,
        );
        return [firstIndex + segment, firstIndex + segment + 1, blend];
      });
      geo.applyMatrix4(chain[0].matrixWorld);
      fingers.push(chain);
    });
    const geometry = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    resources.push(geometry);
    const mesh = new THREE.SkinnedMesh(geometry, palmMaterial);
    mesh.frustumCulled = false;
    mesh.add(root);
    group.add(mesh);
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);
    resources.push(skeleton);
    return {
      group,
      fingers,
      material: palmMaterial,
      side,
      target: new THREE.Quaternion(),
    };
  };
  const left = buildHand(-1),
    right = buildHand(1);
  const neutralHead = new THREE.Quaternion();
  const headTarget = new THREE.Quaternion();
  const handRest = (side: number) =>
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.12, -side * 0.24, -side * 0.22),
    );
  const leftRest = handRest(-1),
    rightRest = handRest(1);
  let frame: VisionFrame | null = null,
    lastFrameTime = -Infinity;
  let locked = false,
    impulse: { gesture: Gesture; start: number } | null = null;
  let raf = 0,
    lastPaint = -Infinity,
    disposed = false,
    paints = 0,
    awakeUntil = performance.now() + 650;
  let previousBlink = false,
    previousLive = false;
  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const v1 = new THREE.Vector3(),
    v2 = new THREE.Vector3();
  const bend = (a: Point, b: Point, c: Point) => {
    v1.set(b.x - a.x, -(b.y - a.y), (b.z ?? 0) - (a.z ?? 0));
    v2.set(c.x - b.x, -(c.y - b.y), (c.z ?? 0) - (b.z ?? 0));
    if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) return 0;
    return clamp(
      Math.acos(clamp(v1.normalize().dot(v2.normalize()), -1, 1)),
      0,
      1.5,
    );
  };
  const updateHand = (
    rig: ReturnType<typeof buildHand>,
    index: number,
    live: VisionFrame | null,
    kick: number,
  ) => {
    const landmarks = index >= 0 ? live?.hands[index] : undefined;
    const world = index >= 0 ? live?.handWorlds?.[index] : undefined;
    let x = rig.side * 0.94,
      y = -0.16;
    rig.target.copy(rig.side < 0 ? leftRest : rightRest);
    if (landmarks?.length === 21) {
      x = clamp((landmarks[9].x - 0.5) * 3.2, -1.65, 1.65);
      y = clamp((0.5 - landmarks[9].y) * 1.6, -0.31, 0.24);
      const q = palmOrientation(
        world?.length === 21 ? world : landmarks,
        rig.side,
        !!world?.length,
      );
      if (q) rig.target.copy(q);
    }
    rig.group.position.x = smooth(rig.group.position.x, x, 0.24);
    rig.group.position.y = smooth(rig.group.position.y, y, 0.24);
    rig.group.position.z = smooth(
      rig.group.position.z,
      0.02 + kick * 0.1,
      0.24,
    );
    rig.group.quaternion.slerp(rig.target, 0.24);
    rig.material.emissiveIntensity = 0.1 + kick * 0.25;
    const points = world?.length === 21 ? world : landmarks;
    rig.fingers.forEach((chain, finger) => {
      const base = [5, 9, 13, 17, 1][finger];
      const curls =
        points?.length === 21
          ? [
              bend(points[0], points[base], points[base + 1]) * 0.35,
              bend(points[base], points[base + 1], points[base + 2]),
              bend(points[base + 1], points[base + 2], points[base + 3]),
            ]
          : [0.08, 0.13, 0.1];
      chain.forEach((joint, i) => {
        joint.rotation.x = smooth(joint.rotation.x, curls[i], 0.25);
      });
    });
  };
  const wake = (duration = 700) => {
    awakeUntil = Math.max(awakeUntil, performance.now() + duration);
  };
  const paint = (time: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(paint);
    if (document.hidden || time - lastPaint < 1000 / 30) return;
    const live = frame && time - lastFrameTime < 1000 ? frame : null;
    const blinking = !motionPreference.matches && time % 4800 < 160;
    if (blinking !== previousBlink || !!live !== previousLive) wake();
    previousBlink = blinking;
    previousLive = !!live;
    // No continuous GPU work for a stationary, camera-off character.
    if (!live && time > awakeUntil && !blinking) return;
    lastPaint = time;
    const progress = impulse ? (time - impulse.start) / 420 : 1;
    const kick =
      motionPreference.matches || progress >= 1
        ? 0
        : Math.sin(progress * Math.PI) * 0.5;
    const direction =
      impulse?.gesture === "next"
        ? 1
        : impulse?.gesture === "previous"
          ? -1
          : 0;
    headTarget.copy(
      live
        ? (headOrientation(live.pose, live.poseWorld) ?? neutralHead)
        : neutralHead,
    );
    head.quaternion.slerp(headTarget, 0.22);
    head.position.x = smooth(
      head.position.x,
      live?.pose[0] ? clamp((live.pose[0].x - 0.5) * 0.6, -0.18, 0.18) : 0,
      0.2,
    );
    const blink = blinking
      ? 1 - Math.sin(((time % 4800) / 160) * Math.PI) * 0.88
      : 1;
    eyes.forEach((eye) => {
      eye.scale.y = 0.055 * blink * (locked ? 0.8 : 1);
    });
    blue.emissiveIntensity = 0.1 + kick * 0.15;
    let li = -1,
      ri = -1;
    live?.hands.forEach((points, index) => {
      if (points.length !== 21) return;
      const label = live.handLabels?.[index];
      // Labels preserve identity when the hands cross the centre of the image.
      const isLeft = label ? label === "Left" : points[9].x < 0.5;
      if (isLeft) li = index;
      else ri = index;
    });
    updateHand(left, li, live, direction <= 0 ? kick : 0);
    updateHand(right, ri, live, direction >= 0 ? kick : 0);
    renderer.render(scene, camera);
    paints++;
    host.dataset.avatarReady = "true";
    host.dataset.tracking = live ? "true" : "false";
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.left = (-width / height) * 0.82;
    camera.right = (width / height) * 0.82;
    camera.updateProjectionMatrix();
    wake();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  raf = requestAnimationFrame(paint);
  return {
    draw: (next) => {
      frame = next;
      lastFrameTime = performance.now();
      wake();
    },
    clear: () => {
      frame = null;
      wake();
    },
    react: (gesture) => {
      impulse = { gesture, start: performance.now() };
      wake();
    },
    setLocked: (value) => {
      locked = value;
      wake();
    },
    diagnostics: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      paints,
    }),
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      resources.forEach((resource) => resource.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
