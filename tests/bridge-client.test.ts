import assert from "node:assert/strict";
import { test } from "node:test";
import {
  followTarget,
  isExternal,
  trimFrame,
} from "../src/lib/bridge-client.ts";
import type { TargetStatus } from "../src/lib/bridge-client.ts";

const keynote = (patch: Partial<TargetStatus>): TargetStatus => ({
  app: "keynote",
  label: "Keynote",
  connected: true,
  slideIndex: null,
  slideCount: null,
  gesture: "next",
  ...patch,
});

test("without readState the console moves one step and marks it as an estimate", () => {
  assert.deepEqual(followTarget(keynote({}), 2, 10), {
    index: 3,
    estimated: true,
  });
  assert.deepEqual(followTarget(keynote({ gesture: "previous" }), 0, 10), {
    index: 0,
    estimated: true,
  });
});

test("Keynote's own slide number wins and is not an estimate", () => {
  assert.deepEqual(
    followTarget(keynote({ slideIndex: 6, slideCount: 12 }), 2, 10),
    { index: 6, estimated: false },
  );
  // A shorter PDF in the console cannot index past its own last slide.
  assert.deepEqual(
    followTarget(keynote({ slideIndex: 11, slideCount: 12 }), 2, 10),
    { index: 9, estimated: false },
  );
});

test("a refused step does not move the console at all", () => {
  assert.equal(
    followTarget(
      keynote({ error: "Не запущен показ слайдов в Keynote." }),
      2,
      10,
    ),
    null,
  );
  assert.equal(followTarget(keynote({ connected: false }), 2, 10), null);
});

test("only apps outside PitchFlow count as external targets", () => {
  assert.equal(isExternal(keynote({})), true);
  assert.equal(isExternal(keynote({ app: "pitchflow" })), false);
  assert.equal(isExternal(keynote({ app: null, connected: false })), false);
  assert.equal(isExternal(null), false);
});

test("a published frame carries rounded coordinates only", () => {
  const frame = trimFrame({
    type: "frame",
    time: 1234.5678,
    duration: 18.2,
    pose: [{ x: 0.123456789, y: 0.5, visibility: 0.987654 }],
    hands: [[{ x: 0.1, y: 0.2, z: -0.0333333 }]],
    handLabels: ["Left"],
  });
  assert.deepEqual(frame, {
    time: 1235,
    pose: [{ x: 0.1235, y: 0.5, visibility: 0.9877 }],
    hands: [[{ x: 0.1, y: 0.2, z: -0.0333 }]],
    handLabels: ["Left"],
  });
});
