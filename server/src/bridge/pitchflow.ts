import { TargetError } from "./target.ts";
import type { SlideState, Target } from "./target.ts";

/** Channel back to the speaker tab, which owns the PitchFlow deck. */
export type SpeakerLink = {
  online: () => boolean;
  /** Asks the tab to step like the keyboard arrows do. False if nobody listens. */
  step: (gesture: "next" | "previous") => boolean;
};

/**
 * The deck inside PitchFlow. The speaker tab moves it on its own gestures and
 * reports the position in `session` messages; the bridge only mirrors that
 * and relays HTTP control requests back to the tab.
 */
export class PitchflowTarget implements Target {
  readonly id = "pitchflow" as const;
  readonly label = "PitchFlow";
  private link: SpeakerLink;
  private state: SlideState | null = null;
  constructor(link: SpeakerLink = { online: () => false, step: () => false }) {
    this.link = link;
  }
  async available() {
    return this.link.online();
  }
  async connect() {}
  async disconnect() {}
  next() {
    return this.step("next");
  }
  previous() {
    return this.step("previous");
  }
  async readState() {
    return this.state;
  }
  /** Position as the speaker tab reported it. */
  mirror(state: SlideState | null) {
    this.state = state;
  }
  private async step(gesture: "next" | "previous") {
    if (!this.link.step(gesture))
      throw new TargetError("Вкладка спикера PitchFlow не подключена к мосту.");
    // The tab clamps the same way, and confirms with its next session message.
    if (this.state)
      this.state = {
        ...this.state,
        slideIndex: Math.max(
          0,
          Math.min(
            this.state.slideCount - 1,
            this.state.slideIndex + (gesture === "next" ? 1 : -1),
          ),
        ),
      };
  }
}
