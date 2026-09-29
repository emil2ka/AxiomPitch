import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { AvatarExpression, AvatarScene, LessonMotion } from "../lib/avatar";
import type { Gesture, VisionFrame } from "../lib/types";

export type AvatarHandle = {
  draw: (frame: VisionFrame) => void;
  clear: () => void;
  react: (gesture: Gesture) => void;
  setExpression: (expression: AvatarExpression) => void;
};
export const Avatar = forwardRef<
  AvatarHandle,
  { locked: boolean; face?: "none" | "expressive"; lesson?: LessonMotion | null; headStyle?: "solid" | "ghost"; transitionName?: string; onReady?: () => void }
>(function Avatar({ locked, face = "expressive", lesson = null, headStyle = "solid", transitionName, onReady }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AvatarScene | null>(null);
  const readyRef = useRef(onReady);
  useEffect(() => { readyRef.current = onReady; }, [onReady]);
  const lockedRef = useRef(locked);
  const lessonRef = useRef(lesson);
  useImperativeHandle(
    ref,
    () => ({
      draw: (frame) => sceneRef.current?.draw(frame),
      clear: () => sceneRef.current?.clear(),
      react: (gesture) => sceneRef.current?.react(gesture),
      setExpression: (expression) => sceneRef.current?.setExpression(expression),
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
          sceneRef.current = createAvatarScene(host, { face, headStyle });
          sceneRef.current.setLocked(lockedRef.current);
          sceneRef.current.setLesson(lessonRef.current);
          readyRef.current?.();
        } catch (error) {
          host.dataset.webglError = "true";
          console.warn("3D avatar:", error);
          readyRef.current?.();
        }
      })
      .catch(() => {
        if (!cancelled) { host.dataset.webglError = "true"; readyRef.current?.(); }
      });
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [face, headStyle]);
  useEffect(() => {
    lockedRef.current = locked;
    sceneRef.current?.setLocked(locked);
  }, [locked]);
  useEffect(() => {
    lessonRef.current = lesson;
    sceneRef.current?.setLesson(lesson);
  }, [lesson]);
  return (
    <div
      ref={hostRef}
      className="avatar-scene"
      style={transitionName ? { viewTransitionName: transitionName } : undefined}
      role="img"
      aria-label={
        face === "expressive"
          ? "Синий 3D-помощник: две выразительные ладони и маленькое лицо на заднем плане"
          : "Безликое 3D-зеркало спикера: округлая голова и две объёмные ладони"
      }
    >
      <span className="avatar-fallback">
        Для 3D-аватара включи WebGL в браузере
      </span>
    </div>
  );
});
