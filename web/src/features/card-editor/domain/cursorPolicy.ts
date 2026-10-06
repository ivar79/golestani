/**
 * Cursor policy for the per-layer hit areas.
 *
 * The stage paints a transparent box over EVERY layer and lets that box be the
 * pointer target. That box is the layer's BOUNDING rectangle, not its ink, so
 * the cursor has to answer one question honestly: "what will pressing here
 * actually do?" A `move` cursor is a promise, and the stage used to break that
 * promise over the whole box of a node-edited path — pressing there starts a
 * node marquee, not a drag, so the four-headed arrow was a lie.
 *
 * Pure: no DOM, no React. Lives here (rather than in the component) so the rule
 * is testable on its own and cannot drift between the class name and the inline
 * style that actually wins.
 */

/** The tools a layer box can be under. Structurally `EditorTool`. */
export type CursorPolicyTool = "select" | "draw" | "pen";

export type LayerHitCursor = "move" | "crosshair" | "not-allowed" | "default";

/**
 * The cursor a layer's bounding-box hit area advertises.
 *
 * Priority order (first match wins):
 *   1. `draw` — the freehand brush paints over any layer, so the pen crosshair
 *      is what the gesture is.
 *   2. `locked` — a locked layer refuses the press outright.
 *   3. `editing` — THIS layer is the one being point-edited. Pressing the box
 *      starts a node marquee (or, without travel, leaves point-editing); it
 *      never drags the layer. Only Alt drags it here, and the caller passes
 *      `editing: false` when Alt is held, so the four-headed arrow is reachable
 *      exactly where it is true.
 *   4. everything else — a press really does move the layer, so `move`.
 */
export function layerHitCursor(input: {
  tool: CursorPolicyTool;
  locked: boolean;
  editing: boolean;
}): LayerHitCursor {
  if (input.tool === "draw") return "crosshair";
  if (input.locked) return "not-allowed";
  if (input.editing) return "default";
  return "move";
}