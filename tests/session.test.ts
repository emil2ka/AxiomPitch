import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionClock } from "../src/lib/session.ts";

test("time belongs to the displayed slide and excludes paused intervals", () => {
  const clock = new SessionClock(3, 0, 0);
  clock.changeSlide(1, 1000);
  clock.pause(2000);
  clock.changeSlide(2, 4000);
  clock.resume(5000);
  const result = clock.result(
    {
      id: "test",
      startedAt: "2026-09-28",
      name: "Demo",
      slideTitles: ["a", "b", "c"],
      mode: "rehearsal",
    },
    7000,
  );
  assert.deepEqual(result.perSlide, [1000, 1000, 2000]);
  assert.equal(result.duration, 4000);
  clock.tick(9000);
  assert.equal(clock.duration, 4000);
});
test("session result is a snapshot, not a reference to mutable counters", () => {
  const clock = new SessionClock(1, 0, 0);
  clock.commands.next = 2;
  clock.corrections.wider = 1;
  const result = clock.result(
    {
      id: "test",
      startedAt: "2026-09-28",
      name: "Demo",
      slideTitles: ["a"],
      mode: "live",
    },
    1500,
  );
  clock.commands.next = 99;
  clock.corrections.wider = 99;
  clock.perSlide[0] = 0;
  assert.equal(result.commands.next, 2);
  assert.equal(result.corrections.wider, 1);
  assert.equal(result.duration, 1500);
});
