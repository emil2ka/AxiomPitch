import { motion, useReducedMotion } from "motion/react";
import type { Gesture } from "../lib/types";

/** The companion demonstrates gestures with its own floating hands. */
export function TeachingCompanion({ gesture, playing = true }: { gesture: Gesture | null; playing?: boolean }) {
  const reduced = !!useReducedMotion();
  const moving = playing && !reduced;
  const hold = gesture === "toggle";
  const transition = { duration: 4.6, times: [0, .2, .5, .73, 1], repeat: Infinity, ease: "easeInOut" as const };
  const caption = hold ? "Замри на 1,5 секунды" : gesture === "previous" ? "← Ладонь влево" : gesture === "next" ? "Ладонь вправо →" : "Ладонь к камере";
  return <div className="teaching-companion" role="img" aria-label={`Компаньон показывает жест: ${caption}`}>
    <svg viewBox="0 0 300 190" aria-hidden="true">
      <image href="/companion/teaching/body.png" x="60" y="0" width="180" height="180" />
      {([-1, 1] as const).map(side => {
        const active = gesture === "previous" ? side === -1 : side === 1;
        const x = moving && active && !hold && gesture ? [-side * 30, -side * 30, side * 12, side * 12, -side * 30] : [0, 0, 0, 0, 0];
        const y = moving && active && hold ? [10, 0, 0, 0, 10] : [0, 0, 0, 0, 0];
        const wrist = 150 + side * 78;
        return <g key={side}>
          <motion.g animate={{x: moving ? x : 0, y: moving ? y : 0}} transition={transition}>
            <image href={`/companion/teaching/hand-${side < 0 ? "left" : "right"}.png`} x={wrist - 35} y="69" width="70" height="70" />
          </motion.g>
        </g>;
      })}
      {hold && <g transform="translate(265 148)"><circle r="15" fill="none" stroke="#ffffff16" strokeWidth="2" /><motion.circle r="15" fill="none" stroke="#b8bdc6" strokeWidth="2" strokeLinecap="round" style={{rotate:-90}} animate={{pathLength:moving ? [0,0,1,1,0] : .6}} transition={transition} /></g>}
    </svg>
    <span>{caption}</span>
  </div>;
}
