import { macSystem } from "./osascript.ts";
import type { MacSystem } from "./osascript.ts";
import { parseSlidePosition, TargetError } from "./target.ts";
import type { SlideState, Target } from "./target.ts";

const bundleId = "com.apple.iWork.Keynote";

/** Keynote slideshow via AppleScript. Works even when Keynote is not frontmost. */
export class KeynoteTarget implements Target {
  readonly id = "keynote" as const;
  readonly label = "Keynote";
  private system: MacSystem;
  constructor(system: MacSystem = macSystem) {
    this.system = system;
  }
  available() {
    return this.system.isRunning(bundleId);
  }
  async connect() {
    if (!(await this.available()))
      throw new TargetError("Keynote не запущен. Открой презентацию в Keynote.");
  }
  async disconnect() {}
  next() {
    return this.show("next");
  }
  previous() {
    return this.show("previous");
  }
  async readState(): Promise<SlideState | null> {
    // The running check comes first: `tell application` would launch Keynote.
    if (!(await this.available())) return null;
    const position = await this.system
      .run(
        `tell application id "${bundleId}"
  if not playing then return ""
  tell front document to return ((slide number of current slide) as text) & "/" & ((count of slides) as text)
end tell`,
      )
      .catch(() => "");
    return parseSlidePosition(position);
  }
  private async show(direction: "next" | "previous") {
    if (!(await this.available()))
      throw new TargetError("Keynote не запущен.");
    const result = await this.system.run(
      `tell application id "${bundleId}"
  if not playing then return "not-playing"
  show ${direction}
  return "ok"
end tell`,
    );
    if (result !== "ok")
      throw new TargetError("Не запущен показ слайдов в Keynote.");
  }
}
