import { describe, expect, it } from "vitest";
import { ARTBOARD, type CardDocument } from "../document";
import { EditorEngine } from "../../engine/EditorEngine";

function emptyDoc(): CardDocument {
  return { version: 1, artboard: { ...ARTBOARD }, background: "#ffffff", layers: [] };
}

describe("background gesture history", () => {
  it("transientBackground changes the document but records NO undo entry", () => {
    const engine = new EditorEngine(emptyDoc());
    expect(engine.getState().canUndo).toBe(false);

    engine.transientBackground("linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)");
    engine.transientBackground("linear-gradient(140deg, #0ea5e9 0%, #2563eb 100%)");
    engine.transientBackground("linear-gradient(145deg, #0ea5e9 0%, #2563eb 100%)");

    // The document follows every pointermove…
    expect(engine.getState().doc.background).toBe("linear-gradient(145deg, #0ea5e9 0%, #2563eb 100%)");
    // …but a gesture in progress costs nothing in undo history.
    expect(engine.getState().canUndo).toBe(false);
  });

  it("commitBackground records exactly ONE undo entry for the whole gesture", () => {
    const engine = new EditorEngine(emptyDoc());
    // Establish a state to gesture FROM so the pre-gesture snapshot is
    // RECOGNISABLE — the transient intermediates must never become records.
    engine.setBackground("#abc123");

    engine.transientBackground("#0ea5e9");
    engine.transientBackground("#2563eb");
    engine.transientBackground("#e11d48");
    engine.commitBackground();

    expect(engine.getState().doc.background).toBe("#e11d48");

    // ONE undo lands EXACTLY on the pre-gesture state — not on #0ea5e9 or
    // #2563eb (that is the "one record per gesture" rule).
    engine.undo();
    expect(engine.getState().doc.background).toBe("#abc123");

    // A second undo reaches the pre-setBackground state; nothing for the
    // gesture's intermediates sits between the two records.
    engine.undo();
    expect(engine.getState().doc.background).toBe("#ffffff");

    engine.redo();
    expect(engine.getState().doc.background).toBe("#abc123");
    engine.redo();
    expect(engine.getState().doc.background).toBe("#e11d48");
  });

  it("a commit with no transient change records nothing", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.commitBackground();
    expect(engine.getState().canUndo).toBe(false);
    expect(engine.getState().doc.background).toBe("#ffffff");
  });

  it("transientBackground no-ops (and commits nothing) when the value did not change", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.transientBackground("#ffffff");
    engine.commitBackground();
    expect(engine.getState().canUndo).toBe(false);
  });

  it("does not collide with an in-flight LAYER transient gesture", () => {
    const engine = new EditorEngine({
      version: 1,
      artboard: { ...ARTBOARD },
      background: "#ffffff",
      layers: [
        {
          id: "t1",
          kind: "text",
          x: 10,
          y: 10,
          width: 100,
          height: 40,
          angle: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          color: null,
          background: null,
          text: "سلام",
          fontSize: 28,
          fontWeight: 600,
          align: "start",
          fontFamily: "vazir",
        },
      ],
    });

    // A layer drag starts a transient gesture…
    engine.transientMove("t1", 30, 30);
    // …and the background is edited transiently within the same gesture.
    engine.transientBackground("#0ea5e9");
    engine.commitBackground();

    // The background commit closes the WHOLE open gesture (the layer drag also
    // ends), which is the documented transient-gesture contract: one commit
    // ends the gesture. Undo returns the document to its pre-gesture state.
    expect(engine.getState().canUndo).toBe(true);
    engine.undo();
    expect(engine.getState().doc.background).toBe("#ffffff");
    expect(engine.getState().doc.layers[0].x).toBe(10);
  });

  it("setBackground (legacy) still commits one record per call", () => {
    const engine = new EditorEngine(emptyDoc());
    engine.setBackground("#0ea5e9");
    engine.setBackground("#2563eb");

    engine.undo();
    expect(engine.getState().doc.background).toBe("#0ea5e9");
    engine.undo();
    expect(engine.getState().doc.background).toBe("#ffffff");

    engine.redo();
    expect(engine.getState().doc.background).toBe("#0ea5e9");
    engine.redo();
    expect(engine.getState().doc.background).toBe("#2563eb");
  });
});
