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
        outputSegmentationMasks: true,
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
      const mask = result.segmentationMasks?.[0];
      const frame: VisionFrame = {
        type: "frame",
        time: event.data.time,
        pose: mirror(result.landmarks[0] ?? []),
        hands: hands.landmarks.map(mirror),
        duration: performance.now() - started,
      };
      if (mask && frame.pose.length > 0) {
        const values = mask.getAsFloat32Array();
        const pixels = new Uint8ClampedArray(values.length * 4);
        for (let i = 0; i < values.length; i++) {
          const a = Math.max(0, Math.min(1, (values[i] - 0.32) / 0.36));
          pixels[i * 4] = 49;
          pixels[i * 4 + 1] = 133;
          pixels[i * 4 + 2] = 255;
          pixels[i * 4 + 3] = Math.round(a * a * (3 - 2 * a) * 255);
        }
        frame.mask = { width: mask.width, height: mask.height, pixels };
        self.postMessage(frame, [pixels.buffer]);
      } else self.postMessage(frame);
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
