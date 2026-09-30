import { GestureEngine, isOpenPalm, isVisibleHand, releasedPalm } from "./gestures.ts";
import type { Feedback, Gesture, Point, VisionFrame } from "./types.ts";

export const lessons = [
  { label: "Знакомство", title: "Привет. Начнём\nс тебя.", description: "Покажи открытую ладонь. Голова и плечи для управления не нужны.", cue: "Покажи открытую ладонь", motion: "hello", expected: null },
  { label: "Вперёд", title: "Одно движение.\nСледующий слайд.", description: "Раскрой ладонь перед камерой. Проведи её вправо одним плавным движением.", cue: "Ладонь вправо →", motion: "next", expected: "next" },
  { label: "Назад", title: "Вернуться?\nТак же просто.", description: "Подними открытую ладонь и проведи влево. Направление совпадает с тем, что ты видишь в зеркальном превью.", cue: "← Ладонь влево", motion: "previous", expected: "previous" },
  { label: "Свобода рук", title: "Говори свободно.\nСлайды подождут.", description: "Подними открытую ладонь и замри на 1,5 секунды. Жесты выключатся — можно двигать руками во время рассказа.", cue: "Ладонь неподвижно · 1,5 сек.", motion: "hold", expected: "toggle" },
  { label: "Снова в деле", title: "Верни управление.\nОдной ладонью.", description: "Снова раскрой ладонь и удержи 1,5 секунды. Жесты включатся обратно.", cue: "Раскрой → удержи", motion: "hold", expected: "toggle" },
  { label: "Твой мини-питч", title: "Теперь\nв твоём ритме.", description: "Попробуй небольшую последовательность: два слайда вперёд, один назад. Руку можно оставлять в кадре: возврат в центр не считается. Чтобы вернуться, проведи влево дальше центра.", cue: "Вперёд → вперёд → назад", motion: "idle", expected: null },
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
/** A stationary palm should not teach a hold during a swipe exercise. */
export function practiceFeedback(step: number, sequence: number, feedback: Feedback): Feedback {
  const expected = expectedGesture(step, sequence);
  if ((feedback.kind === "progress" && feedback.progressGesture !== expected) ||
      (feedback.kind === "success" && feedback.gesture !== expected))
    return { kind: "idle", message: expected === "next"
      ? "Ладонь вижу. Теперь проведи её вправо →"
      : expected === "previous" ? "Ладонь вижу. Теперь проведи её влево ←"
      : "Держи открытую ладонь неподвижно 1,5 секунды." };
  return feedback;
}

type PracticeHand = { engine: GestureEngine; x: number; y: number; label: string; seen: number };
/** Each visible hand uses the presentation recognizer, with only the lesson's
 * command enabled. A still second palm cannot hide the one doing the exercise. */
export class LearningGestureEngine {
  private hands: PracticeHand[] = [];
  private sensitivity = .85;
  reset() { this.hands = []; }
  setSensitivity(value: number) {
    this.sensitivity = value;
    this.hands.forEach(hand => hand.engine.setSensitivity(value));
  }
  update(frame: VisionFrame, expected: Gesture, locked: boolean): Feedback {
    const candidates = frame.hands.flatMap((points, i) => isVisibleHand(points)
      ? [{ points, x: points[9].x, y: points[9].y,
        label: (frame.handScores?.[i] ?? 1) >= .65 ? frame.handLabels?.[i] ?? "" : "" }]
      : []);
    // Duplicate/uncertain handedness must fall back to spatial continuity.
    const duplicateLabels = new Set(candidates.filter(candidate => candidate.label && candidates.filter(hand => hand.label === candidate.label).length > 1).map(candidate => candidate.label));
    for (const candidate of candidates)
      if (duplicateLabels.has(candidate.label)) candidate.label = "";
    this.hands = this.hands.filter(hand => frame.time - hand.seen <= 10000);
    const available = new Set(this.hands);
    const results: Feedback[] = [];
    for (const candidate of candidates) {
      const labelled = candidate.label && [...available].find(hand => hand.label === candidate.label);
      const nearest = [...available].sort((a, b) =>
        Math.hypot(a.x - candidate.x, a.y - candidate.y) - Math.hypot(b.x - candidate.x, b.y - candidate.y))[0];
      let tracked = labelled || (nearest && ((candidates.length === 1 && available.size === 1) || Math.hypot(nearest.x - candidate.x, nearest.y - candidate.y) < .35) ? nearest : null);
      if (!tracked) {
        tracked = { engine: new GestureEngine(), x: candidate.x, y: candidate.y, label: candidate.label, seen: frame.time };
        tracked.engine.setSensitivity(this.sensitivity);
        this.hands.push(tracked);
      }
      available.delete(tracked);
      tracked.x = candidate.x; tracked.y = candidate.y; tracked.seen = frame.time;
      if (candidate.label) tracked.label = candidate.label;
      results.push(tracked.engine.update(frame.pose, [candidate.points], frame.time, locked, frame.aspect, [expected]));
    }
    for (const missing of available) missing.engine.update(frame.pose, [], frame.time, locked, frame.aspect, [expected]);
    // Advance at most once per camera frame even if both hands complete it.
    return results.find(result => result.kind === "success")
      ?? results.filter(result => result.kind === "progress" && result.progressGesture === expected).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0]
      ?? results.find(result => result.kind === "error")
      ?? results.find(result => result.message !== "Покажи открытую ладонь камере")
      ?? { kind: "idle", message: "Покажи открытую ладонь целиком" };
  }
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
