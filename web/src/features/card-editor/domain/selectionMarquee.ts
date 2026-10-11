import type { CardLayer } from "./document";

export type MarqueePoint = { x: number; y: number };

/**
 * Whole-layer canvas selection, following the common Figma-style marquee rule:
 * left-to-right selects fully contained layers; right-to-left selects layers
 * whose (rotation-aware) bounds intersect the rectangle.
 *
 * Hidden layers are not rendered, and locked layers cannot be manipulated from
 * the canvas, so neither is added by this gesture.
 */
export function selectLayerIdsByMarquee(
  layers: readonly CardLayer[],
  start: MarqueePoint,
  end: MarqueePoint,
): string[] {
  const rect = {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  };
  const requireContainment = end.x >= start.x;

  return layers.filter((layer) => {
    if (layer.hidden || layer.locked) return false;

    const angle = ((layer.angle ?? 0) * Math.PI) / 180;
    const halfWidth =
      Math.abs(Math.cos(angle)) * layer.width / 2 +
      Math.abs(Math.sin(angle)) * layer.height / 2;
    const halfHeight =
      Math.abs(Math.sin(angle)) * layer.width / 2 +
      Math.abs(Math.cos(angle)) * layer.height / 2;
    const centerX = layer.x + layer.width / 2;
    const centerY = layer.y + layer.height / 2;
    const bounds = {
      left: centerX - halfWidth,
      right: centerX + halfWidth,
      top: centerY - halfHeight,
      bottom: centerY + halfHeight,
    };

    if (requireContainment) {
      return bounds.left >= rect.left && bounds.right <= rect.right &&
        bounds.top >= rect.top && bounds.bottom <= rect.bottom;
    }
    return bounds.right >= rect.left && bounds.left <= rect.right &&
      bounds.bottom >= rect.top && bounds.top <= rect.bottom;
  }).map((layer) => layer.id);
}
