import { macSystem } from "./osascript.ts";
import type { MacSystem } from "./osascript.ts";
import { parseSlidePosition, TargetError } from "./target.ts";
import type { SlideState, Target } from "./target.ts";

const bundleId = "com.microsoft.Powerpoint";

/** Active PowerPoint for Mac slide show via AppleScript. */
export class PowerPointTarget implements Target {
  readonly id = "powerpoint" as const;
  readonly label = "PowerPoint";
  private system: MacSystem;
  constructor(system: MacSystem = macSystem) {
    this.system = system;
  }
  available() {
    return this.system.isRunning(bundleId);
  }
  async connect() {
    if (!(await this.available()))
      throw new TargetError(
        "PowerPoint не запущен. Открой презентацию в PowerPoint.",
      );
  }
  async disconnect() {}
  next() {
    return this.go("next");
  }
  previous() {
    return this.go("previous");
  }
  async readState(): Promise<SlideState | null> {
    if (!(await this.available())) return null;
    const position = await this.system
      .run(
        `tell application id "${bundleId}"
  if (count of slide show windows) is 0 then return ""
  set shown to slide show window 1
  return ((slide index of slide of slideshow view of shown) as text) & "/" & ((count of slides of presentation of shown) as text)
end tell`,
      )
      .catch(() => "");
    return parseSlidePosition(position);
  }
  private async go(direction: "next" | "previous") {
    if (!(await this.available()))
      throw new TargetError("PowerPoint не запущен.");
    const result = await this.system.run(
      `tell application id "${bundleId}"
  if (count of slide show windows) is 0 then return "not-playing"
  go to ${direction} slide (slideshow view of slide show window 1)
  return "ok"
end tell`,
    );
    if (result !== "ok")
      throw new TargetError("Не запущен показ слайдов в PowerPoint.");
  }
}
