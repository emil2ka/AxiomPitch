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
let visionFiles:
  | Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
  | undefined;
let modelBase = "";
let handCosts: number[] = [];
let handSettled = false;
const mirrorWorld = (points: Point[]) => points.map((p) => ({ ...p, x: -p.x }));
const mirror = (points: Point[]) => points.map((p) => ({ ...p, x: 1 - p.x }));

const handOptions = (delegate: "GPU" | "CPU") => ({
  baseOptions: { modelAssetPath: `${modelBase}/hand_landmarker.task`, delegate },
  canvas: new OffscreenCanvas(640, 480),
  runningMode: "VIDEO" as const,
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

/** A software WebGL rasterizer (SwiftShader, llvmpipe) is slower than plain CPU. */
const hasHardwareWebgl = () => {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : "";
    return !/swiftshader|software|llvmpipe|mesa/i.test(renderer);
  } catch {
    return false;
  }
};

self.onmessage = async (event: MessageEvent) => {
  if (event.data.type === "init") {
    try {
      const base = event.data.base as string;
      modelBase = base;
      const files = await FilesetResolver.forVisionTasks(`${base}/wasm`, true);
      visionFiles = files;
      // The GPU delegate keeps more frames per second on real hardware; a
      // software rasterizer or a failed context falls back to plain CPU.
      if (hasHardwareWebgl()) {
        try {
          hand = await HandLandmarker.createFromOptions(files, handOptions("GPU"));
        } catch {
          hand = await HandLandmarker.createFromOptions(files, handOptions("CPU"));
        }
      } else {
        hand = await HandLandmarker.createFromOptions(files, handOptions("CPU"));
      }
      // Body tracking decorates the mirror but must never disable hand commands.
      try {
        pose = await PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${base}/pose_landmarker_lite.task`, delegate: "CPU" },
          canvas: new OffscreenCanvas(640, 480),
          runningMode: "VIDEO",
          numPoses: 1,
          outputSegmentationMasks: false,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
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
  frameCount++;
  try {
    const hands = hand.detectForVideo(bitmap, event.data.time);
    if (!handSettled) {
      // Skip the warm-up frames, then judge the delegate by the median cost:
      // a couple of shader-compile spikes must not force a false fallback.
      if (frameCount > 3) handCosts.push(performance.now() - started);
      if (handCosts.length >= 9 && visionFiles) {
        handSettled = true;
        const sorted = [...handCosts].sort((a, b) => a - b);
        if (sorted[Math.floor(sorted.length / 2)] > 55) {
          hand.close();
          hand = await HandLandmarker.createFromOptions(
            visionFiles,
            handOptions("CPU"),
          );
        }
      }
    }
    if (pose && frameCount % 3 === 0) {
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
