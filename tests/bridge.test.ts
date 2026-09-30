import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createChromeTarget } from "../server/src/bridge/chrome.ts";
import { Bridge } from "../server/src/bridge/controller.ts";
import type { TargetStatus } from "../server/src/bridge/controller.ts";
import { FrontmostTarget } from "../server/src/bridge/frontmost.ts";
import { KeynoteTarget } from "../server/src/bridge/keynote.ts";
import { FakeTarget, fakeSystem, json, startServer } from "./support.ts";

test("next and previous each reach the app exactly once", async () => {
  const target = new FakeTarget();
  const bridge = new Bridge([target], () => {}, "keynote");
  const forward = await bridge.handleCommand("next", false);
  const back = await bridge.handleCommand("previous", false);
  assert.equal(target.count("next"), 1);
  assert.equal(target.count("previous"), 1);
  assert.equal(forward?.slideIndex, 1);
  assert.equal(back?.slideIndex, 0);
});

test("polling reads changes made inside the app and reports an unavailable target", async () => {
  const target = new FakeTarget();
  const bridge = new Bridge([target], () => {}, "keynote");
  target.state = { slideIndex: 14, slideCount: 18 };
  assert.equal((await bridge.state()).slideIndex, 14);
  assert.equal(target.count("next"), 0);
  target.available = async () => false;
  const unavailable = await bridge.state();
  assert.equal(unavailable.app, "keynote");
  assert.equal(unavailable.connected, false);
  assert.match(unavailable.error!, /недоступно/);
});

test("an unreadable Keynote show is an error rather than a guessed position", async () => {
  const bridge = new Bridge([new FakeTarget("keynote", null)], () => {}, "keynote");
  const status = await bridge.state();
  assert.equal(status.slideIndex, null);
  assert.match(status.error!, /Запусти показ/);
});

test("toggle is the gesture lock: it never calls next or previous", async () => {
  const target = new FakeTarget();
  const bridge = new Bridge([target], () => {}, "keynote");
  assert.equal(await bridge.handleCommand("toggle", true), null);
  assert.equal(await bridge.handleCommand("toggle", false), null);
  assert.equal(target.count("next") + target.count("previous"), 0);
});

test("locked stops next, both from the tab and over HTTP", async () => {
  const target = new FakeTarget();
  const bridge = new Bridge([target], () => {}, "keynote");
  assert.equal(await bridge.handleCommand("next", true), null);
  await bridge.handleCommand("toggle", true);
  await assert.rejects(bridge.control("next"), /заблокированы/);
  assert.equal(target.count("next"), 0);
  // An explicit locked field in the request is the newest word.
  await bridge.control("next", false);
  assert.equal(target.count("next"), 1);
});

test("frontmost never types into a process other than the connected one", async () => {
  const system = fakeSystem();
  const target = new FrontmostTarget(system);
  await assert.rejects(target.connect({ process: "Terminal" }), /нельзя/);
  await target.connect({ process: "Preview" });
  for (const front of [
    { name: "Terminal", bundleId: "com.apple.Terminal", windowTitle: "zsh" },
    { name: "Finder", bundleId: "com.apple.finder", windowTitle: "Desktop" },
    { name: "Safari", bundleId: "com.apple.Safari", windowTitle: "Deck" },
    { name: "Electron", bundleId: "com.github.Electron", windowTitle: "" },
    null,
  ]) {
    system.front = front;
    await assert.rejects(target.next());
  }
  assert.deepEqual(system.keys, []);
  system.front = {
    name: "Preview",
    bundleId: "com.apple.Preview",
    windowTitle: "deck.pdf",
  };
  await target.next();
  await target.previous();
  assert.deepEqual(system.keys, [124, 123]);
});

test("Chrome gets an arrow only when it is in front and not showing PitchFlow", async () => {
  const system = fakeSystem({
    name: "Google Chrome",
    bundleId: "com.google.Chrome",
    windowTitle: "AxiomPitch",
  });
  const chrome = createChromeTarget(system);
  await chrome.connect();
  await assert.rejects(chrome.next(), /PitchFlow/);
  system.front = { ...system.front!, windowTitle: "Питч — Google Slides" };
  await chrome.next();
  assert.deepEqual(system.keys, [124]);
  assert.equal(await chrome.readState(), null);
});

test("switching from Slides to Meet never sends meeting controls, then slides can resume", async () => {
  const system = fakeSystem({ name: "Google Chrome", bundleId: "com.google.Chrome", windowTitle: "Питч — Google Slides" });
  const chrome = createChromeTarget(system);
  await chrome.connect();
  await chrome.next();
  for (const windowTitle of ["Meet - abc-defg-hij", "Google Meet", "meet.google.com/abc-defg-hij", "Meet — abc-defg-hij", "Meet – abc-defg-hij"]) {
    system.front = { ...system.front!, windowTitle };
    await assert.rejects(chrome.next(), /Google Meet/);
    await assert.rejects(chrome.previous(), /Google Meet/);
  }
  assert.deepEqual(system.keys, [124]);
  system.front = { ...system.front!, windowTitle: "Питч — Google Slides" };
  await chrome.previous();
  assert.deepEqual(system.keys, [124, 123]);
});

test("Keynote without a running show fails loudly instead of pretending", async () => {
  const system = fakeSystem();
  system.reply = "not-playing";
  const bridge = new Bridge([new KeynoteTarget(system)], () => {}, "keynote");
  const status = await bridge.handleCommand("next", false);
  assert.equal(status?.error, "Не запущен показ слайдов в Keynote.");
  assert.equal(status?.slideIndex, null);
});

test("readState null is reported as unknown, never as an estimated Keynote slide", async () => {
  const target = new FakeTarget("keynote", null);
  const published: TargetStatus[] = [];
  const bridge = new Bridge(
    [target],
    (status) => published.push(status),
    "keynote",
  );
  await bridge.handleCommand("next", false);
  await bridge.handleCommand("next", false);
  assert.equal(target.count("next"), 2);
  for (const status of published) {
    assert.equal(status.app, "keynote");
    assert.equal(status.slideIndex, null);
    assert.equal(status.slideCount, null);
  }
  // Keynote's own adapter: an empty AppleScript reply is not a slide number.
  const system = fakeSystem();
  system.reply = "";
  assert.equal(await new KeynoteTarget(system).readState(), null);
  system.reply = "3/12";
  assert.deepEqual(await new KeynoteTarget(system).readState(), {
    slideIndex: 2,
    slideCount: 12,
  });
});

function open(port: number, role: string, origin = "http://localhost:5173") {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/live?role=${role}`, {
    headers: { origin },
  });
  const inbox: Array<Record<string, unknown>> = [];
  socket.on("message", (data) => inbox.push(JSON.parse(String(data))));
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
    socket.once("unexpected-response", (_req, res) =>
      reject(new Error(`HTTP ${res.statusCode}`)),
    );
  });
  return { socket, inbox, ready };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check());
}

test("over /live a command moves the connected app once and the notch hears it", async () => {
  const target = new FakeTarget();
  const server = await startServer([target]);
  try {
    await fetch(`${server.base}/api/targets/connect`, json({ app: "keynote" }));
    const speaker = open(server.port, "speaker");
    const overlay = open(server.port, "overlay");
    await Promise.all([speaker.ready, overlay.ready]);
    speaker.socket.send(
      JSON.stringify({
        type: "frame",
        time: 1,
        pose: [{ x: 0.5, y: 0.5, visibility: 1 }],
        hands: [],
        video: "must not travel",
      }),
    );
    speaker.socket.send(
      JSON.stringify({ type: "command", gesture: "next", locked: false }),
    );
    await until(() =>
      speaker.inbox.some((message) => message.type === "target"),
    );
    await until(() =>
      overlay.inbox.some((message) => message.type === "command"),
    );
    assert.equal(target.count("next"), 1);
    const status = speaker.inbox.find((message) => message.type === "target");
    assert.equal(status?.slideIndex, 1);
    const frame = overlay.inbox.find((message) => message.type === "frame");
    assert.ok(frame && !("video" in frame));

    // Locked over the socket, the HTTP control refuses too.
    speaker.socket.send(
      JSON.stringify({ type: "command", gesture: "toggle", locked: true }),
    );
    await until(() => server.app.bridge.locked);
    const refused = await fetch(
      `${server.base}/api/control`,
      json({ gesture: "next" }),
    );
    assert.equal(refused.status, 409);
    const toggle = await fetch(
      `${server.base}/api/control`,
      json({ gesture: "toggle" }),
    );
    assert.equal(toggle.status, 400);
    assert.equal(target.count("next"), 1);
    assert.equal(target.count("previous"), 0);
    speaker.socket.close();
    overlay.socket.close();
  } finally {
    await server.stop();
  }
});

test("a page from another origin cannot open /live", async () => {
  const server = await startServer();
  try {
    await assert.rejects(
      open(server.port, "speaker", "https://example.com").ready,
      /403/,
    );
  } finally {
    await server.stop();
  }
});

test("the production site can connect the loopback bridge but lookalike sites cannot", async () => {
  const server = await startServer();
  let speaker: ReturnType<typeof open> | undefined;
  try {
    const origin = "https://axiompitch.vercel.app";
    const response = await fetch(`${server.base}/api/overlay`, { headers: { origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    speaker = open(server.port, "speaker", origin);
    await speaker.ready;
    for (const origin of ["https://axiompitch.vercel.app.evil.example", "https://another.vercel.app"]) {
      const rejected = await fetch(`${server.base}/api/overlay`, { headers: { origin } });
      assert.equal(rejected.status, 403);
      await assert.rejects(open(server.port, "speaker", origin).ready, /403/);
    }
  } finally {
    speaker?.socket.close();
    await server.stop();
  }
});
