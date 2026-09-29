import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Gesture, Step } from "./bridge/controller.ts";
import { isRecord } from "./http.ts";

/** speaker: the browser tab with the camera; overlay: the notch page; shell: Electron. */
export type Role = "speaker" | "overlay" | "shell";
const roles: readonly Role[] = ["speaker", "overlay", "shell"];

type Point = { x: number; y: number; z?: number; visibility?: number };
/** Pose coordinates the tab already computed. Never pixels. */
export type LiveFrame = {
  type: "frame";
  time: number;
  pose: Point[];
  hands: Point[][];
  poseWorld?: Point[];
  handWorlds?: Point[][];
  handLabels?: string[];
  handScores?: number[];
};
export type LiveCommand = {
  type: "command";
  gesture: Gesture;
  locked: boolean;
};
export type LiveSession = {
  type: "session";
  stage: "idle" | "running" | "paused" | "finished";
  mode: "rehearsal" | "live";
  index: number;
  slideCount: number;
  durationMs: number;
  id?: string;
  overlayEnabled?: boolean;
  overlayDisplayId?: number | null;
};
export type OverlayState = {
  type: "overlay";
  visible: boolean;
  displayId: number | null;
};
export type DisplayInfo = {
  id: number;
  label: string;
  primary: boolean;
  width: number;
  height: number;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const count = (value: unknown, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

function points(value: unknown, max: number): Point[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const result: Point[] = [];
  for (const item of value) {
    if (!isRecord(item) || !finite(item.x) || !finite(item.y)) return null;
    const point: Point = { x: item.x, y: item.y };
    if (finite(item.z)) point.z = item.z;
    if (finite(item.visibility)) point.visibility = item.visibility;
    result.push(point);
  }
  return result;
}
function hands(value: unknown): Point[][] | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const result: Point[][] = [];
  for (const hand of value) {
    const parsed = points(hand, 21);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

/** Keeps only the fields the notch draws, with bounded sizes. */
export function parseFrame(message: Record<string, unknown>): LiveFrame | null {
  const pose = points(message.pose, 33);
  const palms = hands(message.hands);
  if (!finite(message.time) || !pose || !palms) return null;
  const frame: LiveFrame = {
    type: "frame",
    time: message.time,
    pose,
    hands: palms,
  };
  if (message.poseWorld !== undefined) {
    const world = points(message.poseWorld, 33);
    if (!world) return null;
    frame.poseWorld = world;
  }
  if (message.handWorlds !== undefined) {
    const worlds = hands(message.handWorlds);
    if (!worlds) return null;
    frame.handWorlds = worlds;
  }
  if (message.handLabels !== undefined) {
    const labels = message.handLabels;
    if (
      !Array.isArray(labels) ||
      labels.length > 2 ||
      !labels.every((label) => typeof label === "string" && label.length <= 16)
    )
      return null;
    frame.handLabels = labels as string[];
  }
  if (message.handScores !== undefined) {
    const scores = message.handScores;
    if (!Array.isArray(scores) || scores.length > 2 ||
        !scores.every(score => finite(score) && score >= 0 && score <= 1)) return null;
    frame.handScores = scores as number[];
  }
  return frame;
}

export function parseCommand(
  message: Record<string, unknown>,
): LiveCommand | null {
  const { gesture, locked } = message;
  if (
    (gesture !== "next" && gesture !== "previous" && gesture !== "toggle") ||
    typeof locked !== "boolean"
  )
    return null;
  return { type: "command", gesture, locked };
}

export function parseSession(
  message: Record<string, unknown>,
): LiveSession | null {
  const { stage, mode, index, slideCount, durationMs } = message;
  if (
    (stage !== "idle" &&
      stage !== "running" &&
      stage !== "paused" &&
      stage !== "finished") ||
    (mode !== "rehearsal" && mode !== "live") ||
    !count(slideCount, 2000) ||
    !count(index, Math.max(0, slideCount - 1)) ||
    !finite(durationMs) ||
    durationMs < 0
  )
    return null;
  const session: LiveSession = { type: "session", stage, mode, index, slideCount, durationMs };
  if (message.id !== undefined) {
    if (typeof message.id !== "string" || message.id.length > 100) return null;
    session.id = message.id;
  }
  if (message.overlayEnabled !== undefined) {
    if (typeof message.overlayEnabled !== "boolean") return null;
    session.overlayEnabled = message.overlayEnabled;
  }
  if (message.overlayDisplayId !== undefined) {
    if (message.overlayDisplayId !== null && !Number.isInteger(message.overlayDisplayId)) return null;
    session.overlayDisplayId = message.overlayDisplayId as number | null;
  }
  return session;
}

function parseDisplays(value: unknown): DisplayInfo[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const displays: DisplayInfo[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !Number.isInteger(item.id) ||
      typeof item.label !== "string" ||
      typeof item.primary !== "boolean" ||
      !finite(item.width) ||
      !finite(item.height)
    )
      return null;
    displays.push({
      id: item.id as number,
      label: item.label.slice(0, 80),
      primary: item.primary,
      width: item.width,
      height: item.height,
    });
  }
  return displays;
}

export type HubEvents = {
  onCommand?: (command: LiveCommand) => void;
  onSession?: (session: LiveSession) => void;
};

/**
 * WebSocket /live. The speaker tab publishes frame, command and session; the
 * notch page draws them; the Electron shell follows overlay messages; the
 * bridge publishes target after every step.
 */
export class LiveHub {
  overlay: OverlayState = { type: "overlay", visible: false, displayId: null };
  displays: DisplayInfo[] = [];
  private locked = false;
  private session: LiveSession | null = null;
  private owner: WebSocket | null = null;
  private dismissed = false;
  private lastSession = 0;
  private watchdog: ReturnType<typeof setInterval>;
  private server = new WebSocketServer({
    noServer: true,
    maxPayload: 512 * 1024,
  });
  private clients = new Map<WebSocket, Role>();
  private allowOrigin: (origin: string | undefined) => boolean;
  private events: HubEvents;

  constructor(
    allowOrigin: (origin: string | undefined) => boolean,
    events: HubEvents = {},
  ) {
    this.allowOrigin = allowOrigin;
    this.events = events;
    this.watchdog = setInterval(() => {
      if (this.session?.overlayEnabled !== undefined && this.overlay.visible && Date.now() - this.lastSession > 5000)
        this.updateOverlay(false, this.overlay.displayId);
    }, 1000);
    this.watchdog.unref();
  }

  /** Accepts /live?role=… from allowed origins only; a foreign page is refused. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const role = url.searchParams.get("role") as Role | null;
    if (
      url.pathname !== "/live" ||
      !role ||
      !roles.includes(role) ||
      !this.allowOrigin(req.headers.origin)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    this.server.handleUpgrade(req, socket, head, (ws) => this.join(ws, role));
  }

  online(role: Role) {
    for (const value of this.clients.values()) if (value === role) return true;
    return false;
  }

  broadcast(
    message: { type: string; [field: string]: unknown },
    only?: readonly Role[],
  ) {
    const data = JSON.stringify(message);
    for (const [ws, role] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (only && !only.includes(role)) continue;
      // A stalled client drops frames instead of buffering them without bound.
      if (message.type === "frame" && ws.bufferedAmount > 256 * 1024) continue;
      ws.send(data);
    }
  }

  setOverlay(visible: boolean, displayId: number | null) {
    this.dismissed = !visible;
    // A closed or disabled session cannot leave a stale floating window.
    if (this.session?.overlayEnabled !== undefined &&
        (!this.session.overlayEnabled || !["running", "paused"].includes(this.session.stage))) visible = false;
    return this.updateOverlay(visible, displayId);
  }

  private updateOverlay(visible: boolean, displayId: number | null) {
    if (this.overlay.visible === visible && this.overlay.displayId === displayId) return this.overlay;
    this.overlay = { type: "overlay", visible, displayId };
    this.broadcast(this.overlay);
    return this.overlay;
  }

  /** Relays a remote step to the speaker tab. False when no tab listens. */
  stepSpeaker(gesture: Step) {
    if (!this.online("speaker")) return false;
    this.broadcast({ type: "control", gesture }, ["speaker"]);
    return true;
  }

  close() {
    clearInterval(this.watchdog);
    for (const ws of this.clients.keys()) ws.terminate();
    this.clients.clear();
    this.server.close();
  }

  private join(ws: WebSocket, role: Role) {
    this.clients.set(ws, role);
    ws.send(
      JSON.stringify({
        type: "hello",
        role,
        locked: this.locked,
        session: this.session,
        overlay: this.overlay,
      }),
    );
    ws.on("message", (data, binary) => {
      if (binary) return;
      let message: unknown;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (isRecord(message)) this.receive(role, message, ws);
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      if (this.owner === ws) {
        this.owner = null;
        this.updateOverlay(false, this.overlay.displayId);
      }
    });
    ws.on("error", () => ws.terminate());
  }

  private receive(role: Role, message: Record<string, unknown>, ws: WebSocket) {
    if (role === "shell" && message.type === "displays") {
      this.displays = parseDisplays(message.displays) ?? this.displays;
      return;
    }
    // Only the speaker tab may publish; the notch and the shell just listen.
    if (role !== "speaker") return;
    if (message.type === "frame") {
      const frame = parseFrame(message);
      if (frame) this.broadcast(frame, ["overlay"]);
    } else if (message.type === "command") {
      const command = parseCommand(message);
      if (!command) return;
      this.locked = command.locked;
      this.broadcast(command, ["overlay"]);
      this.events.onCommand?.(command);
    } else if (message.type === "session") {
      const session = parseSession(message);
      if (!session) return;
      const active = session.stage === "running" || session.stage === "paused";
      // An idle second studio tab must not hide the active tab's notch.
      if (this.owner && this.owner !== ws) return;
      if (session.overlayEnabled !== undefined) {
        if (session.id !== this.session?.id || (!this.session?.overlayEnabled && session.overlayEnabled)) this.dismissed = false;
        this.owner = active ? ws : null;
        this.lastSession = Date.now();
        this.updateOverlay(active && session.overlayEnabled && !this.dismissed, session.overlayDisplayId ?? null);
      }
      this.session = session;
      this.broadcast(session, ["overlay"]);
      this.events.onSession?.(session);
    }
  }
}
