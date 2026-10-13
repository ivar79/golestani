// @vitest-environment jsdom
/**
 * MODAL GUARD REGRESSION.
 *
 * The shortcuts overlay is rendered with `aria-modal="true"`, but the stage's
 * global keydown handler did not know about it: with the help screen open,
 * Delete / arrows / Ctrl+D kept mutating the design BEHIND the modal. The
 * overlay looked modal and was not.
 *
 * Contract under test: while the overlay section is present in the document,
 * the stage's editing shortcuts are inert. Close it and they work again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { EditorStage } from "../EditorStage";
import { EditorEngine } from "../../engine/EditorEngine";
import { ARTBOARD, type CardDocument, type TextLayer } from "../../domain/document";

beforeEach(() => {
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
  document.querySelectorAll("[data-shortcut-dialog]").forEach((node) => node.remove());
});

function textLayer(): TextLayer {
  return {
    id: "t1",
    kind: "text",
    x: 10,
    y: 20,
    width: 300,
    height: 60,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: "#000000",
    background: null,
    text: "متن",
    fontSize: 24,
    fontWeight: 600,
    align: "start",
    fontFamily: "vazir",
  };
}

function doc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [textLayer()] };
}

/** A stand-in for the real overlay root (`fixed inset-0` + `data-shortcut-dialog`). */
function openShortcutDialog() {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-shortcut-dialog", "");
  document.body.appendChild(overlay);
  return overlay;
}

function key(name: string, code: string, init: KeyboardEventInit = {}) {
  fireEvent(window, new KeyboardEvent("keydown", { key: name, code, bubbles: true, cancelable: true, ...init }));
}

describe("EditorStage — the shortcuts overlay is functionally modal", () => {
  it("Delete does not remove the selected layer while the overlay is open", () => {
    const engine = new EditorEngine(doc());
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);
    const dialog = openShortcutDialog();

    key("Delete", "Delete");
    expect(engine.getState().doc.layers).toHaveLength(1);

    // Close it → the very same key now works.
    dialog.remove();
    key("Delete", "Delete");
    expect(engine.getState().doc.layers).toHaveLength(0);
  });

  it("arrow keys do not nudge the layer while the overlay is open", () => {
    const engine = new EditorEngine(doc());
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);
    const before = engine.getState().doc.layers[0].x;
    const dialog = openShortcutDialog();

    key("ArrowRight", "ArrowRight");
    expect(engine.getState().doc.layers[0].x).toBe(before);

    dialog.remove();
    key("ArrowRight", "ArrowRight");
    expect(engine.getState().doc.layers[0].x).toBe(before + 1);
  });

  it("Ctrl+D does not duplicate the layer while the overlay is open", () => {
    const engine = new EditorEngine(doc());
    engine.select("t1");
    render(<EditorStage engine={engine} doc={engine.getState().doc} />);
    const dialog = openShortcutDialog();

    key("d", "KeyD", { ctrlKey: true });
    expect(engine.getState().doc.layers).toHaveLength(1);

    dialog.remove();
    key("d", "KeyD", { ctrlKey: true });
    expect(engine.getState().doc.layers).toHaveLength(2);
  });
});
