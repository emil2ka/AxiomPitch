import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { SessionClock } from "../src/lib/session.ts";
import { json, makePdf, startServer } from "./support.ts";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(() => server.stop());

/** A real SessionClock result: fractional times, one pause excluded. */
function result(mode: "rehearsal" | "live" = "live") {
  const clock = new SessionClock(3, 0, 1000.25);
  clock.changeSlide(1, 4000.5);
  clock.pause(9000.125);
  clock.resume(15000.75);
  clock.changeSlide(2, 17000.375);
  clock.commands.next = 2;
  clock.commands.toggle = 1;
  clock.corrections.wider = 1;
  return clock.result(
    {
      id: randomUUID(),
      name: "Первый питч",
      startedAt: "2026-09-28T04:00:00.000Z",
      slideTitles: ["Вступление", "Проблема", "Решение"],
      mode,
    },
    21000.0625,
  );
}
const post = (body: unknown) =>
  fetch(`${server.base}/api/sessions`, json(body));

test("duration must equal the sum of perSlide exactly", async () => {
  const ok = result();
  assert.equal(
    ok.duration,
    ok.perSlide.reduce((sum, value) => sum + value, 0),
  );
  assert.equal((await post(ok)).status, 201);
  const skewed = await post({ ...result(), duration: ok.duration + 1 });
  assert.equal(skewed.status, 400);
  assert.match((await skewed.json()).error, /сумме perSlide/);
});

test("external session results over the PDF page limit are saved without truncation", async () => {
  const body = result();
  body.perSlide = Array(100).fill(0);
  body.perSlide[80] = 1234;
  body.duration = 1234;
  body.slideTitles = body.perSlide.map((_, i) => `Слайд ${i + 1}`);
  assert.equal((await post(body)).status, 201);
});

test("an unknown correction code is rejected", async () => {
  const body = result();
  body.corrections = { wider: 1, nervous: 2 };
  const response = await post(body);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /nervous/);
});

test("mode and commands are checked against the SessionResult shape", async () => {
  assert.equal((await post({ ...result(), mode: "demo" })).status, 400);
  const body = result();
  assert.equal(
    (await post({ ...body, commands: { ...body.commands, lock: 1 } })).status,
    400,
  );
  const { toggle: _toggle, ...partial } = body.commands;
  assert.equal((await post({ ...body, commands: partial })).status, 400);
});

test("a pause needs no field of its own: the result already excludes it", async () => {
  const body = result("rehearsal");
  assert.equal(
    (await post({ ...body, id: randomUUID(), pausedMs: 6000 })).status,
    400,
  );
  assert.equal((await post(body)).status, 201);
  assert.equal((await post(body)).status, 409);
  const page = await (
    await fetch(`${server.base}/api/sessions?limit=50`)
  ).json();
  const stored = page.items.find((item: { id: string }) => item.id === body.id);
  assert.deepEqual(
    Object.keys(stored).sort(),
    [...Object.keys(body), "presentationId", "savedAt"].sort(),
  );
  assert.equal(stored.mode, "rehearsal");
  assert.equal(stored.duration, body.duration);
  assert.deepEqual(stored.perSlide, body.perSlide);
  assert.deepEqual(stored.commands, { next: 2, previous: 0, toggle: 1 });
  assert.deepEqual(stored.corrections, { wider: 1 });
});

test("a session can point at a stored presentation, but not an unknown one", async () => {
  const form = new FormData();
  form.append("file", new Blob([makePdf(3)]), "deck.pdf");
  const deck = await (
    await fetch(`${server.base}/api/presentations`, {
      method: "POST",
      body: form,
    })
  ).json();
  const linked = { ...result(), presentationId: deck.id };
  assert.equal((await post(linked)).status, 201);
  assert.equal(
    (await post({ ...result(), presentationId: randomUUID() })).status,
    400,
  );
  const page = await (await fetch(`${server.base}/api/sessions`)).json();
  assert.equal(
    page.items.find((item: { id: string }) => item.id === linked.id)
      .presentationId,
    deck.id,
  );
});
