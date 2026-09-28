/// <reference lib="webworker" />
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import type { Point, VisionFrame } from "../lib/types";

// MediaPipe clears ModuleFactory after each task. Reassign the cached ES module
// export for every import so the second task initializes in a module worker.
const scope = self as unknown as {
  import?: (url: string) => Promise<void>;
  ModuleFactory?: unknown;
};
scope.import = async (url: string) => {
  const module = await import(/* @vite-ignore */ url);
  scope.ModuleFactory = module.default;
};

let pose: PoseLandmarker | undefined;
let hand: HandLandmarker | undefined;
const mirrorWorld = (points: Point[]) => points.map((p) => ({ ...p, x: -p.x }));
const mirror = (points: Point[]) => points.map((p) => ({ ...p, x: 1 - p.x }));

self.onmessage = async (event: MessageEvent) => {
  if (event.data.type === "init") {
    try {
      const base = event.data.base as string;
      const files = await FilesetResolver.forVisionTasks(`${base}/wasm`, true);
      pose = await PoseLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: `${base}/pose_landmarker_lite.task`,
          delegate: "CPU",
        },
        canvas: new OffscreenCanvas(640, 480),
        runningMode: "VIDEO",
        numPoses: 1,
        outputSegmentationMasks: false,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
      });
      hand = await HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: `${base}/hand_landmarker.task`,
          delegate: "CPU",
        },
        canvas: new OffscreenCanvas(640, 480),
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить модель",
      });
    }
    return;
  }
  if (event.data.type !== "frame") return;
  const bitmap = event.data.bitmap as ImageBitmap;
  if (!pose || !hand) {
    bitmap.close();
    return;
  }
  const started = performance.now();
  try {
    const hands = hand.detectForVideo(bitmap, event.data.time);
    pose.detectForVideo(bitmap, event.data.time, (result) => {
      const frame: VisionFrame = {
        type: "frame",
        time: event.data.time,
        pose: mirror(result.landmarks[0] ?? []),
        hands: hands.landmarks.map(mirror),
        poseWorld: mirrorWorld(result.worldLandmarks[0] ?? []),
        handWorlds: hands.worldLandmarks.map(mirrorWorld),
        handLabels: hands.handedness.map(
          (labels) => labels[0]?.categoryName ?? "",
        ),
        duration: performance.now() - started,
      };
      self.postMessage(frame);
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "Ошибка обработки камеры",
    });
  } finally {
    bitmap.close();
  }
};
