// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AngleDial } from "../AngleDial";

afterEach(cleanup);

describe("ruler angle dial", () => {
  it("commits the typed relative angle as an absolute guide angle on Enter", () => {
    const onCommit = vi.fn(() => true);
    const onCancel = vi.fn();
    const { getByLabelText } = render(
      <AngleDial
        vertex={{ x: 200, y: 120 }}
        baseAngle={90}
        artboard={{ width: 500, height: 300 }}
        zoom={1}
        pan={{ x: 0, y: 0 }}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const input = getByLabelText("زاویه نقاله") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(120);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fine-snaps the needle to one-degree steps while Shift is held", () => {
    const onCommit = vi.fn(() => true);
    const { container, getByLabelText } = render(
      <AngleDial
        vertex={{ x: 200, y: 120 }}
        baseAngle={0}
        artboard={{ width: 500, height: 300 }}
        zoom={1}
        pan={{ x: 0, y: 0 }}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const needle = container.querySelector("[data-angle-needle-hit]")!;
    fireEvent(needle, new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 268, clientY: 120, shiftKey: true }));
    fireEvent(needle, new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 250, clientY: 136, shiftKey: true }));
    fireEvent(needle, new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 250, clientY: 136, shiftKey: true }));
    fireEvent.click(getByLabelText("ثبت زاویه"));
    expect(onCommit).toHaveBeenCalledWith(42);
  });

  it("cancels on Escape without committing", () => {
    const onCommit = vi.fn(() => true);
    const onCancel = vi.fn();
    render(
      <AngleDial
        vertex={{ x: 200, y: 120 }}
        baseAngle={0}
        artboard={{ width: 500, height: 300 }}
        zoom={1}
        pan={{ x: 0, y: 0 }}
        onCommit={onCommit}
        onCancel={onCancel}
        onMoveVertex={vi.fn()}
        onSetBaseAngle={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
