// @vitest-environment jsdom
/**
 * BEND ANYWHERE on the canvas — the wiring between the overlays and the engine.
 *
 * The promise under test is the user's own: put the pointer on ANY point of a
 * line, press, and that spot becomes a curved node — in both the selected-layer
 * mode (the dot follows the pointer) and point-editing mode — while Alt/Option
 * keeps the press for moving the whole layer.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../../domain/document";
import { ArcBendHandleOverlay, PathEditOverlay } from "../BezierOverlays";

afterEach(cleanup);

/** 1:1 board mapping: the test layers sit at the origin, so board == local. */
const toBoardPoint = (event: { clientX: number; clientY: number }) => ({ x: event.clientX, y: event.clientY });

/**
 * Real pointer events with real coordinates.
 *
 * jsdom has no `PointerEvent`, and testing-library then dispatches a bare `Event`
 * that carries NO clientX/clientY — a gesture test would silently aim at (0,0).
 * A MouseEvent (`buttons`, `clientX/Y`, `altKey`, `detail`) has everything the
 * overlays read, so the gesture is exercised for real.
 */
function firePointer(
  target: Window | Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { clientX: number; clientY: number; buttons?: number; button?: number; altKey?: boolean; detail?: number },
) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function pathLayer(overrides: Partial<PathLayer> = {}): PathLayer {
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
      { x: 0, y: 50, hIn: null, hOut: null },
      { x: 500, y: 50, hIn: null, hOut: null },
    ],
    stroke: "#0ea5e9",
    strokeWidth: 4,
    fill: null,
    ...overrides,
  } as PathLayer;
}

function docWith(layer: PathLayer): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [layer] };
}

function layer(engine: EditorEngine, id = "line"): PathLayer {
  const found = engine.snapshot().doc.layers.find((item) => item.id === id);
  if (!found || found.kind !== "path") throw new Error("expected a path layer");
  return found;
}

function renderEditor(engine: EditorEngine, id = "line") {
  const rendered = render(
    <PathEditOverlay
      engine={engine}
      layer={layer(engine, id)}
      zoom={1}
      selectedIndex={0}
      selectedIndices={[0]}
      rangeStartIndex={null}
      toBoardPoint={toBoardPoint}
    />,
  );
  const hit = rendered.container.querySelector("[data-bend-hit]");
  if (!hit) throw new Error("expected the bend hit path");
  return { ...rendered, hit };
}

function renderDot(engine: EditorEngine, id = "line") {
  const rendered = render(
    <ArcBendHandleOverlay engine={engine} layer={layer(engine, id)} zoom={1} toBoardPoint={toBoardPoint} />,
  );
  const hit = rendered.container.querySelector("[data-bend-hit]");
  if (!hit) throw new Error("expected the bend hit path");
  return { ...rendered, hit };
}

describe("point editor: press on the line and curve that spot", () => {
  it("previews the node under the pointer, then creates and drags it in ONE gesture", () => {
    const engine = new EditorEngine(docWith(pathLayer()));
    engine.setPathEditing("line");
    const { container, hit } = renderEditor(engine);

    // Hover: the dot sits ON the line, right where a press would plant the node.
    firePointer(hit, "pointermove", { clientX: 125, clientY: 50, buttons: 0 });
    const ghost = container.querySelector("[data-bend-dot]");
    expect(ghost?.getAttribute("data-ghost")).toBe("yes");
    expect(Number(ghost?.getAttribute("cx"))).toBeCloseTo(125, 1);

    // Press alone is intentionally lazy: it must not create a node.
    firePointer(hit, "pointerdown", { clientX: 125, clientY: 50, button: 0, detail: 1, buttons: 1 });
    expect(layer(engine).points).toHaveLength(2);

    // Only after travelling more than 4 screen pixels does a lossless split occur.
    firePointer(window, "pointermove", { clientX: 125, clientY: 90, buttons: 1 });
    expect(layer(engine).points).toHaveLength(3);
    expect(engine.getState().selectedAnchor).toEqual({ layerId: "line", index: 1 });
    firePointer(window, "pointerup", { clientX: 125, clientY: 90, buttons: 0 });

    // ARTBOARD space: `commitPathEdit` re-origins the box, so local coordinates
    // shift even though the drawing does not.
    const world = (index: number) => ({
      x: layer(engine).x + layer(engine).points[index].x,
      y: layer(engine).y + layer(engine).points[index].y,
    });
    expect(world(1).y).toBeCloseTo(90, 1);
    expect(world(0).y).toBeCloseTo(50, 1); // the ends never move
    expect(world(2).y).toBeCloseTo(50, 1);

    // ONE record for the whole gesture.
    engine.undo();
    expect(layer(engine).points).toHaveLength(2);
    expect(world(1).y).toBeCloseTo(50, 1);
  });

  it("does not plant a node on a plain click, but double-click inserts one losslessly", () => {
    const engine = new EditorEngine(docWith(pathLayer()));
    engine.setPathEditing("line");
    const { hit } = renderEditor(engine);

    firePointer(hit, "pointerdown", { clientX: 125, clientY: 50, button: 0, detail: 1, buttons: 1 });
    firePointer(window, "pointerup", { clientX: 125, clientY: 50, buttons: 0 });
    expect(layer(engine).points).toHaveLength(2);

    fireEvent(hit, new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 125, clientY: 50 }));
    expect(layer(engine).points).toHaveLength(3);
    expect(engine.getState().selectedAnchor).toEqual({ layerId: "line", index: 1 });
    const worldPoints = layer(engine).points.map(point => ({ x: layer(engine).x + point.x, y: layer(engine).y + point.y }));
    expect(worldPoints.map(point => point.x).sort((a,b) => a-b).map(x => Math.round(x))).toEqual([0, 125, 500]);
    expect(worldPoints.every(point => Math.abs(point.y - 50) < 0.1)).toBe(true);
  });

  it("keeps Alt/Option for moving the layer instead of bending", () => {
    const engine = new EditorEngine(docWith(pathLayer()));
    engine.setPathEditing("line");
    const { hit } = renderEditor(engine);

    firePointer(hit, "pointerdown", { clientX: 125, clientY: 50, button: 0, detail: 1, altKey: true, buttons: 1 });
    expect(layer(engine).points).toHaveLength(2);
    expect(engine.getState().canUndo).toBe(false);
  });

  it("does nothing when the press misses the line", () => {
    const engine = new EditorEngine(docWith(pathLayer()));
    engine.setPathEditing("line");
    const { hit } = renderEditor(engine);

    firePointer(hit, "pointerdown", { clientX: 250, clientY: 190, button: 0, detail: 1, buttons: 1 });
    expect(layer(engine).points).toHaveLength(2);
  });
});

describe("selected layer: the dot travels along the line", () => {
  it("bends a legacy arc exactly where the pointer pressed, not at its apex", () => {
    const engine = new EditorEngine(docWith(pathLayer({ bend: 0.5 })));
    const { hit } = renderDot(engine);
    // The arc's apex for a bend 0.5 on a 500px chord: (250, 50 + 125).
    expect(layer(engine).bend).toBe(0.5);

    // A point PART WAY along the visible arc, found by the engine's own hit test
    // (which is exactly what the dot uses) — the apex would be (250, 175).
    const onArc = engine.bendPointAt("line", { x: 100, y: 136 }, 1e5);
    expect(onArc).not.toBeNull();
    expect(Math.abs(onArc!.point.y - 175)).toBeGreaterThan(20);

    firePointer(hit, "pointerdown", {
      clientX: onArc!.point.x,
      clientY: onArc!.point.y,
      button: 0,
      detail: 1,
      buttons: 1,
    });
    expect(layer(engine).bend).toBe(0.5); // a click does not bend
    firePointer(window, "pointermove", { clientX: onArc!.point.x + 20, clientY: onArc!.point.y + 20, buttons: 1 });
    firePointer(window, "pointerup", { clientX: onArc!.point.x + 20, clientY: onArc!.point.y + 20, buttons: 0 });
    const bent = layer(engine);
    expect(bent.bend).toBeUndefined();
    expect(bent.points.length).toBeGreaterThan(2);
    const node = bent.points.find((point) => Math.abs(point.x - (onArc!.point.x + 20)) < 1 && Math.abs(point.y - (onArc!.point.y + 20)) < 1);
    expect(node).toBeTruthy();
  });

  it("forwards the double-click into point-editing (the way into the node editor)", () => {
    const engine = new EditorEngine(docWith(pathLayer({ bend: 0.5 })));
    const { hit } = renderDot(engine);

    fireEvent.doubleClick(hit);
    expect(engine.getState().editingPathId).toBe("line");
    // Looking at the nodes does not throw the arc away: only a real edit converts
    // it, so the curvature slider stays live for a user who just clicked through.
    expect(layer(engine).bend).toBe(0.5);
  });
});
