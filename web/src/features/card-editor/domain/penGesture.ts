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

import { constrainToAngle } from "./pathOps";

/**
 * Angle grid (degrees) the pen locks onto while Shift is held.
 *
 * One increment already covers every direction a card layout needs: 0/180
 * (horizontal), ±45 (diagonals), ±90 (vertical), ±135. Illustrator and
 * Photoshop both document Shift on the Pen tool as "constrain the angle of the
 * segment to a multiple of 45°"; Figma documents no such modifier, so this is a
 * grid we own and can widen later (the freehand constrained mode offers
 * 15/30/45/90 presets through the same maths).
 */
export const PEN_ANGLE_SNAP_DEGREES = 45;

/**
 * Lock a pen point onto the angle grid measured FROM `from`.
 *
 * Two deliberate differences from the freehand constrained mode:
 *   - Shift is an explicit command, so EVERY direction lands on the grid. That
 *     is what the tolerance of half a step achieves: the farthest a raw angle
 *     can be from its nearest grid direction is exactly half an increment.
 *   - the pointer's DISTANCE is preserved, so the lock rotates the segment
 *     instead of shortening it (drifting towards the anchor would silently move
 *     the point the user asked for).
 *
 * Returns `to` untouched when the lock is off or when any input is non-finite,
 * so a broken coordinate can never be turned into NaN geometry.
 */
export function constrainPenPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  locked: boolean,
  increments: number[] = [PEN_ANGLE_SNAP_DEGREES],
): { x: number; y: number } {
  if (!locked) return { x: to.x, y: to.y };
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return { x: to.x, y: to.y };
  const usable = increments.filter((inc) => Number.isFinite(inc) && inc > 0);
  if (usable.length === 0) return { x: to.x, y: to.y };
  const snapped = constrainToAngle(from, to, {
    increments: usable,
    tolerance: Math.min(...usable) / 2,
    // The grid already contains 0°/90°, so the coarse axis lock would only
    // pre-empt the grid's own answer at a different distance.
    axisLock: false,
  });
  return { x: snapped.x, y: snapped.y };
}

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
