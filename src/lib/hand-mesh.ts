import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

export type FingerBinding = {
  matrix: THREE.Matrix4;
  firstIndex: number;
  segments: number[];
  radius: number;
};

/** Smoothly join the palm, wrist and all five fingers into one surface.
 * Geometry is baked once; the normal camera-driven bone rig animates it. */
export function buildHandSurface(bindings: FingerBinding[], material: THREE.Material, resolution = 96) {
  const marching = new MarchingCubes(resolution, material, false, false, 60000);
  marching.isolation = 0;
  const scale = new THREE.Vector3(0.43, 0.49, 0.14);
  const center = new THREE.Vector3(0, 0.12, 0);
  const p = new THREE.Vector3(), local = new THREE.Vector3();
  const fingers = bindings.map(binding => ({ ...binding, inverse: binding.matrix.clone().invert(), length: binding.segments.reduce((sum, v) => sum + v, 0) }));
  const smoothMin = (a: number, b: number, k: number) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  const ellipsoid = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    const k0 = Math.hypot(x / rx, y / ry, z / rz);
    const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
    return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
  };
  const palmDistance = (point: THREE.Vector3) => {
    // A tapered, softly squared palm rather than a spherical mitten.
    const lowerTaper = Math.max(0, -point.y - .035) * .2;
    const x = Math.abs(point.x) - (.11 - lowerTaper);
    const y = Math.abs(point.y + .025) - .113;
    const z = Math.abs(point.z) - .013;
    const rounded = Math.hypot(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)) + Math.min(Math.max(x, y, z), 0) - .044;
    const oval = ellipsoid(point.x, point.y + .025, point.z, .155, .176, .065);
    return rounded * .35 + oval * .65;
  };
  const fingerDistance = (finger: typeof fingers[number], point: THREE.Vector3) => {
    const y = THREE.MathUtils.clamp(point.y, finger.radius * .55, finger.length - finger.radius);
    const along = THREE.MathUtils.clamp(point.y / finger.length, 0, 1);
    const joint1 = finger.segments[0], joint2 = joint1 + finger.segments[1];
    const knuckles = .035 * (Math.exp(-Math.pow((y - joint1) / .025, 2)) + Math.exp(-Math.pow((y - joint2) / .023, 2)));
    const taper = 1 - .19 * along + knuckles;
    return Math.hypot(point.x, point.y - y, point.z / .87) - finger.radius * taper;
  };
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    p.set((x / resolution * 2 - 1) * scale.x, (y / resolution * 2 - 1) * scale.y + center.y, (z / resolution * 2 - 1) * scale.z);
    let distance = palmDistance(p);
    distance = smoothMin(distance, ellipsoid(p.x + .097, p.y + .07, p.z - .014, .067, .094, .049), .024);
    distance = smoothMin(distance, ellipsoid(p.x, p.y + .178, p.z + .004, .07, .071, .04), .045);
    // A soft, flat wrist ending keeps the silhouette clean.
    const wristCut = -p.y - .25;
    const cutBlend = .012;
    const cutH = Math.max(cutBlend - Math.abs(distance - wristCut), 0) / cutBlend;
    distance = Math.max(distance, wristCut) + cutH * cutH * cutBlend * .25;
    for (const finger of fingers) {
      local.copy(p).applyMatrix4(finger.inverse);
      distance = smoothMin(distance, fingerDistance(finger, local), .024);
    }
    marching.field[z * resolution * resolution + y * resolution + x] = -distance;
  }
  marching.update();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(marching.positionArray.slice(0, marching.count * 3), 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(marching.normalArray.slice(0, marching.count * 3), 3));
  geometry.scale(scale.x, scale.y, scale.z);
  geometry.translate(center.x, center.y, center.z);
  marching.geometry.dispose();
  const positions = geometry.attributes.position;
  const indices = new Uint16Array(positions.count * 4), weights = new Float32Array(positions.count * 4);
  const selectedPoint = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i);
    let best = Infinity, selected = fingers[0];
    for (const finger of fingers) {
      local.copy(p).applyMatrix4(finger.inverse);
      if (local.y < -.03) continue;
      const distance = fingerDistance(finger, local);
      if (distance < best) { best = distance; selected = finger; selectedPoint.copy(local); }
    }
    const influence = Number.isFinite(best) ? THREE.MathUtils.clamp((selectedPoint.y + .025) / .075, 0, 1) : 0;
    const y = Math.max(0, selectedPoint.y);
    const segment = y < selected.segments[0] ? 0 : 1;
    const blend = THREE.MathUtils.clamp((y - (segment ? selected.segments[0] : 0)) / selected.segments[segment], 0, 1);
    indices[i * 4] = 0;
    indices[i * 4 + 1] = selected.firstIndex + segment;
    indices[i * 4 + 2] = selected.firstIndex + segment + 1;
    weights[i * 4] = 1 - influence;
    weights[i * 4 + 1] = influence * (1 - blend);
    weights[i * 4 + 2] = influence * blend;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}
