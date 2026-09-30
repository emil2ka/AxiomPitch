import { createContext } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Preflight } from "../lib/preflight";
import type { VisionFrame } from "../lib/types";
import type { useCameraController } from "./useCameraController";
export type CameraSession = ReturnType<typeof useCameraController> & {
  subscribe: (listener: (frame: VisionFrame) => void) => () => void;
  preflight: Preflight;
  setPreflight: Dispatch<SetStateAction<Preflight>>;
};
export const CameraContext = createContext<CameraSession | null>(null);
