export const notchSize = { width: 220, height: 80 };

export function notchBounds(bounds: { x: number; y: number; width: number }, safeTop = 0, center?: number) {
  return {
    x: Math.round((center ?? bounds.x + bounds.width / 2) - notchSize.width / 2),
    y: Math.round(bounds.y),
    ...notchSize,
    height: notchSize.height + Math.round(safeTop),
  };
}

/** Match the renderer's 24px close button, without intercepting the avatar. */
export function overClose(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }) {
  const x = point.x - bounds.x;
  const y = point.y - bounds.y - (bounds.height - notchSize.height);
  return x >= bounds.width - 30 && x < bounds.width - 6 && y >= 6 && y < 30;
}
