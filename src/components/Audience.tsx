import { useEffect, useRef, useState } from "react";
import type { Slide } from "../lib/types";
import { WebNotch } from "./WebNotch";
import { WebNotchFeed, emptyWebNotch } from "../lib/web-notch";
import { PitchBrand } from "./PitchBrand";
import { SlideView } from "./SlideView";

export function Audience() {
  const [notchFeed] = useState(() => new WebNotchFeed());
  const [notch, setNotch] = useState(emptyWebNotch);
  const connection = useRef<BroadcastChannel | null>(null);
  const [slide, setSlide] = useState<Slide | null>(null);
  const [ended, setEnded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const session = new URLSearchParams(location.search).get("session");
    if (!session) return;
    const channel = new BroadcastChannel(`axiompitch-${session}`);
    connection.current = channel;
    let showing = false;
    const keydown = (event: KeyboardEvent) => {
      if (!showing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      channel.postMessage({ type: "step", direction: event.key === "ArrowRight" ? "next" : "previous" });
    };
    window.addEventListener("keydown", keydown);
    channel.onmessage = (event) => {
      if (event.data.type === "notch-state") { setNotch(event.data.state); if (!event.data.state.cameraReady) notchFeed.clear(); }
      if (event.data.type === "notch-frame") notchFeed.draw(event.data.frame);
      if (event.data.type === "notch-command") notchFeed.react(event.data.gesture);
      if (event.data.type === "slide") {
        showing = true;
        setSlide(event.data.slide);
        setEnded(false);
      }
      if (event.data.type === "end") { showing = false; setEnded(true); setNotch(emptyWebNotch()); notchFeed.clear(); }
    };
    channel.postMessage({ type: "ready" });
    return () => { window.removeEventListener("keydown", keydown); channel.close(); connection.current = null; };
  }, [notchFeed]);
  useEffect(() => {
    const listener = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);
  return (
    <main className="audience-screen">
      {!ended && slide && <WebNotch feed={notchFeed} state={notch} onHide={() => { setNotch(previous => ({ ...previous, visible: false })); connection.current?.postMessage({ type: "hide-notch" }); }} />}
      {ended ? (
        <div className="audience-wait">
          <PitchBrand />
          <h1>Спасибо!</h1>
        </div>
      ) : slide ? (
        <SlideView slide={slide} />
      ) : (
        <div className="audience-wait">
          <PitchBrand />
          <p>Ждём презентацию от спикера…</p>
        </div>
      )}
      {!fullscreen && (
        <button
          className="audience-fullscreen"
          onClick={() => {
            void document.documentElement
              .requestFullscreen()
              .catch(() => undefined);
          }}
        >
          На весь экран
        </button>
      )}
    </main>
  );
}
