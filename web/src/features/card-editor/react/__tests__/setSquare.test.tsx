// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SetSquareOverlay } from "../SetSquareOverlay";
import { createSetSquare } from "../../domain/setSquare";

afterEach(cleanup);

function pointer(target: Element, type: string, init: { clientX: number; clientY: number; button?: number; buttons?: number }) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function renderSquare(locked = false) {
  const square = { ...createSetSquare("sq1", { x: 100, y: 100 }), locked };
  const props = {
    squares: [square], zoom: 1, pan: { x: 0, y: 0 }, angleSnap: 45,
    onMove: vi.fn(), onRotate: vi.fn(), onResize: vi.fn(), onToggleLock: vi.fn(),
    onSwitchKind: vi.fn(), onRemove: vi.fn(),
  };
  return { ...render(<SetSquareOverlay {...props} />), props };
}

describe("physical set-square overlay", () => {
  it("drags the triangle body by the pointer delta", () => {
    const view = renderSquare();
    const body = view.container.querySelector('[data-set-square-body="sq1"]');
    if (!body) throw new Error("missing set-square body");
    pointer(body, "pointerdown", { clientX: 100, clientY: 100, button: 0, buttons: 1 });
    pointer(body, "pointermove", { clientX: 120, clientY: 140, buttons: 1 });
    pointer(body, "pointerup", { clientX: 120, clientY: 140, buttons: 0 });
    expect(view.props.onMove).toHaveBeenCalledWith("sq1", { x: 120, y: 140 });
  });

  it("rotates around the centroid and uniformly resizes from the hypotenuse midpoint", () => {
    const view = renderSquare();
    const rotate = view.container.querySelector('[data-set-square-rotate="sq1"]')!;
    pointer(rotate, "pointerdown", { clientX: 100, clientY: -29.6, button: 0, buttons: 1 });
    pointer(rotate, "pointermove", { clientX: 229.6, clientY: 100, buttons: 1 });
    pointer(rotate, "pointerup", { clientX: 229.6, clientY: 100, buttons: 0 });
    expect(view.props.onRotate).toHaveBeenCalledWith("sq1", 90);

    const resize = view.container.querySelector('[data-set-square-resize="sq1"]')!;
    pointer(resize, "pointerdown", { clientX: 130, clientY: 130, button: 0, buttons: 1 });
    pointer(resize, "pointermove", { clientX: 160, clientY: 160, buttons: 1 });
    pointer(resize, "pointerup", { clientX: 160, clientY: 160, buttons: 0 });
    expect(view.props.onResize).toHaveBeenCalledWith("sq1", 360);
  });

  it("exposes lock and kind controls and keeps remove disabled while locked", () => {
    const unlocked = renderSquare();
    fireEvent.click(unlocked.getByLabelText("قفل گونیا"));
    expect(unlocked.props.onToggleLock).toHaveBeenCalledWith("sq1");
    fireEvent.click(unlocked.getByLabelText("تغییر نوع گونیا"));
    expect(unlocked.props.onSwitchKind).toHaveBeenCalledWith("sq1");

    cleanup();
    const locked = renderSquare(true);
    expect((locked.getByLabelText("حذف گونیا") as HTMLButtonElement).disabled).toBe(true);
    expect((locked.getByLabelText("تغییر نوع گونیا") as HTMLButtonElement).disabled).toBe(true);
  });
});
