import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Audience } from "../src/components/Audience.tsx";
import { demoSlides } from "../src/lib/deck.ts";

test("shared audience window forwards arrows, ignores repeats, and stops after the presentation ends", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost:5173/studio?audience=1&session=review", pretendToBeVisual: true });
  class Channel {
    static instance: Channel;
    messages: unknown[] = [];
    onmessage?: (event: { data: unknown }) => void;
    closed = false;
    constructor(public name: string) { Channel.instance = this; }
    postMessage(data: unknown) { this.messages.push(data); }
    close() { this.closed = true; }
  }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, location: dom.window.location, BroadcastChannel: Channel, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { value, configurable: true });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const press = (key: string, repeat = false) => dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, repeat, cancelable: true }));
  try {
    await act(async () => root.render(createElement(Audience)));
    const channel = Channel.instance;
    assert.equal(channel.name, "axiompitch-review");
    press("ArrowRight");
    assert.deepEqual(channel.messages, [{ type: "ready" }], "waiting screen must not send commands");
    await act(async () => channel.onmessage?.({ data: { type: "slide", slide: demoSlides[0] } }));
    press("ArrowRight"); press("ArrowLeft"); press("ArrowRight", true); press("Enter");
    assert.deepEqual(channel.messages.slice(1), [{ type: "step", direction: "next" }, { type: "step", direction: "previous" }]);
    await act(async () => channel.onmessage?.({ data: { type: "end" } }));
    press("ArrowRight");
    assert.equal(channel.messages.length, 3);
    await act(async () => root.unmount());
    assert.equal(channel.closed, true);
  } finally { dom.window.close(); }
});
