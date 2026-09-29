import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { notchBounds, overClose } from "../overlay/geometry.ts";
import { parseSession } from "../server/src/ws.ts";
import { json, startServer } from "./support.ts";

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(check());
}

test("physical notch placement has no gap and only the cross intercepts clicks", () => {
  const bounds = notchBounds({ x: 0, y: 0, width: 1470 }, 32, 735.5);
  assert.deepEqual(bounds, { x: 626, y: 0, width: 220, height: 112 });
  assert.deepEqual(notchBounds({ x: -1920, y: -100, width: 1920 }), { x: -1070, y: -100, width: 220, height: 80 });
  assert.equal(overClose({ x: 830, y: 50 }, bounds), true);
  assert.equal(overClose({ x: 735, y: 70 }, bounds), false);
  assert.equal(overClose({ x: 830, y: 63 }, bounds), false);
});

test("managed notch respects close, preference, finish, reconnect and tab ownership", async () => {
  const server = await startServer();
  const speaker = new WebSocket(`ws://127.0.0.1:${server.port}/live?role=speaker`);
  const other = new WebSocket(`ws://127.0.0.1:${server.port}/live?role=speaker`);
  const state = { type: "session", id: "first", stage: "running", mode: "live", index: 0, slideCount: 5, durationMs: 0, overlayEnabled: true, overlayDisplayId: null };
  try {
    await Promise.all([speaker, other].map(socket => new Promise<void>(resolve => socket.once("open", () => resolve()))));
    speaker.send(JSON.stringify(state));
    await until(() => server.app.hub.overlay.visible);
    other.send(JSON.stringify({ ...state, id: "other", stage: "idle" }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(server.app.hub.overlay.visible, true);
    await fetch(`${server.base}/api/overlay`, json({ visible: false }));
    speaker.send(JSON.stringify(state));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(server.app.hub.overlay.visible, false);
    speaker.send(JSON.stringify({ ...state, id: "second" }));
    await until(() => server.app.hub.overlay.visible);
    speaker.send(JSON.stringify({ ...state, id: "second", overlayEnabled: false }));
    await until(() => !server.app.hub.overlay.visible);
    const refused = await (await fetch(`${server.base}/api/overlay`, json({ visible: true }))).json();
    assert.equal(refused.visible, false);
    speaker.send(JSON.stringify({ ...state, id: "second" }));
    await until(() => server.app.hub.overlay.visible);
    speaker.send(JSON.stringify({ ...state, id: "second", stage: "finished" }));
    await until(() => !server.app.hub.overlay.visible);
    speaker.send(JSON.stringify({ ...state, id: "third" }));
    await until(() => server.app.hub.overlay.visible);
    speaker.close();
    await until(() => !server.app.hub.overlay.visible);
  } finally {
    speaker.terminate(); other.terminate(); await server.stop();
  }
});

test("session protocol accepts external decks over 60 slides and rejects invalid preferences", () => {
  const state = { stage: "running", mode: "live", index: 80, slideCount: 100, durationMs: 123, id: "test", overlayEnabled: false };
  assert.equal(parseSession(state)?.index, 80);
  assert.equal(parseSession({ ...state, overlayEnabled: "false" }), null);
  assert.equal(parseSession({ ...state, slideCount: 2001 }), null);
});

test("a stalled speaker hides the notch even while its socket remains open", async () => {
  const server = await startServer();
  const speaker = new WebSocket(`ws://127.0.0.1:${server.port}/live?role=speaker`);
  try {
    await new Promise<void>(resolve => speaker.once("open", () => resolve()));
    speaker.send(JSON.stringify({ type: "session", id: "stalled", stage: "running", mode: "live", index: 0, slideCount: 1, durationMs: 0, overlayEnabled: true }));
    await until(() => server.app.hub.overlay.visible);
    await new Promise(resolve => setTimeout(resolve, 6100));
    assert.equal(speaker.readyState, WebSocket.OPEN);
    assert.equal(server.app.hub.overlay.visible, false);
  } finally { speaker.terminate(); await server.stop(); }
});
