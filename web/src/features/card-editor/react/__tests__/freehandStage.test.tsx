// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EditorStage } from "../EditorStage";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type PathLayer } from "../../domain/document";

const RECT = { x: 0, y: 0, left: 0, top: 0, right: ARTBOARD.width, bottom: ARTBOARD.height, width: ARTBOARD.width, height: ARTBOARD.height, toJSON: () => ({}) };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}

function renderStage(engine: EditorEngine) {
  const view = render(<EditorStage engine={engine} doc={engine.getState().doc} />);
  const canvas = view.container.querySelector("[data-stage-inner]") as HTMLElement | null;
  if (!canvas) throw new Error("stage inner canvas not found");
  canvas.getBoundingClientRect = () => RECT as DOMRect;
  return { ...view, canvas };
}

function pointer(target: Element, type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", x: number, y: number, timeStamp?: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1 });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  fireEvent(target, event);
}

function selectedPath(engine: EditorEngine): PathLayer {
  const id = engine.getState().selection.layerId;
  const layer = engine.getState().doc.layers.find(item => item.id === id);
  if (!layer || layer.kind !== "path") throw new Error("expected selected path layer");
  return layer;
}

describe("EditorStage freehand input", () => {
  it("commits the exact previewed editable outline, keeps draw active, and activates node editing", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("draw");
    const { canvas } = renderStage(engine);
    pointer(canvas, "pointerdown", 20, 20, 10);
    pointer(canvas, "pointermove", 50, 50, 30);
    pointer(canvas, "pointermove", 80, 45, 50);
    pointer(canvas, "pointerup", 80, 45, 60);

    const layer = selectedPath(engine);
    expect(layer.closed).toBe(true);
    expect(layer.points.length).toBeGreaterThan(3);
    expect(engine.getState().tool).toBe("draw");
    expect(engine.getState().editingPathId).toBe(layer.id);
  });

  it("fully cancels a pointercancel without committing a partial layer", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("draw");
    const { canvas } = renderStage(engine);
    pointer(canvas, "pointerdown", 20, 20, 10);
    pointer(canvas, "pointermove", 60, 60, 30);
    pointer(canvas, "pointercancel", 60, 60, 40);
    expect(engine.getState().doc.layers).toHaveLength(0);
    expect(engine.getState().editingPathId).toBeNull();
  });

  it("snaps a freehand stroke to a locked guide as a two-anchor straight path", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setTool("draw");
    engine.addGuide("x", 100);
    const guide = engine.getState().guides[0];
    engine.toggleGuideLock(guide.id);
    const { canvas } = renderStage(engine);
    pointer(canvas, "pointerdown", 103, 20, 10);
    pointer(canvas, "pointermove", 105, 80, 30);
    pointer(canvas, "pointerup", 105, 80, 40);
    const layer = selectedPath(engine);
    expect(layer.closed).toBe(false);
    expect(layer.points).toHaveLength(2);
    const worldX = layer.points.map(point => layer.x + point.x);
    expect(worldX[0]).toBeCloseTo(100, 3);
    expect(worldX[1]).toBeCloseTo(100, 3);
    expect(engine.getState().tool).toBe("draw");
  });
});
