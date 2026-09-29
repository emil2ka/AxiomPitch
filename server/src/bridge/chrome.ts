import { FrontmostTarget } from "./frontmost.ts";
import { macSystem } from "./osascript.ts";
import type { AppRef, MacSystem } from "./osascript.ts";

export const chromeApp: AppRef = {
  name: "Google Chrome",
  bundleId: "com.google.Chrome",
};

/**
 * Google Slides presenting in Chrome. Arrows go only to Chrome while it is in
 * front and its window is not the PitchFlow tab. Slides exposes no stable
 * slide number, so readState is null and the bridge client estimates.
 */
export function createChromeTarget(system: MacSystem = macSystem) {
  return new FrontmostTarget(
    system,
    chromeApp,
    "chrome",
    "Google Slides в Chrome",
  );
}
