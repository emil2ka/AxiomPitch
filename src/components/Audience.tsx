import { useEffect, useState } from "react";
import type { Slide } from "../lib/types";
import { SlideView } from "./SlideView";

export function Audience() {
  const [slide, setSlide] = useState<Slide | null>(null);
  const [ended, setEnded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const session = new URLSearchParams(location.search).get("session");
    if (!session) return;
    const channel = new BroadcastChannel(`axiompitch-${session}`);
    channel.onmessage = (event) => {
      if (event.data.type === "slide") {
        setSlide(event.data.slide);
        setEnded(false);
      }
      if (event.data.type === "end") setEnded(true);
    };
    channel.postMessage({ type: "ready" });
    return () => channel.close();
  }, []);
  useEffect(() => {
    const listener = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);
  return (
    <main className="audience-screen">
      {ended ? (
        <div className="audience-wait">
          <span>AXIOMPITCH</span>
          <h1>Спасибо!</h1>
        </div>
      ) : slide ? (
        <SlideView slide={slide} />
      ) : (
        <div className="audience-wait">
          <span>AXIOMPITCH</span>
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
