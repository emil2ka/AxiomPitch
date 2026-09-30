export const notchSize = { width: 220, height: 80 };

export function notchBounds(bounds: { x: number; y: number; width: number }, safeTop = 0, center?: number, scale = 1) {
  return {
    x: Math.round((center ?? bounds.x + bounds.width / 2) - notchSize.width * scale / 2),
    y: Math.round(bounds.y),
    width: Math.round(notchSize.width * scale),
    height: Math.round(notchSize.height * scale + safeTop),
  };
}

/** Match the renderer's 24px close button, without intercepting the avatar. */
export function overClose(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }) {
  const scale = bounds.width / notchSize.width;
  const x = point.x - bounds.x;
  const y = point.y - bounds.y - (bounds.height - notchSize.height * scale);
  return x >= bounds.width - 30 * scale && x < bounds.width - 6 * scale && y >= 6 * scale && y < 30 * scale;
}
