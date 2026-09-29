export type Point = { x: number; y: number; z?: number; visibility?: number };
export type Gesture = "next" | "previous" | "toggle";
export type Feedback = {
  kind: "idle" | "progress" | "error" | "success";
  message: string;
  progress?: number;
  gesture?: Gesture;
  code?: string;
};
export type VisionFrame = {
  type: "frame";
  time: number;
  pose: Point[];
  hands: Point[][];
  poseWorld?: Point[];
  handWorlds?: Point[][];
  handLabels?: string[];
  handScores?: number[];
  /** Frame width / height: normalized x and y are scaled differently. */
  aspect?: number;
  duration: number;
};
export type VisionMessage =
  | VisionFrame
  | { type: "ready" }
  | { type: "error"; message: string };
export type Slide = {
  id: string;
  title: string;
  eyebrow?: string;
  body?: string;
  items?: string[];
  image?: string;
  notes: string;
};
export type SessionResult = {
  id: string;
  name: string;
  startedAt: string;
  duration: number;
  perSlide: number[];
  slideTitles: string[];
  commands: Record<Gesture, number>;
  corrections: Record<string, number>;
  mode: "rehearsal" | "live";
};
