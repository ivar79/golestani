/**
 * Gesture thresholds — the ONE place the click↔drag distinction is decided.
 *
 * Contract (Figma/Illustrator-like):
 *   - a press that never crosses the threshold is a CLICK
 *   - a press that crosses it becomes a DRAG
 *
 * Two gestures share it, and they must share it:
 *   - the pen: a click leaves a CORNER anchor (no handles); a drag pulls two
 *     mirrored handles out of the anchor (a smooth point)
 *   - the node marquee: a click on the edited layer's box leaves point-editing
 *     (the layer stays selected); a drag rubber-bands nodes
 *
 * Pure: no DOM, no React. The threshold is measured in SCREEN pixels, so a
 * zoomed artboard needs less artboard-space movement to count as a drag — the
 * gesture feels identical at every zoom level.
 */

/**
 * Minimum SCREEN-space pointer travel before a press is a DRAG rather than a
 * click. Smaller movement = click.
 *
 * One threshold for the whole editor: the pen (corner anchor vs. handle drag)
 * and the node marquee (click vs. rubber band) must agree, otherwise the same
 * gesture costs different amounts of hand movement depending on which tool
 * happened to be active.
 */
export const CLICK_DRAG_THRESHOLD_PX = 3;

/** @deprecated kept as the pen's own name for {@link CLICK_DRAG_THRESHOLD_PX}. */
export const PEN_DRAG_THRESHOLD_PX = CLICK_DRAG_THRESHOLD_PX;

/**
 * True once the pointer has travelled more than `CLICK_DRAG_THRESHOLD_PX`
 * SCREEN pixels away from where the press went down.
 *
 * @param start   pointer position (artboard coordinates) at pointerdown
 * @param current pointer position (artboard coordinates) now
 * @param zoom    stage zoom (artboard px → screen px)
 */
export function exceedsClickThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
  zoom: number,
): boolean {
  const zoomFactor = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const screenDistance = Math.hypot(current.x - start.x, current.y - start.y) * zoomFactor;
  return screenDistance > CLICK_DRAG_THRESHOLD_PX;
}

/**
 * True once the pointer has travelled more than the threshold away from where
 * the pen click went down.
 */
export function shouldBeginHandleDrag(
  start: { x: number; y: number },
  current: { x: number; y: number },
  zoom: number,
): boolean {
  return exceedsClickThreshold(start, current, zoom);
}
