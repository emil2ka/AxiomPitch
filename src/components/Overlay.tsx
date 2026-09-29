import { useEffect, useRef, useState } from "react";
import { apiBase } from "../lib/api";
import { BridgeClient } from "../lib/bridge-client";
import { Avatar } from "./Avatar";
import type { AvatarHandle } from "./Avatar";
import "../overlay.css";

/** The Electron shell supplies the bridge URL; only loopback is accepted. */
function bridgeBase() {
  const param = new URLSearchParams(location.search).get("bridge");
  if (param && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(param)) return param;
  return apiBase || "http://127.0.0.1:8787";
}

/** Design-copy mirror, rendered by the existing Electron/WebSocket shell. */
export function Overlay() {
  const avatar = useRef<AvatarHandle>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add("overlay-page");
    const client = new BridgeClient(bridgeBase(), "overlay", {
      hello: hello => setLocked(hello.locked),
      frame: frame => avatar.current?.draw({ type: "frame", duration: 0, ...frame }),
      command: (gesture, isLocked) => {
        setLocked(isLocked);
        avatar.current?.react(gesture);
      },
      session: session => {
        if (session.stage === "finished" || session.stage === "idle") avatar.current?.clear();
      },
      online: online => { if (!online) avatar.current?.clear(); },
    });
    client.start();
    return () => {
      client.stop();
      document.documentElement.classList.remove("overlay-page");
    };
  }, []);
  return <main className="overlay-notch" aria-label="3D-зеркало спикера">
    <div className="overlay-avatar"><Avatar ref={avatar} locked={locked} face="none" headStyle="ghost" /></div>
  </main>;
}
