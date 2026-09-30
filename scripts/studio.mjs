import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = process.env.PITCHFLOW_PORT || "8787";
const bridge = `http://127.0.0.1:${port}`;
const origin = "http://127.0.0.1:5173";
const env = { ...process.env, VITE_API_BASE_URL: bridge, PITCHFLOW_ORIGIN: origin, PITCHFLOW_BRIDGE: bridge };
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop());
function start(command, args) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.add(child);
  child.once("error", error => { console.error(error.message); stop(1); });
  child.once("exit", code => { children.delete(child); if (!stopping) stop(code || 1); });
}
// Prepare physical notch geometry before opening Electron.
const setup = spawn(process.execPath, ["scripts/setup-overlay.mjs"], { cwd: root, env, stdio: "inherit" });
children.add(setup);
setup.once("exit", () => children.delete(setup));
const prepared = await new Promise(resolve => {
  setup.once("error", () => resolve(false));
  setup.once("exit", code => resolve(code === 0));
});
if (!prepared) process.exitCode = 1;
else if (!stopping) {
  start(process.execPath, ["--experimental-strip-types", "server/src/index.ts"]);
  start(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
  start(electron, ["overlay/main.ts"]);
  console.log(`Студия и чёлка: ${origin}/studio · Ctrl+C завершает все три процесса.`);
}
