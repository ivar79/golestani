// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RulersAndGuides } from "../RulersAndGuides";
import type { UserGuide } from "../../domain/guides";

/**
 * The UI half of the rulers/guides aid.
 *
 * jsdom has no layout, so every test pins `getBoundingClientRect` to the origin:
 * with the rect at (0,0), pan at (0,0) and zoom 1, a CLIENT coordinate IS the
 * artboard coordinate. That is what makes these assertions exact rather than
 * approximate — the same mapping the component uses in the browser.
 *
 * The headlines here are the two things an axis-only guide could not do: create
 * a DIAGONAL (the ruler elbow) and turn an existing line into one (the rotate
 * handle). Both are asserted on the callback payload, not on pixels.
 */

const ARTBOARD = { width: 300, height: 400 };
const RECT = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 300,
  bottom: 400,
  width: 300,
  height: 400,
  toJSON: () => ({}),
};

/** A vertical guide through the board's middle, with the angle-based shape. */
const vertical = (id = "gv", x = 100, y = 200): UserGuide => ({ id, angle: 90, x, y });
/** A horizontal guide through the board's middle. */
const horizontal = (id = "gh", y = 120, x = 150): UserGuide => ({ id, angle: 0, x, y });
/** A 45° guide through the board's middle — the shape that used to be impossible. */
const diagonal = (id = "gd", x = 100, y = 100): UserGuide => ({ id, angle: 45, x, y });

/**
 * Real pointer events with real coordinates.
 *
 * jsdom has no `PointerEvent`, so testing-library's `fireEvent.pointerDown`
 * dispatches a bare Event that carries NO clientX/clientY — a gesture test would
 * silently aim at (0,0) and pass for the wrong reason. A MouseEvent carries
 * everything this component reads (same approach as `bendGesture.test.tsx`).
 */
function firePointer(
  target: Element | Window,
  type:
    | "pointerdown"
    | "pointermove"
    | "pointerup"
    | "pointercancel"
    | "pointerover"
    | "pointerout"
    | "pointerleave",
  init: { clientX: number; clientY: number; pointerId?: number; shiftKey?: boolean } = { clientX: 0, clientY: 0 },
) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function overlayProps(overrides: Partial<ComponentProps<typeof RulersAndGuides>> = {}) {
  return {
    artboard: ARTBOARD,
    zoom: 1,
    pan: { x: 0, y: 0 },
    guides: [] as UserGuide[],
    angleSnap: null as number | null,
    onAdd: vi.fn(),
    onAddAngled: vi.fn(),
    onMove: vi.fn(),
    onRotate: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
}

function renderOverlay(overrides: Partial<ComponentProps<typeof RulersAndGuides>> = {}) {
  const host = document.createElement("div");
  host.getBoundingClientRect = () => RECT as DOMRect;
  document.body.appendChild(host);
  const value = overlayProps(overrides);
  const view = render(<RulersAndGuides {...value} />, { container: host });
  // The component measures its OWN root, so that element carries the rect too.
  const root = view.container.querySelector("[data-rulers]") as HTMLElement | null;
  if (root) root.getBoundingClientRect = () => RECT as DOMRect;
  const bed = (selector: string) => view.container.querySelector(selector) as HTMLElement;
  const attr = (selector: string, name: string) => bed(selector)?.getAttribute(name) ?? null;
  return { ...value, ...view, bed, attr };
}

/** The full pull-out gesture: press on a strip, drag, release. */
function pullOut(strip: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  firePointer(strip, "pointerdown", { clientX: from.x, clientY: from.y, pointerId: 1 });
  firePointer(strip, "pointermove", { clientX: to.x, clientY: to.y, pointerId: 1 });
  firePointer(strip, "pointerup", { clientX: to.x, clientY: to.y, pointerId: 1 });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("RulersAndGuides", () => {
  it("renders nothing in preview mode (design aids never reach a preview)", () => {
    const view = renderOverlay({ preview: true, guides: [vertical()] });
    expect(view.container.querySelector("[data-rulers]")).toBeNull();
    expect(view.container.querySelector("[data-guide]")).toBeNull();
  });

  it("keeps the guides on screen when the ruler strips are switched off", () => {
    const view = renderOverlay({ rulers: false, guides: [vertical("g1", 120)] });
    // Illustrator's rule: hiding the scale is a view preference. A guide that
    // still snaps but cannot be seen would be worse than either option.
    expect(view.container.querySelector('[data-ruler="top"]')).toBeNull();
    expect(view.container.querySelector('[data-ruler="left"]')).toBeNull();
    expect(view.attr('[data-guide="g1"]', "data-angle")).toBe("90");
    // A vertical guide's screen x is pan + 120 * zoom.
    expect(view.attr('[data-guide="g1"]', "x1")).toBe("120");
  });

  it("draws ruler strips that span the board, with labelled and minor ticks", () => {
    const view = renderOverlay();
    // The strips must SPAN the board. A strip that shrink-wraps to its SVG
    // leaves most of the board with no way to pull a guide out of it.
    expect(view.bed('[data-ruler="top"]').style.right).toBe("0px");
    expect(view.bed('[data-ruler="left"]').style.bottom).toBe("0px");
    const top = view.bed('[data-ruler="top"]');
    const left = view.bed('[data-ruler="left"]');
    expect(top.querySelectorAll("line").length).toBeGreaterThan(4);
    expect(left.querySelectorAll("line").length).toBeGreaterThan(4);
    // Two tick classes: a scale reads as a scale because the steps differ.
    expect(top.querySelectorAll('[data-tick="major"]').length).toBeGreaterThan(0);
    expect(top.querySelectorAll('[data-tick="minor"]').length).toBeGreaterThan(2);
    // The board starts at the origin, so 0 is always a labelled coordinate.
    expect(top.textContent).toContain("0");
  });

  it("shows a live pointer indicator on both strips, and clears it when the pointer leaves", () => {
    const view = renderOverlay();
    expect(view.container.querySelector('[data-ruler-cursor="top"]')).toBeNull();
    firePointer(window, "pointermove", { clientX: 160, clientY: 240 });
    // The indicator is the cue that turns a strip into a measurable ruler.
    expect(view.attr('[data-ruler-cursor="top"]', "x1")).toBe("160");
    expect(view.attr('[data-ruler-cursor="left"]', "y1")).toBe("240");
    expect(view.bed('[data-ruler-readout="top"]').textContent).toBe("160");
    expect(view.bed('[data-ruler-readout="left"]').textContent).toBe("240");
    firePointer(window, "pointerleave", { clientX: 160, clientY: 240 });
    expect(view.container.querySelector('[data-ruler-cursor="top"]')).toBeNull();
  });

  it("creates a vertical guide by dragging out of the top ruler", () => {
    const view = renderOverlay();
    pullOut(view.bed('[data-ruler="top"]'), { x: 120, y: 5 }, { x: 150, y: 90 });
    expect(view.onAdd).toHaveBeenCalledWith("x", 150);
  });

  it("creates a horizontal guide by dragging out of the left ruler", () => {
    const view = renderOverlay();
    pullOut(view.bed('[data-ruler="left"]'), { x: 5, y: 60 }, { x: 120, y: 260 });
    expect(view.onAdd).toHaveBeenCalledWith("y", 260);
  });

  it("does NOT scatter a guide when the ruler is merely clicked", () => {
    const view = renderOverlay();
    pullOut(view.bed('[data-ruler="top"]'), { x: 120, y: 5 }, { x: 120, y: 5 });
    expect(view.onAdd).not.toHaveBeenCalled();
  });

  it("clamps a pull-out past the RIGHT edge onto the board (own axis never deletes)", () => {
    const view = renderOverlay();
    pullOut(view.bed('[data-ruler="top"]'), { x: 100, y: 5 }, { x: 900, y: 120 });
    // x = 300 is a legitimate guide; the line pins to the edge instead of
    // vanishing, which is what makes the drag feel like a physical ruler line.
    expect(view.onAdd).toHaveBeenCalledWith("x", ARTBOARD.width);
  });

  it("cancels a pull-out dragged back up onto the ruler", () => {
    const view = renderOverlay();
    pullOut(view.bed('[data-ruler="top"]'), { x: 100, y: 5 }, { x: 150, y: -60 });
    expect(view.onAdd).not.toHaveBeenCalled();
  });

  it("creates a DIAGONAL guide by dragging the ruler elbow", () => {
    const view = renderOverlay();
    pullOut(view.bed("[data-ruler-origin]"), { x: 10, y: 10 }, { x: 60, y: 60 });
    // 45° through the press point: the line a ruler strip could never imply.
    expect(view.onAddAngled).toHaveBeenCalledWith(45, { x: 10, y: 10 });
    expect(view.onAdd).not.toHaveBeenCalled();
  });

  it("locks the elbow drag onto the set-square grid when angle assist is on", () => {
    const view = renderOverlay({ angleSnap: 45 });
    // dx = 40, dy = 50 → 51.34°, which must land exactly on the 45° grid.
    pullOut(view.bed("[data-ruler-origin]"), { x: 0, y: 0 }, { x: 40, y: 50 });
    expect(view.onAddAngled).toHaveBeenCalledWith(45, { x: 0, y: 0 });
  });

  it("creates nothing when the elbow is only clicked", () => {
    const view = renderOverlay();
    pullOut(view.bed("[data-ruler-origin]"), { x: 10, y: 10 }, { x: 10, y: 10 });
    expect(view.onAddAngled).not.toHaveBeenCalled();
  });

  it("translates a vertical guide by the exact pointer delta without jumping", () => {
    const view = renderOverlay({ guides: [vertical("g1")] });
    const hit = view.bed('[data-guide-hit="g1"]');
    firePointer(hit, "pointerdown", { clientX: 100, clientY: 200, pointerId: 2 });
    firePointer(hit, "pointermove", { clientX: 180, clientY: 260, pointerId: 2 });
    firePointer(hit, "pointerup", { clientX: 180, clientY: 260, pointerId: 2 });
    // The full anchor translates by the pointer delta; the line does not jump.
    expect(view.onMove).toHaveBeenCalledWith("g1", { x: 180, y: 260 });
    expect(view.onRemove).not.toHaveBeenCalled();
  });

  it("TRANSLATES a diagonal guide instead of flattening it onto one axis", () => {
    const view = renderOverlay({ guides: [diagonal("gd")] });
    const hit = view.bed('[data-guide-hit="gd"]');
    firePointer(hit, "pointerdown", { clientX: 150, clientY: 150, pointerId: 2 });
    firePointer(hit, "pointermove", { clientX: 170, clientY: 130, pointerId: 2 });
    firePointer(hit, "pointerup", { clientX: 170, clientY: 130, pointerId: 2 });
    // Both coordinates move by the pointer delta: a diagonal has no own axis.
    expect(view.onMove).toHaveBeenCalledWith("gd", { x: 120, y: 80 });
    expect(view.attr('[data-guide="gd"]', "data-axis-aligned")).toBe("no");
  });

  it("deletes a vertical guide dropped back onto its TOP ruler", () => {
    const view = renderOverlay({ guides: [vertical("g1")] });
    const hit = view.bed('[data-guide-hit="g1"]');
    firePointer(hit, "pointerdown", { clientX: 100, clientY: 200, pointerId: 3 });
    firePointer(hit, "pointermove", { clientX: 100, clientY: -40, pointerId: 3 });
    firePointer(hit, "pointerup", { clientX: 100, clientY: -40, pointerId: 3 });
    expect(view.onRemove).toHaveBeenCalledWith("g1");
    expect(view.onMove).not.toHaveBeenCalled();
  });

  it("deletes a horizontal guide dropped back onto its LEFT ruler", () => {
    const view = renderOverlay({ guides: [horizontal("g1")] });
    const hit = view.bed('[data-guide-hit="g1"]');
    firePointer(hit, "pointerdown", { clientX: 200, clientY: 120, pointerId: 3 });
    firePointer(hit, "pointermove", { clientX: -40, clientY: 120, pointerId: 3 });
    firePointer(hit, "pointerup", { clientX: -40, clientY: 120, pointerId: 3 });
    expect(view.onRemove).toHaveBeenCalledWith("g1");
  });

  it("pins a locked guide on click instead of starting a move", () => {
    const onPin = vi.fn();
    const view = renderOverlay({ guides: [{ ...horizontal("locked", 120), locked: true }], onPin });
    firePointer(view.bed('[data-guide-hit="locked"]'), "pointerdown", { clientX: 200, clientY: 120, pointerId: 31 });
    expect(onPin).toHaveBeenCalledWith({ x: 200, y: 120 }, 0);
    expect(view.onMove).not.toHaveBeenCalled();
  });

  it("snaps guide placement to the nearest object edge or center", () => {
    const view = renderOverlay({ onSnapCreate: (point, axis) => axis === "x" ? { ...point, x: 144 } : { ...point, y: 166 } });
    pullOut(view.bed('[data-ruler="top"]'), { x: 100, y: 5 }, { x: 130, y: 120 });
    expect(view.onAdd).toHaveBeenCalledWith("x", 144);
  });

  it("creates an angled guide by Shift-dragging from the top ruler", () => {
    const view = renderOverlay();
    const ruler = view.bed('[data-ruler="top"]');
    firePointer(ruler, "pointerdown", { clientX: 100, clientY: 5, pointerId: 32 });
    firePointer(ruler, "pointermove", { clientX: 150, clientY: 100, pointerId: 32, shiftKey: true });
    firePointer(ruler, "pointerup", { clientX: 150, clientY: 100, pointerId: 32, shiftKey: true });
    expect(view.onAddAngled).toHaveBeenCalledTimes(1);
    expect(view.onAdd).not.toHaveBeenCalled();
  });

  it("pins a guide dragged past the board edge on its own axis instead of deleting it", () => {
    const view = renderOverlay({ guides: [vertical("g1")] });
    const hit = view.bed('[data-guide-hit="g1"]');
    firePointer(hit, "pointerdown", { clientX: 100, clientY: 200, pointerId: 3 });
    firePointer(hit, "pointermove", { clientX: -60, clientY: 200, pointerId: 3 });
    firePointer(hit, "pointerup", { clientX: -60, clientY: 200, pointerId: 3 });
    expect(view.onMove).toHaveBeenCalledWith("g1", { x: 0, y: 200 });
    expect(view.onRemove).not.toHaveBeenCalled();
  });

  it("deletes a guide on double-click", () => {
    const view = renderOverlay({ guides: [horizontal("g1", 40)] });
    fireEvent.doubleClick(view.bed('[data-guide-hit="g1"]'));
    expect(view.onRemove).toHaveBeenCalledWith("g1");
  });

  it("keeps the rotate handle visible and ROTATES the line to any angle", () => {
    const view = renderOverlay({ guides: [horizontal("g1")] });
    // The handle is always visible, as on a physical ruler.
    expect(view.container.querySelector('[data-guide-rotate="g1"]')).not.toBeNull();
    const grip = view.bed('[data-guide-rotate-grip="g1"]');
    expect(grip).toBeTruthy();
    // The grip sits on the middle of the visible chord: (-28…328) → 150.
    expect(grip.getAttribute("cx")).toBe("150");
    expect(grip.getAttribute("cy")).toBe("120");
    firePointer(grip, "pointerdown", { clientX: 150, clientY: 120, pointerId: 4 });
    firePointer(grip, "pointermove", { clientX: 150, clientY: 260, pointerId: 4 });
    firePointer(grip, "pointerup", { clientX: 150, clientY: 260, pointerId: 4 });
    // Pointing straight down from the anchor (150,120) is a 90° line.
    expect(view.onRotate).toHaveBeenCalledWith("g1", 90);
  });

  it("locks a rotation onto the angle-assist grid even when Shift is held", () => {
    const view = renderOverlay({ guides: [horizontal("g1")], angleSnap: 30 });
    firePointer(view.bed('[data-guide-hit="g1"]'), "pointerover", { clientX: 150, clientY: 120 });
    const grip = view.bed('[data-guide-rotate-grip="g1"]');
    firePointer(grip, "pointerdown", { clientX: 150, clientY: 120, pointerId: 5 });
    // 51.34° from the anchor → the 30° square snaps it to 60°.
    firePointer(grip, "pointermove", { clientX: 190, clientY: 170, pointerId: 5 });
    firePointer(grip, "pointerup", { clientX: 190, clientY: 170, pointerId: 5 });
    expect(view.onRotate).toHaveBeenCalledWith("g1", 60);
    // The angle-assist grid is the only rotation snap source in this specification.
    expect(view.onRotate).toHaveBeenCalledTimes(1);
    const viaShift = renderOverlay({ guides: [horizontal("g2")], angleSnap: 30 });
    firePointer(viaShift.bed('[data-guide-hit="g2"]'), "pointerover", { clientX: 150, clientY: 120 });
    const shiftGrip = viaShift.bed('[data-guide-rotate-grip="g2"]');
    firePointer(shiftGrip, "pointerdown", { clientX: 150, clientY: 120, pointerId: 6 });
    firePointer(shiftGrip, "pointermove", { clientX: 190, clientY: 170, pointerId: 6, shiftKey: true });
    firePointer(shiftGrip, "pointerup", { clientX: 190, clientY: 170, pointerId: 6, shiftKey: true });
    // 51.34° snaps to the active 30° angle-assist grid.
    expect(viaShift.onRotate).toHaveBeenCalledWith("g2", 60);
  });

  it("clips an angled guide to the board, so it touches both edges", () => {
    const view = renderOverlay({ guides: [diagonal("gd")] });
    const x1 = Number(view.attr('[data-guide="gd"]', "x1"));
    const y1 = Number(view.attr('[data-guide="gd"]', "y1"));
    const x2 = Number(view.attr('[data-guide="gd"]', "x2"));
    const y2 = Number(view.attr('[data-guide="gd"]', "y2"));
    // A 45° line through (100,100) enters the padded board at (-28,-28) and
    // leaves it at (328,328): a real diagonal, not a fixed-length bar.
    expect([x1, y1, x2, y2]).toEqual([-28, -28, 328, 328]);
  });

  it("shows an exact readout while dragging, and an angle while rotating", () => {
    const view = renderOverlay({ guides: [vertical("g1")] });
    const hit = view.bed('[data-guide-hit="g1"]');
    expect(view.container.querySelector("[data-guide-readout]")).toBeNull();
    firePointer(hit, "pointerdown", { clientX: 100, clientY: 200, pointerId: 6 });
    firePointer(hit, "pointermove", { clientX: 140.4, clientY: 200, pointerId: 6 });
    expect(view.container.querySelector("[data-guide-readout]")?.textContent).toBe("140.4, 200");
    firePointer(hit, "pointermove", { clientX: 140, clientY: -80, pointerId: 6 });
    expect(view.container.querySelector("[data-guide-readout]")?.textContent).toBe("حذف");
  });

  it("maps pan and zoom when converting a client point to a board point", () => {
    const view = renderOverlay({
      zoom: 2,
      pan: { x: 40, y: 20 },
      guides: [vertical("g1", 50)],
    });
    // The guide's screen position is pan + x * zoom = 40 + 100.
    expect(view.attr('[data-guide="g1"]', "x1")).toBe("140");
    const hit = view.bed('[data-guide-hit="g1"]');
    firePointer(hit, "pointerdown", { clientX: 140, clientY: 200, pointerId: 5 });
    firePointer(hit, "pointermove", { clientX: 200, clientY: 200, pointerId: 5 });
    firePointer(hit, "pointerup", { clientX: 200, clientY: 200, pointerId: 5 });
    // (200 − 40) / 2 = 80 artboard px.
    expect(view.onMove).toHaveBeenCalledWith("g1", { x: 80, y: 200 });
  });

  it("starts the ruler scale where the board actually is, so a panned board is not labelled 0", () => {
    const view = renderOverlay({ pan: { x: -60, y: 0 } });
    const labels = Array.from(view.bed('[data-ruler="top"]').querySelectorAll("span"))
      .map((node) => node.textContent)
      .filter((text): text is string => typeof text === "string" && /^-?\d+$/.test(text));
    // Board 0 is 60px off-screen to the left; the first visible coordinate is 60.
    expect(labels).not.toContain("0");
    expect(labels.length).toBeGreaterThan(0);
    expect(Number(labels[0])).toBeGreaterThanOrEqual(60);
  });
});
