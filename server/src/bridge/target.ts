/** Apps the bridge can drive. The speaker tab still decides every gesture. */
export type TargetId =
  | "pitchflow"
  | "keynote"
  | "powerpoint"
  | "chrome"
  | "frontmost";
export const targetIds: readonly TargetId[] = [
  "pitchflow",
  "keynote",
  "powerpoint",
  "chrome",
  "frontmost",
];

/** Zero-based position reported by the app itself. Never an estimate. */
export type SlideState = { slideIndex: number; slideCount: number };

export type ConnectOptions = { process?: string };

export interface Target {
  readonly id: TargetId;
  readonly label: string;
  /** Whether the app can be driven right now (running, show open, etc.). */
  available(): Promise<boolean>;
  connect(options?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  /** null when the app does not expose a reliable slide number. */
  readState(): Promise<SlideState | null>;
}

/** A refusal the speaker should read as is, e.g. "show is not running". */
export class TargetError extends Error {
  name = "TargetError";
}

/** Parses "3/12" (one-based, as apps report it) into a zero-based state. */
export function parseSlidePosition(text: string): SlideState | null {
  const match = /^(\d+)\/(\d+)$/.exec(text.trim());
  if (!match) return null;
  const number = Number(match[1]);
  const count = Number(match[2]);
  if (count < 1 || number < 1 || number > count) return null;
  return { slideIndex: number - 1, slideCount: count };
}
