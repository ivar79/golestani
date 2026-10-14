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
        onMoveVertex={vi.fn()}
        onSetBaseAngle={vi.fn()}
      />,
    );
    const input = getByLabelText("زاویه نقاله") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(120);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("lets the user move the protractor center and rotate its baseline", () => {
    const onMoveVertex = vi.fn();
    const onSetBaseAngle = vi.fn();
    const { container } = render(
      <AngleDial
        vertex={{ x: 200, y: 120 }}
        baseAngle={0}
        artboard={{ width: 500, height: 300 }}
        zoom={1}
        pan={{ x: 0, y: 0 }}
        onCommit={vi.fn(() => true)}
        onCancel={vi.fn()}
        onMoveVertex={onMoveVertex}
        onSetBaseAngle={onSetBaseAngle}
      />,
    );
    const center = container.querySelector("[data-angle-center-hit]")!;
    fireEvent(center, new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 200, clientY: 120 }));
    fireEvent(center, new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 240, clientY: 150 }));
    fireEvent(center, new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 240, clientY: 150 }));
    expect(onMoveVertex).toHaveBeenCalledWith({ x: 240, y: 150 });

    const baseline = container.querySelector("[data-angle-baseline-hit]")!;
    fireEvent(baseline, new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 268, clientY: 120 }));
    fireEvent(baseline, new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 200, clientY: 188 }));
    fireEvent(baseline, new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 240, clientY: 218 }));
    expect(onSetBaseAngle).toHaveBeenCalledWith(90);
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
