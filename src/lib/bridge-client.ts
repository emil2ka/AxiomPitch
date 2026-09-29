import { jsonBody, request } from "./api.ts";
import type { Gesture, Point, VisionFrame } from "./types.ts";

export type TargetId =
  "pitchflow" | "keynote" | "powerpoint" | "chrome" | "frontmost";
export type Step = "next" | "previous";
export type TargetStatus = {
  app: TargetId | null;
  label: string | null;
  connected: boolean;
  /** Zero-based slide number from the app itself; null when unknown. */
  slideIndex: number | null;
  slideCount: number | null;
  gesture?: Step;
  error?: string;
};
export type TargetInfo = {
  id: TargetId;
  label: string;
  available: boolean;
  connected: boolean;
};
export type AppRef = { name: string; bundleId: string };
export type LiveSession = {
  stage: "idle" | "running" | "paused" | "finished";
  mode: "rehearsal" | "live";
  index: number;
  slideCount: number;
  durationMs: number;
};
export type OverlayState = { visible: boolean; displayId: number | null };
export type LiveFrame = Pick<
  VisionFrame,
  "time" | "pose" | "hands" | "poseWorld" | "handWorlds" | "handLabels"
>;
export type Hello = {
  locked: boolean;
  session: LiveSession | null;
  overlay: OverlayState;
};

/** An app outside PitchFlow: slides move there, not in the tab's own deck. */
export const isExternal = (status: TargetStatus | null) =>
  Boolean(status?.connected && status.app && status.app !== "pitchflow");

const round = (value: number) => Math.round(value * 10000) / 10000;
const trimPoints = (points: Point[]) =>
  points.map((point) => {
    const trimmed: Point = { x: round(point.x), y: round(point.y) };
    if (point.z !== undefined) trimmed.z = round(point.z);
    if (point.visibility !== undefined)
      trimmed.visibility = round(point.visibility);
    return trimmed;
  });

/** Only the coordinates the notch draws. The camera image never leaves the tab. */
export function trimFrame(frame: VisionFrame): LiveFrame {
  return {
    time: Math.round(frame.time),
    pose: trimPoints(frame.pose),
    hands: frame.hands.map(trimPoints),
    ...(frame.poseWorld && { poseWorld: trimPoints(frame.poseWorld) }),
    ...(frame.handWorlds && { handWorlds: frame.handWorlds.map(trimPoints) }),
    ...(frame.handLabels && { handLabels: frame.handLabels }),
  };
}

/**
 * Where the console should stand after the bridge reported a step. The app's
 * own number wins; without one the console moves one step and marks the
 * position as estimated, so a guess is never shown as the app's slide number.
 */
export function followTarget(
  status: TargetStatus,
  index: number,
  deckLength: number,
): { index: number; estimated: boolean } | null {
  if (status.error || !status.connected) return null;
  const clamp = (value: number) => Math.max(0, Math.min(deckLength - 1, value));
  if (status.slideIndex !== null)
    return { index: clamp(status.slideIndex), estimated: false };
  if (!status.gesture) return null;
  return {
    index: clamp(index + (status.gesture === "next" ? 1 : -1)),
    estimated: true,
  };
}

export type BridgeEvents = {
  online?: (online: boolean) => void;
  hello?: (hello: Hello) => void;
  target?: (status: TargetStatus) => void;
  overlay?: (state: OverlayState) => void;
  /** A remote step for the PitchFlow deck (POST /api/control). */
  control?: (gesture: Step) => void;
  frame?: (frame: LiveFrame) => void;
  command?: (gesture: Gesture, locked: boolean) => void;
  session?: (session: LiveSession) => void;
};

type Message = { type?: unknown; [field: string]: unknown };

/** WebSocket /live with reconnects, plus the bridge's HTTP calls. */
export class BridgeClient {
  readonly base: string;
  private role: "speaker" | "overlay";
  private events: BridgeEvents;
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private delay = 1000;
  private stopped = true;

  constructor(
    base: string,
    role: "speaker" | "overlay",
    events: BridgeEvents = {},
  ) {
    this.base = base;
    this.role = role;
    this.events = events;
  }

  get online() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close();
    this.socket = null;
  }

  publishFrame(frame: VisionFrame) {
    // Only the latest pose matters: skip instead of queueing behind a slow socket.
    if ((this.socket?.bufferedAmount ?? 0) > 64 * 1024) return false;
    return this.send({ type: "frame", ...trimFrame(frame) });
  }

  publishCommand(gesture: Gesture, locked: boolean) {
    return this.send({ type: "command", gesture, locked });
  }

  publishSession(session: LiveSession) {
    return this.send({ type: "session", ...session });
  }

  targets() {
    return request<{
      current: TargetStatus;
      targets: TargetInfo[];
      apps: AppRef[];
    }>("/api/targets", {}, this.base);
  }

  connectTarget(app: TargetId, process?: string) {
    return request<TargetStatus>(
      "/api/targets/connect",
      jsonBody({ app, process }),
      this.base,
    );
  }

  disconnectTarget() {
    return request<TargetStatus>(
      "/api/targets/current",
      { method: "DELETE" },
      this.base,
    );
  }

  control(gesture: Step, locked: boolean) {
    return request<TargetStatus>(
      "/api/control",
      jsonBody({ gesture, locked }),
      this.base,
    );
  }

  setOverlay(visible: boolean, displayId?: number | null) {
    return request<OverlayState & { shellConnected: boolean }>(
      "/api/overlay",
      jsonBody({ visible, displayId }),
      this.base,
    );
  }

  private open() {
    if (this.stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        `${this.base.replace(/^http/, "ws")}/live?role=${this.role}`,
      );
    } catch {
      this.schedule();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.delay = 1000;
      this.events.online?.(true);
    };
    socket.onmessage = (event) => this.receive(event.data);
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.events.online?.(false);
      this.schedule();
    };
    socket.onerror = () => socket.close();
  }

  private schedule() {
    clearTimeout(this.retry);
    if (this.stopped) return;
    this.retry = setTimeout(() => this.open(), this.delay);
    this.delay = Math.min(5000, this.delay * 1.6);
  }

  private send(message: Message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private receive(data: unknown) {
    let message: Message;
    try {
      message = JSON.parse(String(data)) as Message;
    } catch {
      return;
    }
    const events = this.events;
    switch (message.type) {
      case "hello":
        events.hello?.(message as unknown as Hello);
        break;
      case "target":
        events.target?.(message as unknown as TargetStatus);
        break;
      case "overlay":
        events.overlay?.(message as unknown as OverlayState);
        break;
      case "control":
        if (message.gesture === "next" || message.gesture === "previous")
          events.control?.(message.gesture);
        break;
      case "frame":
        events.frame?.(message as unknown as LiveFrame);
        break;
      case "command":
        events.command?.(message.gesture as Gesture, message.locked === true);
        break;
      case "session":
        events.session?.(message as unknown as LiveSession);
        break;
    }
  }
}
