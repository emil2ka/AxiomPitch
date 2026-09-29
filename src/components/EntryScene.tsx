import { useEffect, useState } from "react";
import type { PointerEvent } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { PixelCompanion } from "./PixelCompanion";
import type { CompanionAction } from "./PixelCompanion";
import { demoSlides } from "../lib/deck";

const frames = demoSlides.map((_, index) => ({
  src: `/demo-deck/slide-${index + 1}.jpg`,
}));

/** The entry scene: a live demo deck with the companion presenting it. */
export function EntryScene({ action }: { action: CompanionAction }) {
  const reduced = !!useReducedMotion();
  const [frame, setFrame] = useState(0);
  const rotateX = useSpring(useMotionValue(0), { stiffness: 120, damping: 18 });
  const rotateY = useSpring(useMotionValue(0), { stiffness: 120, damping: 18 });

  useEffect(() => {
    if (reduced || frames.length < 2) return;
    const timer = setInterval(
      () => setFrame((current) => (current + 1) % frames.length),
      3600,
    );
    return () => clearInterval(timer);
  }, [reduced]);

  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    rotateY.set(((event.clientX - rect.left) / rect.width - 0.5) * 6);
    rotateX.set((0.5 - (event.clientY - rect.top) / rect.height) * 5);
  };
  const settle = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <div className="registration-scene" aria-hidden="true">
      <motion.div
        className="registration-deck"
        style={reduced ? undefined : { rotateX, rotateY, transformPerspective: 900 }}
        onPointerMove={tilt}
        onPointerLeave={settle}
      >
        <div className="registration-slide">
          <AnimatePresence initial={false}>
            <motion.img
              key={frames[frame].src}
              src={frames[frame].src}
              alt=""
              width={1376}
              height={768}
              draggable={false}
              initial={reduced ? false : { opacity: 0, x: 26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, x: -26 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          </AnimatePresence>
        </div>
        <PixelCompanion action={action} />
        <div className="registration-dots">
          {frames.map((item, index) => (
            <button
              key={item.src}
              type="button"
              tabIndex={-1}
              className={index === frame ? "active" : ""}
              onClick={() => setFrame(index)}
              aria-label={`Слайд ${index + 1}`}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
