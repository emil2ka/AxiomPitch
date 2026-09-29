import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { buildHandCage, buildHandSurface } from "../src/lib/hand-mesh.ts";

for (const style of ["solid", "cage"]) test(`${style} hand has bounded geometry and normalized bone weights`, () => {
  const starts = [[-.119,.119],[-.038,.151],[.046,.135],[.116,.085],[-.141,-.045]];
  const lengths = [[.112,.086,.07],[.128,.092,.076],[.122,.088,.072],[.09,.066,.056],[.09,.07,.055]];
  const material = new THREE.MeshBasicMaterial();
  const bindings = starts.map(([x,y],i) => ({
    matrix: new THREE.Matrix4().compose(new THREE.Vector3(x,y,.002), new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,i === 4 ? .85 : (1.5-i)*.1)),new THREE.Vector3(1,1,1)),
    firstIndex: 1+i*3,
    segments: lengths[i],
    radius: i === 3 ? .028 : i === 4 ? .042 : .036,
  }));
  const geometry = style === "cage" ? buildHandCage(bindings) : buildHandSurface(bindings, material);
  const positions = geometry.attributes.position, weights = geometry.attributes.skinWeight, indices = geometry.attributes.skinIndex;
  assert.ok(positions.count > (style === "solid" ? 10000 : 200));
  if (style === "cage") {
    assert.equal(positions.count, 1500, "keep the existing 500-triangle topology");
    assert.equal(geometry.attributes.gridCoord.count, positions.count);
  }
  assert.ok(positions.count < 150000);
  for (let i=0;i<positions.count;i++) {
    assert.ok(Number.isFinite(positions.getX(i)+positions.getY(i)+positions.getZ(i)));
    assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1) < 1e-6);
    assert.ok(indices.getX(i) <= 15 && indices.getY(i) <= 15 && indices.getZ(i) <= 15);
  }
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox!.min.y < -.24);
  assert.ok(geometry.boundingBox!.max.y > .42);
  assert.ok(geometry.boundingBox!.min.x < -.28);
  geometry.dispose();
  material.dispose();
});
