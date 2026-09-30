import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
import type { VisionFrame } from "../lib/types";
import { CameraContext } from "./camera-context";
export type { CameraStatus } from "./useCameraController";

export function useCameraPreparation() {
  const camera = useContext(CameraContext);
  if (!camera) throw new Error("CameraProvider is missing");
  return { preflight: camera.preflight, setPreflight: camera.setPreflight };
}

export function useCamera(onFrame: (frame: VisionFrame) => void, deviceId = "") {
  const camera = useContext(CameraContext);
  if (!camera) throw new Error("CameraProvider is missing");
  const callback = useRef(onFrame);
  useLayoutEffect(() => { callback.current = onFrame; }, [onFrame]);
  const { subscribe, start: startCapture } = camera;
  useEffect(() => subscribe(frame => callback.current(frame)), [subscribe]);
  const start = useCallback(() => startCapture(deviceId), [startCapture, deviceId]);
  return { ...camera, start };
}
