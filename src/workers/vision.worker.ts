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
let bodyPoints: Point[] = [], bodyWorld: Point[] = [];
let frameCount = 0;
const mirrorWorld = (points: Point[]) => points.map((p) => ({ ...p, x: -p.x }));
const mirror = (points: Point[]) => points.map((p) => ({ ...p, x: 1 - p.x }));

self.onmessage = async (event: MessageEvent) => {
  if (event.data.type === "init") {
    try {
      const base = event.data.base as string;
      const files = await FilesetResolver.forVisionTasks(`${base}/wasm`, true);
      hand = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${base}/hand_landmarker.task`, delegate: "CPU" },
        canvas: new OffscreenCanvas(640, 480),
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });
      // Body tracking decorates the mirror but must never disable hand commands.
      try {
        pose = await PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${base}/pose_landmarker_lite.task`, delegate: "CPU" },
          canvas: new OffscreenCanvas(640, 480),
          runningMode: "VIDEO",
          numPoses: 1,
          outputSegmentationMasks: false,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
        });
      } catch { pose = undefined; }
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
  if (!hand) {
    bitmap.close();
    return;
  }
  const started = performance.now();
  try {
    const hands = hand.detectForVideo(bitmap, event.data.time);
    if (pose && frameCount++ % 3 === 0) {
      try {
        pose.detectForVideo(bitmap, event.data.time, result => {
          bodyPoints = mirror(result.landmarks[0] ?? []);
          bodyWorld = mirrorWorld(result.worldLandmarks[0] ?? []);
        });
      } catch { pose.close(); pose = undefined; bodyPoints = []; bodyWorld = []; }
    }
    const frame: VisionFrame = {
      type: "frame",
      time: event.data.time,
      pose: bodyPoints,
      hands: hands.landmarks.map(mirror),
      poseWorld: bodyWorld,
      handWorlds: hands.worldLandmarks.map(mirrorWorld),
      handLabels: hands.handedness.map(labels => labels[0]?.categoryName ?? ""),
      handScores: hands.handedness.map(labels => labels[0]?.score ?? 0),
      duration: performance.now() - started,
    };
    self.postMessage(frame);
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
