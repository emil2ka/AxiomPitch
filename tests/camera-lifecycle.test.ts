import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { CameraProvider } from "../src/components/CameraProvider.tsx";
import { useCamera, useCameraPreparation } from "../src/hooks/useCamera.ts";
import type { VisionFrame, VisionMessage } from "../src/lib/types.ts";

const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost:5173/studio", pretendToBeVisual: true });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage, location: dom.window.location, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
Object.defineProperty(dom.window, "isSecureContext", { value: true });
Object.defineProperty(globalThis, "OffscreenCanvas", { value: class {}, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: dom.window.requestAnimationFrame.bind(dom.window), configurable: true });
Object.defineProperty(globalThis, "cancelAnimationFrame", { value: dom.window.cancelAnimationFrame.bind(dom.window), configurable: true });
Object.defineProperty(dom.window.HTMLMediaElement.prototype, "play", { value: async () => {} });
Object.defineProperty(dom.window.HTMLMediaElement.prototype, "pause", { value: () => {} });

let captureRequests = 0;
let nextCapture: Promise<unknown> | undefined;
const tracks: Array<{ readyState: string; onended?: () => void; stop: () => void }> = [];
const stream = () => {
  const track = { readyState: "live", onended: undefined as (() => void) | undefined, stop() { this.readyState = "ended"; } };
  tracks.push(track);
  return { getTracks: () => [track], getVideoTracks: () => [track] };
};
Object.defineProperty(dom.window.navigator, "mediaDevices", { value: {
  async getUserMedia() { captureRequests++; return nextCapture ?? stream(); },
  enumerateDevices: async () => [], addEventListener() {}, removeEventListener() {},
} });
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: VisionMessage }) => void;
  onerror?: () => void;
  terminated = false;
  frames: unknown[] = [];
  constructor() { FakeWorker.instances.push(this); }
  postMessage(data: { type: string }) {
    if (data.type === "frame") this.frames.push(data);
    if (data.type === "init") queueMicrotask(() => {
      if (!this.terminated) this.onmessage?.({ data: { type: "ready" } });
    });
  }
  terminate() { this.terminated = true; }
  frame() {
    this.onmessage?.({ data: { type: "frame", time: 1, pose: [], hands: [], duration: 0 } });
  }
}
Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true });
let camera: ReturnType<typeof useCamera>;
let preparation: ReturnType<typeof useCameraPreparation>;
let received: string[] = [];
function Probe({ route, device = "" }: { route: string; device?: string }) {
  const session = useCamera((_frame: VisionFrame) => { received.push(route); }, device);
  const checks = useCameraPreparation();
  useLayoutEffect(() => { camera = session; preparation = checks; });
  return createElement("span", null, route);
}
const container = dom.window.document.getElementById("root")!;
const root = createRoot(container);
const mount = async (route = "studio", device = "", scope: string | null = "speaker") => {
  await act(async () => { root.render(createElement(CameraProvider, { scope }, createElement(Probe, { key: route, route, device }))); });
};
const proved = { index: 1, hand: true, next: true, previous: true, lock: true, unlock: true };

test("one camera and worker survive studio/learning navigation; stop or device change invalidates checks", async () => {
  try {
    await mount();
    assert.equal(captureRequests, 0, "visiting the studio must not open the camera without intent");
    await act(async () => { await camera.start(); });
    assert.equal(camera.status, "ready");
    assert.equal(captureRequests, 1);
    assert.equal(FakeWorker.instances.length, 1);
    await act(async () => preparation.setPreflight(proved));
    assert.equal(preparation.preflight.unlock, true);
    await mount("learn");
    assert.equal(camera.status, "ready");
    assert.equal(preparation.preflight.unlock, true);
    assert.equal(tracks[0].readyState, "live");
    await act(async () => FakeWorker.instances[0].frame());
    assert.deepEqual(received, ["learn"], "unmounted pages must stop receiving frames");
    await mount("studio");
    await act(async () => { await camera.start(); });
    assert.equal(captureRequests, 1, "start is idempotent for the same live camera");
    assert.equal(preparation.preflight.unlock, true);
    await mount("studio", "another-camera");
    await act(async () => { await camera.start(); });
    assert.equal(captureRequests, 2);
    assert.equal(tracks[0].readyState, "ended");
    assert.equal(FakeWorker.instances[0].terminated, true);
    assert.equal(preparation.preflight.unlock, false);
    await act(async () => preparation.setPreflight(proved));
    await act(async () => camera.stop());
    assert.equal(camera.status, "off");
    assert.equal(preparation.preflight.unlock, false);
    assert.equal(sessionStorage.getItem("axiompitch-camera-active:speaker"), null);
    assert.equal(tracks[1].readyState, "ended");
  } finally {
    await act(async () => root.render(null));
  }
});

test("reload reconnects only this tab's explicit intent and a cancelled permission request leaks no stream", async () => {
  try {
    sessionStorage.setItem("axiompitch-camera-active:speaker", "on");
    const requests = captureRequests;
    await mount();
    assert.equal(camera.status, "ready");
    assert.equal(captureRequests, requests + 1);
    assert.equal(preparation.preflight.hand, false, "a new capture must revalidate gesture readiness");
    await mount("studio", "", null);
    assert.equal(camera.status, "off", "leaving authenticated work releases the camera");
    assert.equal(tracks.at(-1)?.readyState, "ended");
    sessionStorage.clear();
    await mount();
    let resolveCapture: (value: unknown) => void;
    nextCapture = new Promise(resolve => { resolveCapture = resolve; });
    let pending: Promise<void>;
    await act(async () => { pending = camera.start(); });
    assert.equal(camera.status, "loading");
    await act(async () => camera.stop());
    const lateStream = stream();
    await act(async () => { resolveCapture!(lateStream); await pending; });
    assert.equal(tracks.at(-1)?.readyState, "ended");
    assert.equal(camera.status, "off");
  } finally {
    nextCapture = undefined;
    await act(async () => root.render(null));
  }
});

test("a disconnected camera releases the stream and worker and can reconnect explicitly", async () => {
  try {
    nextCapture = undefined;
    await mount();
    await act(async () => { await camera.start(); });
    const track = tracks.at(-1)!;
    const worker = FakeWorker.instances.at(-1)!;
    await act(async () => track.onended?.());
    assert.equal(camera.status, "error");
    assert.equal(track.readyState, "ended");
    assert.equal(worker.terminated, true);
    assert.equal(sessionStorage.getItem("axiompitch-camera-active:speaker"), null);
    assert.match(camera.error, /стрелками/);
    await act(async () => { await camera.start(); });
    assert.equal(camera.status, "ready");
    assert.notEqual(FakeWorker.instances.at(-1), worker);
  } finally {
    await act(async () => root.render(null));
  }
});

test("camera busy in another app reports a recoverable error without leaking a worker", async () => {
  try {
    sessionStorage.clear();
    await mount();
    const workers = FakeWorker.instances.length;
    nextCapture = Promise.reject(new DOMException("in use", "NotReadableError"));
    await act(async () => { await camera.start(); });
    assert.equal(camera.status, "error");
    assert.match(camera.error, /занята другим приложением/);
    assert.equal(FakeWorker.instances.length, workers);
    nextCapture = undefined;
    await act(async () => { await camera.start(); });
    assert.equal(camera.status, "ready");
  } finally {
    nextCapture = undefined;
    await act(async () => root.render(null));
  }
});

test("track capture sends frames while the studio tab is hidden behind a meeting or slides", async () => {
  let source: ReadableStreamDefaultController<VideoFrame>;
  let cancelled = false;
  const readable = new ReadableStream<VideoFrame>({ start(controller) { source = controller; }, cancel() { cancelled = true; } });
  Object.defineProperty(globalThis, "MediaStreamTrackProcessor", { configurable: true, value: class { readable = readable; } });
  Object.defineProperty(dom.window.document, "hidden", { configurable: true, value: true });
  try {
    sessionStorage.clear();
    await mount();
    await act(async () => { await camera.start(); });
    const worker = FakeWorker.instances.at(-1)!;
    const frame = { close() {} } as VideoFrame;
    await act(async () => { source.enqueue(frame); });
    assert.equal(worker.frames.length, 1, "hidden tabs must receive frames without requestAnimationFrame");
    await act(async () => camera.stop());
    assert.equal(cancelled, true);
    assert.equal(worker.terminated, true);
  } finally {
    delete (globalThis as { MediaStreamTrackProcessor?: unknown }).MediaStreamTrackProcessor;
    Object.defineProperty(dom.window.document, "hidden", { configurable: true, value: false });
    await act(async () => root.render(null));
  }
});
