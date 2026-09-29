/**
 * Pen gesture threshold — the ONE place the click↔drag distinction is decided.
 *
 * Contract (Figma/Illustrator-like):
 *   - a click that never crosses the threshold leaves a CORNER anchor (no
 *     handles)
 *   - a click that crosses it becomes a handle DRAG and pulls two mirrored
 *     handles out of the anchor (a smooth point)
 *
 * Pure: no DOM, no React. The threshold is measured in SCREEN pixels, so a
 * zoomed artboard needs less artboard-space movement to count as a drag — the
 * gesture feels identical at every zoom level.
 */

/**
 * Minimum SCREEN-space pointer travel before a pen click turns into a
 * handle drag. Smaller movement = click (corner anchor).
 */
export const PEN_DRAG_THRESHOLD_PX = 3;

/**
 * True once the pointer has travelled more than `PEN_DRAG_THRESHOLD_PX`
 * SCREEN pixels away from where the pen click went down.
 *
 * @param start   pointer position (artboard coordinates) at pointerdown
 * @param current pointer position (artboard coordinates) now
 * @param zoom    stage zoom (artboard px → screen px)
 */
export function shouldBeginHandleDrag(
  start: { x: number; y: number },
  current: { x: number; y: number },
  zoom: number,
): boolean {
  const zoomFactor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const screenDistance = Math.hypot(current.x - start.x, current.y - start.y) * zoomFactor;
  return screenDistance > PEN_DRAG_THRESHOLD_PX;
}
