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
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(120);
    expect(onCancel).not.toHaveBeenCalled();
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
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
