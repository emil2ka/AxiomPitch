import { useEffect, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { apiBase } from "../lib/api";
import { BridgeClient } from "../lib/bridge-client";
import type { Gesture } from "../lib/types";
import { Avatar } from "./Avatar";
import type { AvatarHandle } from "./Avatar";

/** The Electron shell says where the bridge is; only loopback is accepted. */
function bridgeBase() {
  const param = new URLSearchParams(location.search).get("bridge");
  if (param && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(param))
    return param;
  return apiBase || "http://127.0.0.1:8787";
}

const isLive = (stage?: string) => stage === "running" || stage === "paused";

/**
 * The notch on the audience screen (?overlay=1): the same Avatar on a
 * transparent page, moved by poses the speaker tab already computed.
 * There is no camera here.
 */
export function Overlay() {
  const avatar = useRef<AvatarHandle>(null);
  const [locked, setLocked] = useState(false);
  const [live, setLive] = useState(false);
  const [pulse, setPulse] = useState<{ id: number; gesture: Gesture } | null>(
    null,
  );
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    document.documentElement.classList.add("overlay-page");
    const client = new BridgeClient(bridgeBase(), "overlay", {
      hello: (hello) => {
        setLocked(hello.locked);
        setLive(isLive(hello.session?.stage));
      },
      // Stale poses fade back to the calm pose inside the avatar itself.
      frame: (frame) =>
        avatar.current?.draw({ type: "frame", duration: 0, ...frame }),
      command: (gesture, isLocked) => {
        setLocked(isLocked);
        avatar.current?.react(gesture);
        setPulse({ id: Date.now(), gesture });
      },
      session: (session) => setLive(isLive(session.stage)),
      online: (online) => {
        if (!online) avatar.current?.clear();
      },
    });
    client.start();
    return () => {
      client.stop();
      document.documentElement.classList.remove("overlay-page");
    };
  }, []);
  return (
    <main className="overlay-notch">
      <Avatar ref={avatar} locked={locked} />
      {live && <span className="overlay-live" aria-label="Идёт выступление" />}
      {locked && (
        <span className="notch-lock" aria-label="Жесты заблокированы">
          <LockKeyhole size={12} />
        </span>
      )}
      {pulse && !reducedMotion && (
        <motion.div
          key={pulse.id}
          className={`notch-pulse ${pulse.gesture}`}
          initial={{
            opacity: 0.9,
            x:
              pulse.gesture === "next"
                ? -100
                : pulse.gesture === "previous"
                  ? 100
                  : 0,
            scaleX: pulse.gesture === "toggle" ? 0.3 : 1,
          }}
          animate={{
            opacity: 0,
            x:
              pulse.gesture === "next"
                ? 100
                : pulse.gesture === "previous"
                  ? -100
                  : 0,
            scaleX: 1,
          }}
          transition={{ duration: 0.38 }}
        />
      )}
    </main>
  );
}
