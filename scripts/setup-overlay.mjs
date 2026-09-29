import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.platform === "darwin") {
  const source = fileURLToPath(new URL("../overlay/ScreenGeometry.swift", import.meta.url));
  const output = fileURLToPath(new URL("../work/overlay/screen-geometry", import.meta.url));
  mkdirSync(fileURLToPath(new URL("../work/overlay", import.meta.url)), { recursive: true });
  if (!existsSync(output) || statSync(source).mtimeMs > statSync(output).mtimeMs)
    execFileSync("xcrun", ["swiftc", source, "-o", output], { stdio: "inherit" });
}
