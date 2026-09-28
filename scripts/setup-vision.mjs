import { cp, mkdir, stat, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "public/vision");
await mkdir(output, { recursive: true });
await cp(
  path.join(root, "node_modules/@mediapipe/tasks-vision/wasm"),
  path.join(output, "wasm"),
  { recursive: true },
);
const models = [
  [
    "pose_landmarker_lite.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  ],
  [
    "hand_landmarker.task",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  ],
];
for (const [name, url] of models) {
  const destination = path.join(output, name);
  try {
    if ((await stat(destination)).size > 100000) continue;
  } catch {
    /* Download missing model. */
  }
  console.log(`Preparing ${name}…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status} ${url}`);
  const content = new Uint8Array(await response.arrayBuffer());
  if (content.length < 100000) throw new Error(`Invalid model: ${name}`);
  await writeFile(`${destination}.tmp`, content);
  await rename(`${destination}.tmp`, destination);
}
console.log("Vision assets ready (local models and WASM).");
