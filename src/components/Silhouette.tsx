import { forwardRef, useImperativeHandle, useRef } from "react";
import type { VisionFrame } from "../lib/types";

export type SilhouetteHandle = {
  draw: (frame: VisionFrame) => void;
  clear: () => void;
};
export const Silhouette = forwardRef<SilhouetteHandle>(
  function Silhouette(_, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const scratch = useRef<HTMLCanvasElement | null>(null);
    const previousY = useRef(0);
    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          const canvas = canvasRef.current;
          if (canvas)
            canvas
              .getContext("2d")
              ?.clearRect(0, 0, canvas.width, canvas.height);
        },
        draw: (frame) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d")!;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (!frame.mask) return;
          scratch.current ??= document.createElement("canvas");
          const off = scratch.current;
          const { width, height, pixels } = frame.mask;
          off.width = width;
          off.height = height;
          off
            .getContext("2d")!
            .putImageData(
              new ImageData(new Uint8ClampedArray(pixels), width, height),
              0,
              0,
            );
          const targetY = Math.max(0, (frame.pose[0]?.y ?? 0.2) - 0.18);
          previousY.current = previousY.current * 0.8 + targetY * 0.2;
          const shoulderY =
            ((frame.pose[11]?.y ?? 0.5) + (frame.pose[12]?.y ?? 0.5)) / 2;
          const shoulderSpan = Math.abs(
            (frame.pose[11]?.x ?? 0.35) - (frame.pose[12]?.x ?? 0.65),
          );
          const bottom = Math.min(
            1,
            shoulderY + Math.max(0.12, shoulderSpan * 0.65),
          );
          const cropH = Math.max(0.2, bottom - previousY.current);
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.shadowColor = "#1776ff";
          ctx.shadowBlur = 5;
          ctx.drawImage(
            off,
            0,
            previousY.current * height,
            width,
            cropH * height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          ctx.restore();
        },
      }),
      [],
    );
    return (
      <canvas
        ref={canvasRef}
        width={600}
        height={240}
        className="silhouette"
        role="img"
        aria-label="Живой синий силуэт головы, плеч и рук с камеры"
      />
    );
  },
);
