import assert from "node:assert/strict";
import { test } from "node:test";
import { WebNotchFeed } from "../src/lib/web-notch.ts";
import type { Gesture, VisionFrame } from "../src/lib/types.ts";

test("web notch fans camera coordinates and gestures out to active views, and clears stale poses", () => {
  const feed = new WebNotchFeed();
  const observer = () => {
    const frames: VisionFrame[] = [], gestures: Gesture[] = [];
    let cleared = 0;
    return { frames, gestures, get cleared() { return cleared; }, draw(frame: VisionFrame) { frames.push(frame); }, react(gesture: Gesture) { gestures.push(gesture); }, clear() { cleared++; } };
  };
  const speaker = observer(), audience = observer();
  const first: VisionFrame = { type: "frame", time: 100, hands: [], pose: [], duration: 5 };
  feed.draw(first);
  const detachSpeaker = feed.subscribe(speaker);
  assert.deepEqual(speaker.frames, [first], "new or loaded views immediately receive the latest pose");
  feed.subscribe(audience);
  feed.react("next");
  assert.deepEqual(audience.gestures, ["next"]);
  detachSpeaker();
  feed.draw({ ...first, time: 200 });
  assert.equal(speaker.frames.length, 1, "removed views must not retain camera consumers");
  assert.equal(audience.frames.length, 2);
  feed.clear();
  assert.equal(audience.cleared, 1);
  const reconnected = observer();
  feed.subscribe(reconnected);
  assert.equal(reconnected.frames.length, 0, "disconnected cameras cannot replay a stale pose");
});
