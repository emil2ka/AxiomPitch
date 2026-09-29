import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildHandSurface } from "./hand-mesh";
import type { FingerBinding } from "./hand-mesh";
import { headOrientation } from "./avatar-tracking";
import { HandPoseTracker } from "./hand-tracking";
import type { HandPose } from "./hand-tracking";
import type { Gesture, VisionFrame } from "./types";

export type AvatarExpression = "calm" | "sorry" | "hint" | "happy" | "wow";
export type LessonMotion = "idle" | "hello" | "next" | "previous" | "hold" | "success";
export type AvatarOptions = { face?: "none" | "expressive"; headStyle?: "solid" | "ghost" };

export type AvatarScene = {
  draw: (frame: VisionFrame) => void;
  clear: () => void;
  react: (gesture: Gesture) => void;
  setLocked: (locked: boolean) => void;
  setExpression: (expression: AvatarExpression) => void;
  setLesson: (motion: LessonMotion | null) => void;
  diagnostics: () => { calls: number; triangles: number; paints: number };
  dispose: () => void;
};

const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.lerp;

type FacePose = {
  browLift: number;
  browTilt: number;
  eyeOpen: number;
  eyeWide: number;
  glance: number;
  smile: number;
  mouthOpen: number;
  tilt: number;
};
const FACE_REST: FacePose = {
  browLift: 0,
  browTilt: 0,
  eyeOpen: 1,
  eyeWide: 1,
  glance: 0,
  smile: 1,
  mouthOpen: 0,
  tilt: 0,
};
const FACE_SHAPES: Record<AvatarExpression, Partial<FacePose>> = {
  calm: {},
  sorry: {
    browTilt: 0.34,
    browLift: -0.004,
    eyeOpen: 0.62,
    glance: -0.008,
    smile: 0.5,
    tilt: -0.07,
  },
  hint: { browLift: 0.017, eyeOpen: 1.03, smile: 0.78, mouthOpen: 0.5, tilt: 0.1 },
  happy: {
    browLift: 0.013,
    eyeOpen: 0.45,
    eyeWide: 1.05,
    smile: 1.32,
    tilt: 0.05,
  },
  wow: { browLift: 0.024, eyeWide: 1.16, mouthOpen: 0.95, smile: 0.42 },
};

/** Tiny friendly character. Each entire hand is one skinned mesh with
 * articulated bones; with `face: "none"` the head stays a quiet faceless
 * mask and all personality moves into the hands. */
export function createAvatarScene(
  host: HTMLElement,
  options: AvatarOptions = {},
): AvatarScene {
  const ghostHead = options.headStyle === "ghost";
  const expressive = !ghostHead && (options.face ?? "expressive") === "expressive";
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "avatar-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2.2, 2.2, 0.82, -0.82, 0.1, 30);
  camera.position.set(0, 0, 7);
  scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x263e69, 1.2));
  const key = new THREE.DirectionalLight(0xf4f8ff, 2.5);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x79b8ff, 2);
  rim.position.set(3, 1, -3);
  scene.add(rim);
  const resources: Array<
    THREE.BufferGeometry | THREE.Material | THREE.Skeleton
  > = [];
  const sphere = new THREE.SphereGeometry(1, 40, 28);
  resources.push(sphere);
  const skin = (color: number, roughness: number, clearcoat: number) => {
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness,
      metalness: 0,
      clearcoat,
      clearcoatRoughness: 0.52,
      sheen: 0.45,
      sheenColor: new THREE.Color(0xa9cdff),
      emissive: 0x16346b,
      emissiveIntensity: 0.022,
    });
    resources.push(mat);
    return mat;
  };
  const blue = skin(0x527dba, 0.65, 0.12);
  if (ghostHead) {
    blue.color.setHex(0x91b4d2);
    blue.transparent = true;
    blue.opacity = 0.16;
    blue.depthWrite = false;
    blue.roughness = 0.65;
    blue.clearcoat = 0.12;
  }
  const handSkin = () => {
    const material = skin(0x609ed1, 0.46, 0.24);
    material.sheen = 0.22;
    material.clearcoatRoughness = 0.38;
    if (ghostHead) {
      material.wireframe = true;
      material.color.setHex(0x9ba8b8);
      material.transparent = true;
      material.opacity = .48;
      material.depthWrite = false;
      material.emissiveIntensity = 0;
      material.clearcoat = 0;
      material.sheen = 0;
    }
    return material;
  };
  const white = new THREE.MeshBasicMaterial({ color: 0xd9e4f2, transparent: true, opacity: 0.72 });
  resources.push(white);
  const ink = new THREE.MeshStandardMaterial({ color: 0x071e3b, roughness: 0.24 });
  resources.push(ink);
  const nailInk = skin(0x90baf0, 0.52, 0.18);
  const creaseMaterial = new THREE.MeshStandardMaterial({ color: 0x2a62a2, transparent: true, opacity: 0.09, roughness: 0.8 });
  resources.push(creaseMaterial);
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
  const headTilt = new THREE.Group();
  headTilt.position.set(0, 0.3, -0.45);
  headTilt.scale.setScalar(0.34);
  scene.add(headTilt);
  const head = new THREE.Group();
  headTilt.add(head);
  if (ghostHead) {
    // A hollow globe: latitude rings and meridians, no filled surface inside.
    headTilt.scale.setScalar(0.62);
    const material = new THREE.LineBasicMaterial({ color: 0xa5b0be, transparent: true, opacity: .5, depthWrite: false });
    resources.push(material);
    const radius = .38;
    const addRing = (points: THREE.Vector3[]) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      resources.push(geometry);
      head.add(new THREE.LineLoop(geometry, material));
    };
    for (let latitude = -3; latitude <= 3; latitude++) {
      const angle = latitude * Math.PI / 8;
      addRing(Array.from({ length: 80 }, (_, i) => {
        const t = i * Math.PI * 2 / 80;
        return new THREE.Vector3(radius * Math.cos(angle) * Math.cos(t), radius * Math.sin(angle), radius * Math.cos(angle) * Math.sin(t));
      }));
    }
    for (let meridian = 0; meridian < 8; meridian++) {
      const angle = meridian * Math.PI / 8;
      addRing(Array.from({ length: 80 }, (_, i) => {
        const t = i * Math.PI * 2 / 80;
        return new THREE.Vector3(radius * Math.sin(t) * Math.cos(angle), radius * Math.cos(t), radius * Math.sin(t) * Math.sin(angle));
      }));
    }
    head.rotation.y = .24;
  } else orb(head, blue, [0.43, 0.315, 0.255], [0, 0, 0]);
  const eyeBaseY = 0.025;
  const eyes: THREE.Group[] = [];
  let smile: THREE.Mesh | null = null;
  let openMouth: THREE.Mesh | null = null;
  if (expressive) {
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.135, eyeBaseY, 0.244);
      orb(eye, white, [0.022, 0.033, 0.012], [0, 0, 0]);
      head.add(eye);
      eyes.push(eye);
    }
    const smilePath = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.047, -0.077, 0.248),
      new THREE.Vector3(0, -0.097, 0.261),
      new THREE.Vector3(0.047, -0.077, 0.248),
    );
    const smileGeometry = new THREE.TubeGeometry(smilePath, 16, 0.0055, 6, false);
    resources.push(smileGeometry);
    smile = new THREE.Mesh(smileGeometry, ink);
    head.add(smile);
    const mouthGeometry = new THREE.SphereGeometry(1, 24, 16);
    mouthGeometry.scale(0.031, 0.024, 0.011);
    resources.push(mouthGeometry);
    openMouth = new THREE.Mesh(mouthGeometry, ink);
    openMouth.position.set(0, -0.085, 0.25);
    openMouth.visible = false;
    head.add(openMouth);
  }

  const buildHand = (side: number) => {
    const group = new THREE.Group();
    group.position.set(side * 0.64, -0.2, 0.24);
    group.scale.set(1.06 * side, 1.06, 1.06);
    scene.add(group);
    const palmMaterial = handSkin();
    const root = new THREE.Bone();
    const bones = [root];
    const fingers: THREE.Bone[][] = [];
    const bindings: FingerBinding[] = [];
    const nailParts: THREE.BufferGeometry[] = [];
    const creaseParts: THREE.BufferGeometry[] = [];
    const addSkin = (
      parts: THREE.BufferGeometry[],
      geometry: THREE.BufferGeometry,
      weightAt: (
        i: number,
        source: THREE.BufferGeometry,
      ) => [number, number, number],
    ) => {
      // Merging needs one attribute layout: keep every part non-indexed.
      const source = geometry.index ? geometry.toNonIndexed() : geometry;
      if (source !== geometry) geometry.dispose();
      const count = source.attributes.position.count;
      const indices = new Uint16Array(count * 4),
        weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const [a, b, blend] = weightAt(i, source);
        indices[i * 4] = a;
        indices[i * 4 + 1] = b;
        weights[i * 4] = 1 - blend;
        weights[i * 4 + 1] = blend;
      }
      source.setAttribute(
        "skinIndex",
        new THREE.Uint16BufferAttribute(indices, 4),
      );
      source.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(weights, 4),
      );
      parts.push(source);
    };
    for (const y of [-0.025, -0.085]) {
      const path = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-0.08, y + 0.015, 0.058),
        new THREE.Vector3(0, y - 0.025, 0.069),
        new THREE.Vector3(0.09, y + 0.01, 0.057),
      );
      addSkin(creaseParts, new THREE.TubeGeometry(path, 20, 0.002, 5, false), () => [0, 0, 0]);
    }
    const thumbFold = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.11, 0.025, 0.055),
      new THREE.Vector3(-0.05, -0.075, 0.074),
      new THREE.Vector3(-0.065, -0.14, 0.046),
    );
    addSkin(creaseParts, new THREE.TubeGeometry(thumbFold, 24, 0.0014, 5, false), () => [0, 0, 0]);
    const starts = [
      [-0.119, 0.119],
      [-0.038, 0.151],
      [0.046, 0.135],
      [0.116, 0.085],
      [-0.141, -0.045],
    ];
    const lengths = [
      [0.112, 0.086, 0.07],
      [0.128, 0.092, 0.076],
      [0.122, 0.088, 0.072],
      [0.09, 0.066, 0.056],
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
      const radius = finger === 3 ? 0.028 : finger === 4 ? 0.042 : 0.036;
      const matrix = chain[0].matrixWorld;
      bindings.push({ matrix: matrix.clone(), firstIndex, segments, radius });
      // A flattened nail sits mostly flush with the dorsal tip.
      const nail = new THREE.SphereGeometry(1, 10, 8);
      nail.scale(radius * 0.52, radius * 0.68, 0.0055);
      nail.translate(0, total - 0.04, -(radius * 0.72));
      nail.applyMatrix4(matrix);
      addSkin(nailParts, nail, () => [firstIndex + 2, firstIndex + 2, 0]);
      for (let joint = 0; joint < 2; joint++) {
        const y = segments[0] + (joint ? segments[1] : 0);
        const r = radius * (1 - .19 * y / total);
        const fold = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-r * .53, y + .002, r * .72),
          new THREE.Vector3(0, y - .004, r * .87),
          new THREE.Vector3(r * .53, y + .002, r * .72),
        );
        const geometry = new THREE.TubeGeometry(fold, 10, 0.0011, 4, false);
        geometry.applyMatrix4(matrix);
        addSkin(creaseParts, geometry, () => [firstIndex + joint, firstIndex + joint + 1, .5]);
      }
      fingers.push(chain);
    });
    const geometry = buildHandSurface(bindings, palmMaterial, ghostHead ? 28 : 96);
    resources.push(geometry);
    const mesh = new THREE.SkinnedMesh(geometry, palmMaterial);
    mesh.frustumCulled = false;
    mesh.add(root);
    group.add(mesh);
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);
    resources.push(skeleton);
    const nailGeometry = mergeGeometries(nailParts)!;
    nailParts.forEach((part) => part.dispose());
    resources.push(nailGeometry);
    const nails = new THREE.SkinnedMesh(nailGeometry, nailInk);
    nails.frustumCulled = false;
    nails.bind(skeleton);
    group.add(nails);
    nails.visible = !ghostHead;
    const creaseGeometry = mergeGeometries(creaseParts)!;
    creaseParts.forEach((part) => part.dispose());
    resources.push(creaseGeometry);
    const creases = new THREE.SkinnedMesh(creaseGeometry, creaseMaterial);
    creases.frustumCulled = false;
    creases.bind(skeleton);
    group.add(creases);
    creases.visible = !ghostHead;
    return {
      group,
      fingers,
      material: palmMaterial,
      side,
      target: new THREE.Quaternion(),
      restFingers: fingers.map((chain, finger) =>
        chain.map((bone, index) => {
          const curl = [
            [0.16, 0.24, 0.2],
            [0.18, 0.28, 0.24],
            [0.24, 0.34, 0.28],
            [0.34, 0.46, 0.38],
            [0.14, 0.22, 0.18],
          ][finger][index];
          const splay =
            index === 0 ? [-0.06, -0.02, 0.04, 0.12, 0.1][finger] : 0;
          return new THREE.Quaternion().setFromEuler(
            new THREE.Euler(curl, 0, (index === 0 ? bone.rotation.z : 0) + splay),
          );
        }),
      ),
    };
  };
  const left = buildHand(-1),
    right = buildHand(1);
  const neutralHead = new THREE.Quaternion();
  const headTarget = new THREE.Quaternion();
  const handRest = (side: number) =>
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.18, -side * 0.18, -side * 0.14),
    );
  const leftRest = handRest(-1),
    rightRest = handRest(1);
  const handTracker = new HandPoseTracker();
  let frame: VisionFrame | null = null,
    lastFrameTime = -Infinity;
  let lesson: LessonMotion | null = null, lessonStart = 0;
  let locked = false,
    impulse: { gesture: Gesture; start: number } | null = null;
  let raf = 0,
    lastPaint = -Infinity,
    disposed = false,
    paints = 0,
    awakeUntil = performance.now() + 650;
  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const face = { ...FACE_REST };
  let faceTarget = { ...FACE_REST };
  let nextBlink = performance.now() + 2600;
  let blinkStart = 0;
  let blinkLength = 160;
  let wasBlinking = false,
    wasLive = false;
  const updateHand = (
    rig: ReturnType<typeof buildHand>,
    pose: HandPose | null,
    kick: number,
    blend: number,
  ) => {
    let x = rig.side * 0.64,
      y = -0.2;
    rig.target.copy(rig.side < 0 ? leftRest : rightRest);
    if (pose) {
      const reach = Math.max(0.4, Math.min(1.65, camera.right - 0.25));
      x = clamp((pose.landmarks[9].x - 0.5) * 3.2, -reach, reach);
      y = clamp((0.5 - pose.landmarks[9].y) * 1.6, -0.31, 0.24);
      rig.target.copy(pose.palm);
    }
    rig.group.position.x = smooth(rig.group.position.x, x, blend);
    rig.group.position.y = smooth(rig.group.position.y, y, blend);
    // Command reactions must not override movements while a hand is tracked.
    rig.group.position.z = smooth(rig.group.position.z, pose ? 0.5 : 0.24 + kick * 0.1, blend);
    rig.group.quaternion.slerp(rig.target, blend);
    rig.material.emissiveIntensity = ghostHead ? 0 : 0.022 + kick * 0.08;
    rig.fingers.forEach((chain, finger) => {
      chain.forEach((joint, i) => {
        joint.quaternion.slerp(pose?.fingers[finger][i] ?? rig.restFingers[finger][i], blend);
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
    const delta = Math.min(100, Number.isFinite(lastPaint) ? time - lastPaint : 33);
    const blend = 1 - Math.exp(-delta / 65);
    if (!motionPreference.matches && time >= nextBlink) {
      blinkStart = time;
      blinkLength = 150 + Math.random() * 60;
      nextBlink =
        time + (Math.random() < 0.22 ? 280 : 0) + 2200 + Math.random() * 3600;
      wake(500);
    }
    const blinkSpan = blinkStart ? (time - blinkStart) / blinkLength : 2;
    const blinking = blinkSpan >= 0 && blinkSpan < 1;
    if (blinking !== wasBlinking || !!live !== wasLive) wake();
    wasBlinking = blinking;
    wasLive = !!live;
    // No continuous GPU work for a stationary, camera-off character.
    if (!live && (!lesson || motionPreference.matches) && time > awakeUntil && !blinking) return;
    // Time-based damping keeps latency consistent at different render rates.
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
    blue.emissiveIntensity = 0.022 + kick * 0.04;
    if (expressive) {
      const faceBlend = 1 - Math.exp(-delta / 150);
      (Object.keys(face) as Array<keyof FacePose>).forEach((key) => {
        face[key] = smooth(face[key], faceTarget[key], faceBlend);
      });
      const blink = blinking ? 1 - Math.sin(blinkSpan * Math.PI) * 0.9 : 1;
      headTilt.rotation.z = face.tilt;
      eyes.forEach((eye) => {
        const calm = locked ? 0.86 : 1;
        eye.scale.set(
          face.eyeWide,
          blink * face.eyeOpen * face.eyeWide * calm,
          1,
        );
        eye.position.y = eyeBaseY + face.glance;
      });
      if (smile)
        smile.scale.set(
          face.smile * (1 - 0.5 * face.mouthOpen),
          face.smile * (1 - 0.85 * face.mouthOpen),
          1,
        );
      if (openMouth) {
        openMouth.scale.set(1, 0.06 + face.mouthOpen, 1);
        openMouth.visible = face.mouthOpen > 0.04;
      }
    }
    const [leftPose, rightPose] = handTracker.hands(time);
    if (!lesson || live) {
      updateHand(left, leftPose, direction <= 0 ? kick : 0, blend);
      updateHand(right, rightPose, direction >= 0 ? kick : 0, blend);
    }
    if (lesson && !live) {
      const seconds = motionPreference.matches ? 1.8 : (time - lessonStart) / 1000;
      const phase = (seconds % 4.6) / 4.6;
      const ease = (t: number) => { const v = clamp(t, 0, 1); return v * v * (3 - 2 * v); };
      const sweep = ease((phase - 0.2) / 0.3) * (1 - ease((phase - 0.73) / 0.23));
      const breath = motionPreference.matches ? 0 : Math.sin(seconds * 1.4) * 0.012;
      for (const rig of [left, right]) {
        const active = lesson === "previous" ? rig.side < 0 : rig.side > 0;
        let x = rig.side * 0.58, y = -0.16 + breath, turn = -rig.side * 0.12, open = false;
        if (active && (lesson === "next" || lesson === "previous")) {
          x = rig.side * (0.24 + sweep * 0.62);
          y = -0.08 + Math.sin(sweep * Math.PI) * 0.025;
          turn = -rig.side * 0.06;
          open = true;
        } else if (active && (lesson === "hold" || lesson === "hello")) {
          x = 0.57; y = -0.06; open = true;
          turn = lesson === "hello" ? Math.sin(seconds * 2.2) * 0.10 : -0.04;
        } else if (lesson === "success") {
          y = -0.05 + Math.sin(seconds * 2) * 0.025;
          turn = rig.side * -0.26; open = true;
        }
        rig.group.position.z = smooth(rig.group.position.z, 0.32, blend);
        if (!open) rig.fingers.forEach((chain, finger) => chain.forEach((joint, i) => joint.quaternion.slerp(rig.restFingers[finger][i], blend)));
        rig.group.position.x = smooth(rig.group.position.x, x, blend);
        rig.group.position.y = smooth(rig.group.position.y, y, blend);
        rig.target.setFromEuler(new THREE.Euler(0.14, -rig.side * 0.16, turn));
        rig.group.quaternion.slerp(rig.target, blend);
        if (open) rig.fingers.forEach((chain, finger) => chain.forEach((joint, i) => {
          const spread = i === 0 ? (finger === 4 ? 0.85 : (1.5 - finger) * 0.1) : 0;
          const pose = new THREE.Quaternion().setFromEuler(new THREE.Euler(i === 0 ? 0.06 : 0.08, 0, spread));
          joint.quaternion.slerp(pose, blend);
        }));
      }
      headTilt.rotation.z = motionPreference.matches ? 0 : Math.sin(seconds * 0.65) * 0.04;
    }
    host.dataset.trackedHands = String(Number(!!leftPose) + Number(!!rightPose));
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
  // A route transition can capture this canvas before the first animation frame.
  renderer.render(scene, camera);
  raf = requestAnimationFrame(paint);
  return {
    draw: (next) => {
      frame = next;
      lastFrameTime = performance.now();
      handTracker.update(next, lastFrameTime);
      wake();
    },
    clear: () => {
      frame = null;
      handTracker.clear();
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
    setExpression: (expression) => {
      if (!expressive) return;
      faceTarget = { ...FACE_REST, ...FACE_SHAPES[expression] };
      wake(900);
    },
    setLesson: (motion) => {
      lesson = motion;
      lessonStart = performance.now();
      frame = null;
      handTracker.clear();
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
