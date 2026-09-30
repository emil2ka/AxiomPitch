import type { Feedback } from "./types.ts";

/** A sandbox: commands verify recognition without touching the real deck. */
export type Preflight = {
  index: number;
  next: boolean;
  previous: boolean;
  lock: boolean;
  unlock: boolean;
  hand: boolean;
};
export function newPreflight(): Preflight {
  return { index: 1, next: false, previous: false, lock: false, unlock: false, hand: false };
}
export function recordPreflight(state: Preflight, feedback: Feedback, locked: boolean): Preflight {
  if (feedback.kind !== "success" || !feedback.gesture) return state;
  switch (feedback.gesture) {
    case "next": return { ...state, next: true, index: Math.min(2, state.index + 1) };
    case "previous": return { ...state, previous: true, index: Math.max(0, state.index - 1) };
    case "toggle": return { ...state, [locked ? "lock" : "unlock"]: true };
  }
}
