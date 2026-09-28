import * as THREE from "three";
import type { Gesture, Point, VisionFrame } from "./types";

export type AvatarScene = {
  draw: (frame: VisionFrame) => void;
  clear: () => void;
  react: (gesture: Gesture) => void;
  setLocked: (locked: boolean) => void;
  dispose: () => void;
};

const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.lerp;

/** A small, real 3D character; the hand joints are driven by camera landmarks. */
export function createAvatarScene(host: HTMLElement): AvatarScene {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.domElement.className = "avatar-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2.2, 2.2, 0.82, -0.82, 0.1, 30);
  camera.position.set(0, 0.03, 7);
  camera.lookAt(0, 0.03, 0);
  scene.add(new THREE.AmbientLight(0x96bfff, 1.25));
  const key = new THREE.DirectionalLight(0xb9e0ff, 4.2);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x3888ff, 2.6);
  fill.position.set(3, 0.7, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x4ba6ff, 3.8);
  rim.position.set(1, 2, -3);
  scene.add(rim);

  const resources: Array<THREE.BufferGeometry | THREE.Material> = [];
  const sphere = new THREE.SphereGeometry(1, 40, 28);
  resources.push(sphere);
  const material = (color: number, roughness = 0.29) => {
    const value = new THREE.MeshPhysicalMaterial({
      color,
      roughness,
      metalness: 0.14,
      clearcoat: 1,
      clearcoatRoughness: 0.2,
      emissive: 0x061d56,
      emissiveIntensity: 0.15,
    });
    resources.push(value);
    return value;
  };
  const blue = material(0x1263e9);
  const dark = material(0x06142b, 0.4);
  const white = material(0xe7f6ff, 0.24);
  white.emissive.set(0x85cfff);
  white.emissiveIntensity = 0.13;
  const irisMat = material(0x079ad9, 0.22);
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  resources.push(highlightMat);
  const orb = (
    parent: THREE.Object3D,
    mat: THREE.Material,
    size: [number, number, number],
    position: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  };

  const head = new THREE.Group();
  head.position.y = 0.02;
  scene.add(head);
  orb(head, blue, [0.4, 0.5, 0.33], [0, 0.03, 0]);
  const eyes: THREE.Group[] = [],
    pupils: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.155, 0.1, 0.292);
    head.add(eye);
    eyes.push(eye);
    orb(eye, dark, [0.139, 0.178, 0.063], [0, 0, 0]);
    orb(eye, white, [0.112, 0.149, 0.06], [0, 0.006, 0.027]);
    const pupil = new THREE.Group();
    pupil.position.set(0.008, -0.005, 0.079);
    eye.add(pupil);
    pupils.push(pupil);
    orb(pupil, irisMat, [0.059, 0.075, 0.016], [0, 0, 0]);
    orb(pupil, dark, [0.032, 0.049, 0.012], [0, 0, 0.014]);
    orb(pupil, highlightMat, [0.018, 0.02, 0.009], [-0.022, 0.03, 0.026]);
    orb(pupil, highlightMat, [0.007, 0.008, 0.005], [0.019, -0.023, 0.026]);
  }
  const smileGeometry = new THREE.TorusGeometry(0.085, 0.012, 8, 24, Math.PI);
  resources.push(smileGeometry);
  const smile = new THREE.Mesh(smileGeometry, dark);
  smile.position.set(0, -0.19, 0.302);
  smile.scale.y = 0.5;
  smile.rotation.z = Math.PI;
  head.add(smile);

  const buildHand = (side: number) => {
    const group = new THREE.Group();
    group.position.set(side * 1.12, -0.06, 0.05);
    group.scale.setScalar(0.84);
    group.scale.x *= side;
    scene.add(group);
    const palmMaterial = material(0x2779f5);
    orb(group, palmMaterial, [0.205, 0.24, 0.098], [0, -0.015, 0]);
    orb(group, palmMaterial, [0.16, 0.115, 0.077], [0, -0.246, -0.014]);
    const cuffMat = material(0x082d70);
    orb(group, cuffMat, [0.169, 0.05, 0.087], [0, -0.318, -0.016]);
    const lengths = [
      [0.13, 0.09, 0.075],
      [0.145, 0.105, 0.08],
      [0.133, 0.1, 0.075],
      [0.105, 0.078, 0.065],
      [0.105, 0.09, 0.075],
    ];
    const starts = [
      [-0.145, 0.16],
      [-0.046, 0.202],
      [0.057, 0.183],
      [0.147, 0.122],
      [-0.178, -0.073],
    ];
    const fingers: THREE.Group[][] = [];
    lengths.forEach((segments, finger) => {
      const chain: THREE.Group[] = [];
      let parent: THREE.Object3D = group;
      segments.forEach((length, joint) => {
        const pivot = new THREE.Group();
        if (joint === 0) {
          pivot.position.set(starts[finger][0], starts[finger][1], 0.002);
          pivot.rotation.z = finger === 4 ? 0.84 : (1.5 - finger) * 0.065;
        } else pivot.position.y = segments[joint - 1];
        const radius = finger === 3 ? 0.048 : finger === 4 ? 0.061 : 0.055;
        const geometry = new THREE.CapsuleGeometry(
          radius,
          Math.max(0.016, length - radius * 1.1),
          6,
          12,
        );
        resources.push(geometry);
        const segment = new THREE.Mesh(geometry, palmMaterial);
        segment.position.y = length * 0.5;
        pivot.add(segment);
        parent.add(pivot);
        chain.push(pivot);
        parent = pivot;
      });
      fingers.push(chain);
    });
    return { group, fingers, material: palmMaterial, side };
  };
  const left = buildHand(-1),
    right = buildHand(1);
  let frame: VisionFrame | null = null;
  let lastFrameTime = -Infinity;
  let locked = false;
  let impulse: { gesture: Gesture; start: number } | null = null;
  let raf = 0,
    lastPaint = 0,
    disposed = false;
  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const v1 = new THREE.Vector3(),
    v2 = new THREE.Vector3();
  const bend = (a: Point, b: Point, c: Point) => {
    v1.set(b.x - a.x, (b.y - a.y) * 0.75, (b.z ?? 0) - (a.z ?? 0)).normalize();
    v2.set(c.x - b.x, (c.y - b.y) * 0.75, (c.z ?? 0) - (b.z ?? 0)).normalize();
    return clamp(Math.acos(clamp(v1.dot(v2), -1, 1)), 0, 1.5);
  };
  const updateHand = (
    rig: ReturnType<typeof buildHand>,
    landmarks: Point[] | undefined,
    elapsed: number,
    kick: number,
  ) => {
    const side = rig.side;
    let x = side * 1.12,
      y = -0.06,
      angle = -side * 0.17;
    if (landmarks?.length === 21) {
      const middle = landmarks[9],
        wrist = landmarks[0];
      x = clamp(
        (middle.x - 0.5) * 3.1,
        side < 0 ? -1.64 : 0.66,
        side < 0 ? -0.66 : 1.64,
      );
      y = clamp((0.49 - middle.y) * 1.55, -0.24, 0.16);
      angle = clamp(
        -Math.atan2(middle.x - wrist.x, wrist.y - middle.y),
        -0.8,
        0.8,
      );
      rig.material.emissiveIntensity = 0.24 + kick * 0.7;
    } else rig.material.emissiveIntensity = 0.1 + kick * 0.6;
    rig.group.position.x = smooth(rig.group.position.x, x, 0.2);
    rig.group.position.y = smooth(
      rig.group.position.y,
      y +
        (motionPreference.matches ? 0 : Math.sin(elapsed * 1.1 + side) * 0.009),
      0.2,
    );
    rig.group.position.z = smooth(
      rig.group.position.z,
      0.05 + kick * 0.18,
      0.25,
    );
    rig.group.rotation.z = smooth(rig.group.rotation.z, angle, 0.2);
    rig.group.rotation.y = smooth(rig.group.rotation.y, -side * 0.2, 0.15);
    rig.fingers.forEach((chain, finger) => {
      const base = [5, 9, 13, 17, 1][finger];
      const curls = landmarks
        ? [
            bend(landmarks[0], landmarks[base], landmarks[base + 1]) * 0.4,
            bend(landmarks[base], landmarks[base + 1], landmarks[base + 2]),
            bend(landmarks[base + 1], landmarks[base + 2], landmarks[base + 3]),
          ]
        : [0, 0.05, 0.06];
      chain.forEach((joint, i) => {
        joint.rotation.x = smooth(joint.rotation.x, curls[i], 0.23);
      });
    });
  };

  const paint = (time: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(paint);
    if (document.hidden || time - lastPaint < 30) return;
    lastPaint = time;
    const live = frame && time - lastFrameTime < 1400 ? frame : null;
    const elapsed = time / 1000;
    const progress = impulse ? (time - impulse.start) / 420 : 1;
    const kick =
      motionPreference.matches || progress >= 1
        ? 0
        : Math.sin(progress * Math.PI) * 0.6;
    const direction =
      impulse?.gesture === "next"
        ? 1
        : impulse?.gesture === "previous"
          ? -1
          : 0;
    let rotationX = -0.06,
      rotationY = 0,
      rotationZ = 0,
      headX = 0;
    if (live && live.pose.length > 8) {
      const nose = live.pose[0],
        a = live.pose[2],
        b = live.pose[5];
      const eyeLeft = a.x < b.x ? a : b,
        eyeRight = a.x < b.x ? b : a;
      const eyeSpan = Math.max(0.035, eyeRight.x - eyeLeft.x);
      rotationY = clamp(
        ((nose.x - (a.x + b.x) / 2) / eyeSpan) * 1.1,
        -0.42,
        0.42,
      );
      rotationX = clamp(
        ((nose.y - (a.y + b.y) / 2) / eyeSpan - 0.45) * 0.6,
        -0.25,
        0.25,
      );
      rotationZ = clamp(
        -Math.atan2((eyeRight.y - eyeLeft.y) * 0.75, eyeSpan),
        -0.32,
        0.32,
      );
      headX = clamp((nose.x - 0.5) * 0.65, -0.18, 0.18);
    }
    head.position.x = smooth(head.position.x, headX, 0.15);
    head.position.y =
      0.02 + (motionPreference.matches ? 0 : Math.sin(elapsed * 1.35) * 0.009);
    head.rotation.x = smooth(head.rotation.x, rotationX, 0.15);
    head.rotation.y = smooth(
      head.rotation.y,
      rotationY + direction * kick * 0.15,
      0.18,
    );
    head.rotation.z = smooth(head.rotation.z, rotationZ, 0.18);
    const blinkCycle = time % 4700;
    const blink =
      !motionPreference.matches && blinkCycle < 150
        ? 1 - Math.sin((blinkCycle / 150) * Math.PI) * 0.93
        : 1;
    eyes.forEach((eye) => {
      eye.scale.y = blink * (locked ? 0.82 : 1);
    });
    pupils.forEach((pupil) => {
      pupil.position.x = smooth(
        pupil.position.x,
        0.008 + rotationY * 0.047 + direction * kick * 0.035,
        0.23,
      );
    });
    blue.emissiveIntensity = (locked ? 0.06 : 0.15) + kick * 0.25;
    const ordered =
      live?.hands
        .filter((points) => points.length === 21)
        .sort((a, b) => a[9].x - b[9].x) ?? [];
    const leftPoints = ordered.find((points) => points[9].x < 0.5);
    const rightPoints = [...ordered]
      .reverse()
      .find((points) => points[9].x >= 0.5);
    updateHand(left, leftPoints, elapsed, direction <= 0 ? kick : 0);
    updateHand(right, rightPoints, elapsed, direction >= 0 ? kick : 0);
    renderer.render(scene, camera);
    host.dataset.avatarReady = "true";
    host.dataset.tracking = live ? "true" : "false";
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.left = -aspect * 0.82;
    camera.right = aspect * 0.82;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  raf = requestAnimationFrame(paint);
  return {
    draw: (next) => {
      frame = next;
      lastFrameTime = performance.now();
    },
    clear: () => {
      frame = null;
    },
    react: (gesture) => {
      impulse = { gesture, start: performance.now() };
    },
    setLocked: (value) => {
      locked = value;
    },
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
