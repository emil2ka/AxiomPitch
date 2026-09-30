import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, SetStateAction } from "react";
import { CameraContext } from "../hooks/camera-context";
import { useCameraController } from "../hooks/useCameraController";
import { newPreflight } from "../lib/preflight";
import type { Preflight } from "../lib/preflight";
import { profileStorage } from "../lib/account";
import type { VisionFrame } from "../lib/types";

/** One capture and worker for the whole visit, including learning -> studio. */
export function CameraProvider({ children, scope }: { children?: ReactNode; scope: string | null }) {
  const listeners = useRef(new Set<(frame: VisionFrame) => void>());
  const dispatch = useCallback((frame: VisionFrame) => {
    for (const listener of listeners.current) listener(frame);
  }, []);
  const { status, error, phase, fps, devices, videoRef, start, stop: stopCapture, sessionId } = useCameraController(dispatch);
  const [proof, setProof] = useState(() => ({ sessionId: -1, value: newPreflight() }));
  const preflight = useMemo(() => status === "ready" && proof.sessionId === sessionId ? proof.value : newPreflight(), [status, sessionId, proof]);
  const setPreflight = useCallback((action: SetStateAction<Preflight>) => {
    setProof(previous => {
      const current = previous.sessionId === sessionId ? previous.value : newPreflight();
      return { sessionId, value: typeof action === "function" ? action(current) : action };
    });
  }, [sessionId]);
  const intentKey = scope ? `axiompitch-camera-active:${scope}` : null;
  const subscribe = useCallback((listener: (frame: VisionFrame) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const stop = useCallback(() => {
    if (intentKey) try { sessionStorage.removeItem(intentKey); } catch { /* Memory still works. */ }
    stopCapture();
  }, [stopCapture, intentKey]);
  // Leaving authenticated work or switching accounts releases the camera.
  // A reload restores the user's last explicit choice only in this same tab.
  useEffect(() => {
    if (!scope || !intentKey) { stopCapture(); return; }
    try {
      if (sessionStorage.getItem(intentKey) === "on") void start(profileStorage(scope).getItem("axiompitch-camera") || "");
    } catch { /* No automatic reconnect when session storage is unavailable. */ }
    return stopCapture;
  }, [scope, intentKey, start, stopCapture]);
  useEffect(() => {
    if (!intentKey) return;
    try {
      if (status === "ready" && videoRef.current?.srcObject) sessionStorage.setItem(intentKey, "on");
      else if (status === "error") sessionStorage.removeItem(intentKey);
    } catch { /* Navigation still shares the live stream. */ }
  }, [status, intentKey, videoRef]);
  const value = useMemo(() => ({ status, error, phase, fps, devices, videoRef, start, stop, sessionId, subscribe, preflight, setPreflight }), [status, error, phase, fps, devices, videoRef, start, stop, sessionId, subscribe, preflight, setPreflight]);
  return <CameraContext.Provider value={value}>
    <video ref={videoRef} className="camera-source" playsInline muted aria-hidden="true" />
    {children}
    {status === "ready" && <div className="camera-session-status" role="status"><span>Камера включена</span><button onClick={stop}>Выключить камеру</button></div>}
  </CameraContext.Provider>;
}
