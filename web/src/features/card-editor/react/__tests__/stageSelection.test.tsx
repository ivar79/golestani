// @vitest-environment jsdom
/**
 * POINT-EDIT MODE MUST NOT EAT THE MOUSE.
 *
 * The stage used to hand EVERY press inside point-editing to a node marquee —
 * on the edited layer's own box and on empty canvas alike — so the path you
 * were editing could never be re-selected as a LAYER. The inspector, the delete
 * button and the transform handles were unreachable by mouse, and a plain click
 * only produced a zero-size rubber band.
 *
 * The contract under test (Figma / Illustrator: point-editing is a sub-mode OF a
 * selection, not a replacement for it):
 *   - press WITHOUT travel on the edited layer's box → leaves point-editing and
 *     KEEPS the layer selected
 *   - press WITHOUT travel on empty canvas → leaves point-editing AND deselects
 *   - press WITH travel → rubber-bands nodes, exactly as before
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EditorStage } from "../EditorStage";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../../domain/document";

beforeEach(() => {
  // jsdom has no ResizeObserver; the stage fits itself to the container width.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pathLayer(): PathLayer {
  return {
    id: "line",
    kind: "path",
    pathMode: "curve",
    x: 0,
    y: 0,
    width: 500,
    height: 200,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: null,
    closed: false,
    points: [
      { x: 10, y: 50, hIn: null, hOut: null },
      { x: 250, y: 100, hIn: null, hOut: null },
      { x: 490, y: 50, hIn: null, hOut: null },
    ],
    stroke: "#0ea5e9",
    strokeWidth: 4,
    fill: null,
  } as PathLayer;
}

function doc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [pathLayer()] };
}

/** Stage + a path already selected and already being point-edited. */
function editingStage() {
  const engine = new EditorEngine(doc());
  engine.select("line");
  engine.setPathEditing("line");
  const rendered = render(<EditorStage engine={engine} doc={engine.getState().doc} />);
  const box = rendered.container.querySelector('[role="button"][aria-label="لایه path"]');
  const canvas = rendered.container.querySelector("[data-stage-inner]");
  if (!box || !canvas) throw new Error("expected the layer box and the artboard");
  return { engine, box, canvas };
}

/**
 * Real pointer events with real coordinates.
 *
 * jsdom has no `PointerEvent`, and testing-library then dispatches a bare `Event`
 * that carries NO clientX/clientY — the gesture would silently aim at (0,0).
 * A MouseEvent has everything the stage reads (clientX/Y, buttons, altKey).
 */
function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { clientX: number; clientY: number; buttons?: number; altKey?: boolean },
) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

describe("EditorStage — leaving point-editing with the mouse", () => {
  it("a click on the edited layer's box keeps the layer selected", () => {
    const { engine, box } = editingStage();
    expect(engine.getState().editingPathId).toBe("line");

    firePointer(box, "pointerdown", { clientX: 200, clientY: 120 });
    firePointer(box, "pointerup", { clientX: 200, clientY: 120 });

    const state = engine.getState();
    expect(state.editingPathId).toBeNull();
    // The whole point: the layer is now selected, so the inspector, delete and
    // transform handles are reachable without another click.
    expect(state.selection.layerId).toBe("line");
  });

  it("a click on empty canvas leaves the mode AND drops the selection", () => {
    const { engine, canvas } = editingStage();

    firePointer(canvas, "pointerdown", { clientX: 700, clientY: 480 });
    firePointer(canvas, "pointerup", { clientX: 700, clientY: 480 });

    const state = engine.getState();
    expect(state.editingPathId).toBeNull();
    expect(state.selection.layerId).toBeNull();
  });

  it("a real drag still rubber-bands nodes and stays in the mode", () => {
    const { engine, canvas } = editingStage();

    firePointer(canvas, "pointerdown", { clientX: 0, clientY: 0, buttons: 1 });
    firePointer(canvas, "pointermove", { clientX: 300, clientY: 200, buttons: 1 });
    firePointer(canvas, "pointerup", { clientX: 300, clientY: 200 });

    // The regression to guard: the drag must NOT be read as a click.
    expect(engine.getState().editingPathId).toBe("line");
    // The band caught the anchors it covers (rect from 0,0 to 300,200).
    expect(engine.getState().anchorSelection.length).toBeGreaterThan(0);
  });

  it("a small wobble inside the click threshold is still a click, not a marquee", () => {
    const { engine, box } = editingStage();

    firePointer(box, "pointerdown", { clientX: 200, clientY: 120 });
    firePointer(box, "pointermove", { clientX: 201, clientY: 120 });
    firePointer(box, "pointerup", { clientX: 201, clientY: 120 });

    // Hand tremor must not silently turn "select the layer" into "marquee nodes".
    expect(engine.getState().editingPathId).toBeNull();
    expect(engine.getState().selection.layerId).toBe("line");
  });

  it("Alt still drags the whole layer from inside the mode (no marquee)", () => {
    const { engine, box } = editingStage();

    firePointer(box, "pointerdown", { clientX: 200, clientY: 120, altKey: true });
    firePointer(box, "pointermove", { clientX: 260, clientY: 150, buttons: 1 });
    firePointer(box, "pointerup", { clientX: 260, clientY: 150 });

    // Alt falls through to the layer move, so the mode is untouched and the
    // layer actually travelled.
    expect(engine.getState().editingPathId).toBe("line");
    expect(engine.getState().doc.layers[0].x).toBeGreaterThan(0);
  });
});

describe("EditorStage — cursor honesty over the layer box", () => {
  it("shows the neutral arrow on the box being point-edited, and `move` with Alt", async () => {
    const { box } = editingStage();

    expect((box as HTMLElement).style.cursor).toBe("default");

    window.dispatchEvent(new KeyboardEvent("keydown", { altKey: true }));
    // The hook re-renders on a state update; let it flush.
    await Promise.resolve();
    fireEvent(window, new KeyboardEvent("keydown", { altKey: true }));
    expect((box as HTMLElement).style.cursor).toBe("move");
  });

  it("shows `move` on an ordinary layer box", () => {
    const engine = new EditorEngine(doc());
    engine.select("line");
    const { container } = render(<EditorStage engine={engine} doc={engine.getState().doc} />);
    const box = container.querySelector('[role="button"][aria-label="لایه path"]') as HTMLElement;
    expect(box.style.cursor).toBe("move");
  });
});