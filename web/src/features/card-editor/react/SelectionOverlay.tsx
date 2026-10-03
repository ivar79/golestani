"use client";

/**
 * SelectionOverlay — the transform UI for the selected layer OR the selected
 * group.
 *
 * Rendered INSIDE the artboard-local coordinate space as an absolutely
 * positioned box, so the 8 resize handles and the rotation handle follow the
 * frame's rotation for free (no matrix math in React — the CSS rotate transform
 * does it). All gestures are TRANSIENT: they update the engine without history,
 * and pointerUp commits ONE record.
 *
 * Two modes, ONE implementation:
 *   - single layer: the layer's own frame (rotates with it)
 *   - group (≥2 layers): the DERIVED bounding box of the selection. The box is
 *     never stored — it comes from `EditorEngine.selectionBounds()`.
 */

import { memo } from "react";
import type { CSSProperties } from "react";
import type { CardLayer } from "../domain/document";
import type { ResizeHandle } from "../engine/EditorEngine";

const HANDLE_SIZE = 10;
const HANDLE_CLASS =
  "absolute h-2.5 w-2.5 rounded-full border border-cyan-200/90 bg-[#07111d] shadow-[0_0_0_2px_rgba(34,211,238,0.12),0_2px_8px_rgba(0,0,0,0.45)] pointer-events-auto touch-none";

const HANDLE_POSITIONS: Record<ResizeHandle, CSSProperties> = {
  n: { top: -HANDLE_SIZE / 2, left: "50%", marginLeft: -HANDLE_SIZE / 2, cursor: "ns-resize" },
  s: { bottom: -HANDLE_SIZE / 2, left: "50%", marginLeft: -HANDLE_SIZE / 2, cursor: "ns-resize" },
  e: { right: -HANDLE_SIZE / 2, top: "50%", marginTop: -HANDLE_SIZE / 2, cursor: "ew-resize" },
  w: { left: -HANDLE_SIZE / 2, top: "50%", marginTop: -HANDLE_SIZE / 2, cursor: "ew-resize" },
  ne: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2, cursor: "nesw-resize" },
  nw: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2, cursor: "nwse-resize" },
  se: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2, cursor: "nwse-resize" },
  sw: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2, cursor: "nesw-resize" },
};

const HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

type Frame = { x: number; y: number; width: number; height: number; angle: number; locked: boolean };

type Props = {
  /** Single-layer mode: the selected layer's own frame. */
  layer?: CardLayer | null;
  /** Group mode: the derived selection bounds (wins over `layer`). */
  bounds?: { x: number; y: number; width: number; height: number } | null;
  /** Marks the frame as a group so the UI can label/space it differently. */
  group?: boolean;
  /** Hide handles and rotation — only show the bounding outline. */
  minimal?: boolean;
  onHandlePointerDown: (handle: ResizeHandle, event: React.PointerEvent) => void;
  onRotatePointerDown: (event: React.PointerEvent) => void;
};

function SelectionOverlayImpl({ layer, bounds, group = false, minimal = false, onHandlePointerDown, onRotatePointerDown }: Props) {
  const frame: Frame | null = bounds
    ? { ...bounds, angle: 0, locked: false }
    : layer
      ? { x: layer.x, y: layer.y, width: layer.width, height: layer.height, angle: layer.angle ?? 0, locked: layer.locked }
      : null;

  if (!frame) return null;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        transform: frame.angle ? `rotate(${frame.angle}deg)` : undefined,
        zIndex: group ? 1190 : 1200,
      }}
    >
      {/* Selection border — dashed for a group so it reads as derived, not a layer */}
      <div
        data-selection-frame={group ? "group" : "layer"}
        className={`pointer-events-none absolute inset-0 border border-cyan-300/80 ${group ? "border-dashed" : ""}`}
      />

      {/* Resize handles */}
      {frame.locked || minimal
        ? null
        : HANDLES.map((handle) => (
            <div
              key={handle}
              role="button"
              aria-label={`تغییر اندازه ${handle}`}
              className={HANDLE_CLASS}
              style={HANDLE_POSITIONS[handle]}
              onPointerDown={(event) => onHandlePointerDown(handle, event)}
            />
          ))}

      {/* Rotation handle — sits above the top edge on a short stem */}
{frame.locked || minimal ? null : (
        <>
          <div
            className="pointer-events-none absolute left-1/2 bg-cyan-300/70"
            style={{ top: -26, width: 1, height: 18, marginLeft: -0.5 }}
          />
          <div
            role="button"
            aria-label="چرخش"
            className="pointer-events-auto absolute h-3 w-3 cursor-grab rounded-full border border-cyan-200 bg-[#07111d] shadow-[0_0_0_3px_rgba(34,211,238,0.08)] touch-none"
            style={{ top: -33, left: "50%", marginLeft: -6 }}
            onPointerDown={onRotatePointerDown}
          />
        </>
      )}
    </div>
  );
}

export const SelectionOverlay = memo(SelectionOverlayImpl);
export default SelectionOverlay;
