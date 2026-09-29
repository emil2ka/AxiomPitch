import { isOpenPalm, isVisibleHand, releasedPalm } from "./gestures.ts";
import type { Gesture, Point } from "./types.ts";

export const lessons = [
  { label: "Знакомство", title: "Привет. Начнём\nс тебя.", description: "Покажи открытую ладонь. Голова и плечи для управления не нужны.", cue: "Покажи открытую ладонь", motion: "hello", expected: null },
  { label: "Вперёд", title: "Одно движение.\nСледующий слайд.", description: "Раскрой ладонь перед камерой. Проведи её вправо одним плавным движением.", cue: "Ладонь вправо →", motion: "next", expected: "next" },
  { label: "Назад", title: "Вернуться?\nТак же просто.", description: "Подними открытую ладонь и проведи влево. Направление совпадает с тем, что ты видишь в зеркальном превью.", cue: "← Ладонь влево", motion: "previous", expected: "previous" },
  { label: "Свобода рук", title: "Говори свободно.\nСлайды подождут.", description: "Подними открытую ладонь и замри на 1,5 секунды. Жесты выключатся — можно двигать руками во время рассказа.", cue: "Ладонь неподвижно · 1,5 сек.", motion: "hold", expected: "toggle" },
  { label: "Снова в деле", title: "Верни управление.\nОдной ладонью.", description: "Снова раскрой ладонь и удержи 1,5 секунды. Жесты включатся обратно.", cue: "Раскрой → удержи", motion: "hold", expected: "toggle" },
  { label: "Твой мини-питч", title: "Теперь\nв твоём ритме.", description: "Попробуй небольшую последовательность: два слайда вперёд, один назад. Руку можно оставлять в кадре.", cue: "Вперёд → вперёд → назад", motion: "idle", expected: null },
  { label: "Готово", title: "Твоя сцена\nждёт тебя.", description: "Движения знакомы. Возвращайся в студию, загружай презентацию и рассказывай свою историю.", cue: "Дальше — твой выход", motion: "success", expected: null },
] as const;

export type Practice = { passed: boolean; locked: boolean; slide: number; sequence: number };
export const miniSequence: Gesture[] = ["next", "next", "previous"];
export function createPractice(step: number): Practice {
  return { passed: false, locked: step === 4, slide: step === 2 ? 1 : 0, sequence: 0 };
}
export function expectedGesture(step: number, sequence: number): Gesture | null {
  return step === 5 ? (miniSequence[sequence] ?? null) : (lessons[step]?.expected ?? null);
}
export function applyPracticeGesture(step: number, state: Practice, gesture: Gesture): Practice {
  if (state.passed || gesture !== expectedGesture(step, state.sequence)) return state;
  const sequence = state.sequence + 1;
  return {
    sequence,
    locked: gesture === "toggle" ? !state.locked : state.locked,
    slide: gesture === "toggle" ? state.slide : Math.max(0, Math.min(2, state.slide + (gesture === "next" ? 1 : -1))),
    passed: step !== 5 || sequence === miniSequence.length,
  };
}
export function goodLearningHands(hands: Point[][]): boolean {
  return hands.some(isOpenPalm);
}

export type AdvanceGate = { completedAt: number; releasedAt: number | null; releaseY?: number };
/** Advance from observed hands; the body/face is irrelevant to hand commands. */
export function advanceAfterSuccess(gate: AdvanceGate, hands: Point[][], time: number, needsRelease = true) {
  const visible = hands.filter(isVisibleHand);
  if (!visible.length) return { gate: { ...gate, releasedAt: null }, ready: false };
  const releasedAt = needsRelease && !releasedPalm(visible, gate.releaseY) ? null : gate.releasedAt ?? time;
  return {
    gate: { ...gate, releasedAt },
    ready: time - gate.completedAt >= 1000 && releasedAt !== null && time - releasedAt >= 300,
  };
}
