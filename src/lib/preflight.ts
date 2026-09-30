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
export const gesturesReady = (state: Preflight) =>
  state.hand && state.next && state.previous && state.lock && state.unlock;

export type NotchChoice = "on" | "off" | null;
export function readNotchChoice(value: string | null): NotchChoice {
  return value === "on" || value === "off" ? value : null;
}
export type PreparationInput = {
  cameraStatus: "off" | "loading" | "ready" | "error";
  preflight: Preflight;
  notchChoice: NotchChoice;
  bridgeOnline: boolean;
  shellConnected: boolean;
  notchVisible: boolean;
  displayAvailable: boolean;
  workspaceReady: boolean;
  pdfLoading: boolean;
  hasSlides: boolean;
  external: boolean;
  externalReady: boolean;
};
/** Preparation is required only for the first start; gesture practice is optional. */
export function presentationReadiness(input: PreparationInput) {
  const checks = [
    { id: "presentation", label: "Презентация", done: input.workspaceReady && !input.pdfLoading && (input.external ? input.externalReady : input.hasSlides), detail: "Дождись загрузки презентации или восстанови внешний показ." },
    { id: "camera", label: "Камера и распознавание", done: input.cameraStatus === "ready", detail: input.cameraStatus === "loading" ? "Дождись готовности камеры и распознавания." : "Подключи камеру перед выступлением." },
    { id: "notch", label: input.notchChoice === "off" ? "Выступление без чёлки" : "Чёлка", done: input.notchChoice !== null && (!input.external || (input.notchChoice === "off" ? !input.notchVisible : input.bridgeOnline && input.shellConnected && input.displayAvailable)), detail: input.notchChoice === null ? "Выбери: с чёлкой или без неё." : input.notchChoice === "off" ? "Дождись, пока чёлка скроется." : !input.displayAvailable ? "Выбранный экран отключён. Выбери доступный экран." : "Для чёлки поверх внешнего приложения подключи приложение на Mac." },
  ];
  return { checks, ready: checks.every(check => check.done), reason: checks.find(check => !check.done)?.detail ?? "Всё готово к выступлению" };
}
/** Once started, slides remain usable with arrow keys even without the camera or notch. */
export function continuationReadiness(input: PreparationInput) {
  const source = presentationReadiness(input).checks[0];
  return { ready: source.done, reason: source.detail };
}
export function recordPreflight(state: Preflight, feedback: Feedback, locked: boolean): Preflight {
  if (feedback.kind !== "success" || !feedback.gesture) return state;
  switch (feedback.gesture) {
    case "next": return { ...state, next: true, index: Math.min(2, state.index + 1) };
    case "previous": return { ...state, previous: true, index: Math.max(0, state.index - 1) };
    case "toggle": return { ...state, [locked ? "lock" : "unlock"]: true };
  }
}
