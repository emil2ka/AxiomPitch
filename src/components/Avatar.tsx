import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { AvatarScene } from "../lib/avatar";
import type { Gesture, VisionFrame } from "../lib/types";

export type AvatarHandle = {
  draw: (frame: VisionFrame) => void;
  clear: () => void;
  react: (gesture: Gesture) => void;
};
export const Avatar = forwardRef<AvatarHandle, { locked: boolean }>(
  function Avatar({ locked }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<AvatarScene | null>(null);
    const lockedRef = useRef(locked);
    useImperativeHandle(
      ref,
      () => ({
        draw: (frame) => sceneRef.current?.draw(frame),
        clear: () => sceneRef.current?.clear(),
        react: (gesture) => sceneRef.current?.react(gesture),
      }),
      [],
    );
    useEffect(() => {
      let cancelled = false;
      const host = hostRef.current;
      if (!host) return;
      void import("../lib/avatar")
        .then(({ createAvatarScene }) => {
          if (cancelled) return;
          try {
            sceneRef.current = createAvatarScene(host);
            sceneRef.current.setLocked(lockedRef.current);
          } catch (error) {
            host.dataset.webglError = "true";
            console.warn("3D avatar:", error);
          }
        })
        .catch(() => {
          if (!cancelled) host.dataset.webglError = "true";
        });
      return () => {
        cancelled = true;
        sceneRef.current?.dispose();
        sceneRef.current = null;
      };
    }, []);
    useEffect(() => {
      lockedRef.current = locked;
      sceneRef.current?.setLocked(locked);
    }, [locked]);
    return (
      <div
        ref={hostRef}
        className="avatar-scene"
        role="img"
        aria-label="Синий 3D-аватар: округлая голова с глазами и улыбкой и две объёмные ладони"
      >
        <span className="avatar-fallback">
          Для 3D-аватара включи WebGL в браузере
        </span>
      </div>
    );
  },
);
